import { metrics as otelMetrics } from "@opentelemetry/api";
import type {
  Counter,
  Histogram,
  ObservableGauge,
  Gauge,
  Meter,
} from "@opentelemetry/api";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import type { Resource } from "@opentelemetry/resources";
import type { InstrumentOptions } from "./types";

export const VERSION = "0.2.0";

/** Internal state for the Metrics module — reset between test runs via reset(). */
let meter: Meter | null = null;
let provider: MeterProvider | null = null;

/**
 * Sets up the OpenTelemetry MeterProvider with an OTLP/HTTP exporter and
 * registers it globally. Called once from Instrumentation.setup().
 *
 * Export interval: 60 000 ms (mirrors the Ruby SDK).
 * Export timeout: 10 000 ms.
 *
 * Auto-pollers installed:
 *  - process.memory.rss          — polled every 60 s
 *  - process.event_loop.lag      — polled every 30 s
 *  - process.runtime.cpu.usage   — polled every 30 s
 */
export function setup(
  endpoint: string,
  headers: Record<string, string>,
  resource: Resource,
  serviceName: string,
): void {
  if (meter !== null) return; // idempotent

  try {
    const exporter = new OTLPMetricExporter({
      url: `${endpoint}/v1/metrics`,
      headers,
    });

    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
      exportTimeoutMillis: 10_000,
    });

    provider = new MeterProvider({
      resource,
      readers: [reader],
    });

    otelMetrics.setGlobalMeterProvider(provider);

    meter = provider.getMeter(serviceName, VERSION);

    installMemoryPoller();
    installEventLoopLagPoller();
    installCpuPoller();
  } catch (err) {
    console.warn(
      `Tracelit: failed to set up metrics: ${(err as Error).message}`,
    );
  }
}

/** @internal — used in tests to tear down state between runs. */
export function reset(): void {
  meter = null;
  if (provider) {
    provider.shutdown().catch(() => undefined);
    provider = null;
  }
}

/**
 * Force the MeterProvider to flush all pending metric data to the exporter.
 * Called by the SDK's exit / crash handlers so metric snapshots survive
 * process termination.
 */
export async function flush(): Promise<void> {
  if (provider) {
    await provider.forceFlush().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Manual instrumentation API
// ---------------------------------------------------------------------------

/**
 * Creates and returns a Counter instrument.
 *
 * @example
 * ```ts
 * const orders = Tracelit.metrics.counter("orders.placed", {
 *   description: "Total orders placed",
 *   unit: "{orders}",
 * });
 * orders.add(1, { currency: "USD" });
 * ```
 */
export function counter(
  name: string,
  options: InstrumentOptions = {},
): Counter | null {
  if (!meter) return null;
  return meter.createCounter(name, {
    description: options.description ?? "",
    unit: options.unit ?? "",
  });
}

/**
 * Creates and returns a Histogram instrument.
 *
 * @example
 * ```ts
 * const latency = Tracelit.metrics.histogram("api.call.duration", {
 *   description: "External API call duration",
 *   unit: "ms",
 * });
 * latency.record(elapsed, { service: "stripe" });
 * ```
 */
export function histogram(
  name: string,
  options: InstrumentOptions = {},
): Histogram | null {
  if (!meter) return null;
  return meter.createHistogram(name, {
    description: options.description ?? "",
    unit: options.unit ?? "",
  });
}

/**
 * Creates and returns a Gauge instrument (non-observable, point-in-time).
 *
 * @example
 * ```ts
 * const depth = Tracelit.metrics.gauge("queue.depth", {
 *   description: "Pending job count",
 *   unit: "{jobs}",
 * });
 * depth.record(pending, { queue: "default" });
 * ```
 */
export function gauge(
  name: string,
  options: InstrumentOptions = {},
): Gauge | null {
  if (!meter) return null;
  return meter.createGauge(name, {
    description: options.description ?? "",
    unit: options.unit ?? "",
  });
}

/**
 * Creates and returns an ObservableGauge instrument.
 * Use when the value is produced on-demand by a callback rather than
 * imperatively (e.g. external resource stats, queue depths from a DB query).
 *
 * @example
 * ```ts
 * const queueGauge = Tracelit.metrics.observableGauge("queue.size", {
 *   description: "Estimated message queue size",
 *   unit: "{messages}",
 * });
 * queueGauge.addCallback((result) => {
 *   result.observe(getQueueSize(), { queue: "events" });
 * });
 * ```
 */
export function observableGauge(
  name: string,
  options: InstrumentOptions = {},
): ObservableGauge | null {
  if (!meter) return null;
  return meter.createObservableGauge(name, {
    description: options.description ?? "",
    unit: options.unit ?? "",
  });
}

// ---------------------------------------------------------------------------
// Auto pollers
// ---------------------------------------------------------------------------

/**
 * Polls process RSS memory every 60 seconds on an unref'd timer so it
 * does not prevent the Node.js process from exiting.
 *
 * Emits: process.memory.rss (MB)
 * Attributes: process.pid, process.runtime
 */
export function installMemoryPoller(): NodeJS.Timeout | null {
  if (!meter) return null;

  const rssGauge = meter.createGauge("process.memory.rss", {
    description: "Process resident set size (RSS)",
    unit: "MB",
  });

  const pid = String(process.pid);

  const timer = setInterval(() => {
    try {
      const rssMb = process.memoryUsage().rss / (1024 * 1024);
      rssGauge.record(rssMb, {
        "process.pid": pid,
        "process.runtime": "nodejs",
      });
    } catch {
      // Ignore — process.memoryUsage() should never throw in practice.
    }
  }, 60_000);

  // Unref so the timer does not prevent process exit.
  timer.unref();
  return timer;
}

/**
 * Polls event loop lag every 30 seconds. Uses a self-measuring setInterval:
 * the actual elapsed time vs the scheduled delay gives the lag.
 *
 * Emits: process.event_loop.lag (ms)
 * Attributes: process.pid, process.runtime
 */
export function installEventLoopLagPoller(): NodeJS.Timeout | null {
  if (!meter) return null;

  const lagHistogram = meter.createHistogram("process.event_loop.lag", {
    description: "Node.js event loop lag",
    unit: "ms",
  });

  const pid = String(process.pid);
  const INTERVAL_MS = 30_000;
  let lastTick = Date.now();

  const timer = setInterval(() => {
    try {
      const now = Date.now();
      const lag = Math.max(0, now - lastTick - INTERVAL_MS);
      lastTick = now;
      lagHistogram.record(lag, {
        "process.pid": pid,
        "process.runtime": "nodejs",
      });
    } catch {
      // Ignore.
    }
  }, INTERVAL_MS);

  timer.unref();
  return timer;
}

/**
 * Polls process CPU utilisation every 30 seconds using `process.cpuUsage()`.
 * Computes a percentage over the interval: (user + system µs) ÷ (elapsed ms × 10).
 *
 * Emits: process.runtime.cpu.usage (%)
 * Attributes: process.pid, process.runtime
 *
 * The emitted name matches what `QueryServiceSummary` in the API queries for,
 * enabling the Avg CPU Load widget on the service dashboard.
 */
export function installCpuPoller(): NodeJS.Timeout | null {
  if (!meter) return null;

  const cpuGauge = meter.createGauge("process.runtime.cpu.usage", {
    description: "Process CPU utilisation percentage",
    unit: "%",
  });

  const pid = String(process.pid);
  const INTERVAL_MS = 30_000;
  let lastCpuUsage = process.cpuUsage();
  let lastTime = Date.now();

  const timer = setInterval(() => {
    try {
      const now = Date.now();
      const elapsed = now - lastTime; // ms
      if (elapsed <= 0) return;

      // cpuUsage(previous) returns the delta since `previous` in microseconds.
      const delta = process.cpuUsage(lastCpuUsage);
      lastCpuUsage = process.cpuUsage();
      lastTime = now;

      // (user + system) µs → ms; divide by elapsed ms to get a 0–1 ratio;
      // multiply by 100 for percentage. Cap at 100 for multi-core cases
      // where we only report a single-core equivalent percentage.
      const cpuMs = (delta.user + delta.system) / 1000;
      const cpuPct = Math.min(100, (cpuMs / elapsed) * 100);

      cpuGauge.record(cpuPct, {
        "process.pid": pid,
        "process.runtime": "nodejs",
      });
    } catch {
      // Ignore — cpuUsage() should never throw in practice.
    }
  }, INTERVAL_MS);

  timer.unref();
  return timer;
}

// ---------------------------------------------------------------------------
// Express HTTP middleware
// ---------------------------------------------------------------------------

/**
 * Returns an Express-compatible middleware that records per-request metrics:
 *   http.server.request.count    — counter
 *   http.server.request.duration — histogram (ms)
 *   http.server.error.count      — counter (5xx only)
 *
 * Attributes: http.method, http.route, http.status_code
 *
 * @example
 * ```ts
 * import express from "express";
 * import Tracelit from "tracelit";
 *
 * const app = express();
 * app.use(Tracelit.expressMetricsMiddleware());
 * ```
 */
export function expressMetricsMiddleware(): (
  req: ExpressRequest,
  res: ExpressResponse,
  next: () => void,
) => void {
  if (!meter) {
    return (_req, _res, next) => next();
  }

  const requestCounter = meter.createCounter("http.server.request.count", {
    description: "Total HTTP requests processed",
    unit: "{requests}",
  });

  const durationHistogram = meter.createHistogram(
    "http.server.request.duration",
    {
      description: "HTTP request duration",
      unit: "ms",
    },
  );

  const errorCounter = meter.createCounter("http.server.error.count", {
    description: "Total HTTP 5xx responses",
    unit: "{errors}",
  });

  return function traceLitMetricsMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: () => void,
  ): void {
    const start = Date.now();

    try {
      res.on("finish", () => {
        try {
          const elapsed = Date.now() - start;
          const attrs = {
            "http.method": req.method ?? "UNKNOWN",
            "http.route": (req.route?.path as string | undefined) ?? req.path ?? req.url ?? "/",
            "http.status_code": String(res.statusCode),
          };

          requestCounter.add(1, attrs);
          durationHistogram.record(elapsed, attrs);

          if (res.statusCode >= 500) {
            errorCounter.add(1, attrs);
          }
        } catch {
          // Never let metric errors surface to the application.
        }
      });
    } catch {
      // res.on() itself may throw in unusual environments — absorb it.
    }

    next();
  };
}

// Minimal Express type shims — avoids requiring @types/express as a prod dep.
interface ExpressRequest {
  method?: string;
  path?: string;
  url?: string;
  route?: { path?: string };
}

interface ExpressResponse {
  statusCode: number;
  on(event: "finish", listener: () => void): this;
}
