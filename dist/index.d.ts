import { Counter, Gauge, Histogram, ObservableGauge, Context, SpanKind, Attributes, Link, Tracer } from '@opentelemetry/api';
import { LoggerProvider, Logger } from '@opentelemetry/api-logs';
import { Resource } from '@opentelemetry/resources';
import { Sampler, SamplingResult, SpanProcessor, SpanExporter, Span, ReadableSpan } from '@opentelemetry/sdk-trace-base';

/**
 * All configurable options for the Tracelit SDK.
 * Every field can be set programmatically or via the corresponding
 * environment variable. Programmatic values take precedence over env vars.
 */
interface TraceLitConfig {
    /** Your Tracelit ingest API key (required). Env: TRACELIT_API_KEY */
    apiKey: string | undefined;
    /**
     * Name of this service as it appears in Tracelit (required).
     * Env: TRACELIT_SERVICE_NAME
     */
    serviceName: string | undefined;
    /**
     * Deployment environment tag — production, staging, development, etc.
     * Env: TRACELIT_ENVIRONMENT. Default: "production"
     */
    environment: string;
    /**
     * Base URL of the Tracelit ingest API. Override only when self-hosting.
     * Env: TRACELIT_ENDPOINT. Default: "https://ingest.tracelit.app"
     */
    endpoint: string;
    /**
     * Head-based trace sampling ratio between 0.0 and 1.0.
     * 1.0 keeps every trace; 0.1 keeps 10%.
     * Error spans are always exported regardless of this setting.
     * Env: TRACELIT_SAMPLE_RATE. Default: 1.0
     */
    sampleRate: number;
    /**
     * Set to false to disable all telemetry without removing the package.
     * Useful in test environments.
     * Env: TRACELIT_ENABLED. Default: true
     */
    enabled: boolean;
    /**
     * Extra key/value pairs appended to every span, metric, and log record
     * as resource attributes.
     */
    resourceAttributes: Record<string, string>;
}
/** Options for creating a manual metric instrument. */
interface InstrumentOptions {
    /** Human-readable description of what this instrument measures. */
    description?: string;
    /** UCUM unit string, e.g. "ms", "MB", "{requests}". */
    unit?: string;
}
/** Options for the console logger bridge. */
interface ConsoleBridgeOptions {
    /**
     * Whether to preserve the original console output after forwarding to OTel.
     * Default: true
     */
    preserveOriginal?: boolean;
}

/**
 * Configuration for the Tracelit SDK. All fields can be set programmatically
 * via the configure callback or through the corresponding environment variable.
 * Programmatic values always take precedence.
 *
 * @example
 * ```ts
 * Tracelit.configure((config) => {
 *   config.apiKey      = process.env.TRACELIT_API_KEY;
 *   config.serviceName = "payments-api";
 *   config.environment = process.env.NODE_ENV ?? "production";
 *   config.sampleRate  = 0.1;
 * });
 * ```
 */
declare class Configuration implements TraceLitConfig {
    apiKey: string | undefined;
    serviceName: string | undefined;
    environment: string;
    endpoint: string;
    sampleRate: number;
    enabled: boolean;
    resourceAttributes: Record<string, string>;
    constructor();
    /**
     * Validates that all required fields are present and within acceptable ranges.
     * Throws a descriptive Error on the first validation failure found.
     */
    validate(): void;
    /**
     * Returns the effective service name. Falls back to "unknown-service" when
     * serviceName is not set — callers that need a validated name should call
     * validate() first.
     */
    resolvedServiceName(): string;
    /**
     * Convenience getter: returns the trailing-slash-free base URL so callers
     * can safely append a path segment.
     */
    get baseEndpoint(): string;
    /**
     * Returns the three standard Tracelit request headers that are sent with
     * every OTLP export request.
     */
    exportHeaders(): Record<string, string>;
}

declare const VERSION = "0.1.0";
/**
 * Sets up the OpenTelemetry MeterProvider with an OTLP/HTTP exporter and
 * registers it globally. Called once from Instrumentation.setup().
 *
 * Export interval: 60 000 ms (mirrors the Ruby SDK).
 * Export timeout: 10 000 ms.
 *
 * Auto-pollers installed:
 *  - process.memory.rss   — polled every 60 s
 *  - process.event_loop.lag — polled every 30 s
 */
declare function setup(endpoint: string, headers: Record<string, string>, resource: Resource, serviceName: string): void;
/** @internal — used in tests to tear down state between runs. */
declare function reset(): void;
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
declare function counter(name: string, options?: InstrumentOptions): Counter | null;
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
declare function histogram(name: string, options?: InstrumentOptions): Histogram | null;
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
declare function gauge(name: string, options?: InstrumentOptions): Gauge | null;
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
declare function observableGauge(name: string, options?: InstrumentOptions): ObservableGauge | null;
/**
 * Polls process RSS memory every 60 seconds on an unref'd timer so it
 * does not prevent the Node.js process from exiting.
 *
 * Emits: process.memory.rss (MB)
 * Attributes: process.pid, process.runtime
 */
declare function installMemoryPoller(): NodeJS.Timeout | null;
/**
 * Polls event loop lag every 30 seconds. Uses a self-measuring setInterval:
 * the actual elapsed time vs the scheduled delay gives the lag.
 *
 * Emits: process.event_loop.lag (ms)
 * Attributes: process.pid, process.runtime
 */
declare function installEventLoopLagPoller(): NodeJS.Timeout | null;
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
declare function expressMetricsMiddleware(): (req: ExpressRequest, res: ExpressResponse, next: () => void) => void;
interface ExpressRequest {
    method?: string;
    path?: string;
    url?: string;
    route?: {
        path?: string;
    };
}
interface ExpressResponse {
    statusCode: number;
    on(event: "finish", listener: () => void): this;
}

declare const Metrics_VERSION: typeof VERSION;
declare const Metrics_counter: typeof counter;
declare const Metrics_expressMetricsMiddleware: typeof expressMetricsMiddleware;
declare const Metrics_gauge: typeof gauge;
declare const Metrics_histogram: typeof histogram;
declare const Metrics_installEventLoopLagPoller: typeof installEventLoopLagPoller;
declare const Metrics_installMemoryPoller: typeof installMemoryPoller;
declare const Metrics_observableGauge: typeof observableGauge;
declare const Metrics_reset: typeof reset;
declare const Metrics_setup: typeof setup;
declare namespace Metrics {
  export { Metrics_VERSION as VERSION, Metrics_counter as counter, Metrics_expressMetricsMiddleware as expressMetricsMiddleware, Metrics_gauge as gauge, Metrics_histogram as histogram, Metrics_installEventLoopLagPoller as installEventLoopLagPoller, Metrics_installMemoryPoller as installMemoryPoller, Metrics_observableGauge as observableGauge, Metrics_reset as reset, Metrics_setup as setup };
}

/**
 * ErrorAlwaysOnSampler wraps a ratio-based sampler and upgrades NOT_RECORD
 * decisions to RECORD. This guarantees that span processors — and in
 * particular ErrorSpanProcessor — fire onEnd for every span, even those
 * outside the configured sampling ratio.
 *
 * Without this, TraceIdRatioBasedSampler(0) returns NOT_RECORD, which causes
 * the SDK to produce NonRecordingSpans that bypass the processor pipeline
 * entirely, so ErrorSpanProcessor.onEnd is never called.
 *
 * With RECORD (not RECORD_AND_SAMPLED):
 *  - Real spans are created and all processors fire.
 *  - BatchSpanProcessor skips them because traceFlags.SAMPLED is not set.
 *  - ErrorSpanProcessor sees them and exports any that finish with ERROR status.
 */
declare class ErrorAlwaysOnSampler implements Sampler {
    private readonly inner;
    constructor(rate: number);
    shouldSample(context: Context, traceId: string, spanName: string, spanKind: SpanKind, attributes: Attributes, links: Link[]): SamplingResult;
    toString(): string;
}

/**
 * ErrorSpanProcessor ensures error spans are always exported regardless of
 * the sampling decision made at span creation time.
 *
 * How it works:
 * - ErrorAlwaysOnSampler returns RECORD (not NOT_RECORD) for unsampled spans,
 *   which ensures onEnd is called for every span.
 * - On span end, if the span has status ERROR, this processor forces it through
 *   the exporter directly, bypassing the BatchSpanProcessor.
 * - BatchSpanProcessor ignores RECORD spans (traceFlags.SAMPLED === false),
 *   so there is no double-export for sampled error spans.
 *
 * NOTE: shutdown() is intentionally a no-op because this processor shares the
 * exporter instance with BatchSpanProcessor, which owns the exporter lifecycle.
 */
declare class ErrorSpanProcessor implements SpanProcessor {
    private readonly exporter;
    constructor(exporter: SpanExporter);
    onStart(_span: Span, _parentContext: Context): void;
    onEnd(span: ReadableSpan): void;
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
}

/**
 * installConsoleBridge patches the global `console` so that every
 * `console.debug/log/info/warn/error` call is also forwarded to the OTel
 * LoggerProvider as a LogRecord.
 *
 * The original console output is preserved by default (preserveOriginal: true).
 * Trace correlation is automatic — the active OTel context is attached to
 * every log record, so `trace_id` and `span_id` are populated whenever a
 * span is active.
 *
 * Returns a cleanup function that restores the original console methods.
 */
declare function installConsoleBridge(loggerProvider: LoggerProvider, options?: ConsoleBridgeOptions): () => void;
/**
 * WinstonTransport is a Winston transport that forwards log entries to the
 * OTel LoggerProvider. Add it alongside your existing transports so the
 * original output is preserved:
 *
 * @example
 * ```ts
 * import winston from "winston";
 * import { WinstonTransport } from "tracelit";
 *
 * const logger = winston.createLogger({
 *   transports: [
 *     new winston.transports.Console(),
 *     new WinstonTransport(loggerProvider),
 *   ],
 * });
 * ```
 */
declare class WinstonTransport {
    private readonly otelLogger;
    name: string;
    /**
     * Severity mapping for Winston level strings.
     * Winston levels: error(0) warn(1) info(2) http(3) verbose(4) debug(5) silly(6)
     */
    private static readonly LEVEL_MAP;
    private static readonly LEVEL_TEXT_MAP;
    constructor(loggerProvider: LoggerProvider);
    /**
     * Called by Winston for each log entry. Compatible with the Winston
     * Transport interface (duck-typed, no winston peer dependency at runtime).
     */
    log(info: {
        level: string;
        message: string;
        [key: string]: unknown;
    }, callback: () => void): void;
}
/**
 * createPinoDestination returns a Pino-compatible writable destination stream
 * that forwards every parsed log line to the OTel LoggerProvider.
 *
 * Use it as a Pino `destination` or as one target in a `pino.multistream`:
 *
 * @example
 * ```ts
 * import pino from "pino";
 * import { createPinoDestination } from "tracelit";
 *
 * const otelDest = createPinoDestination(loggerProvider);
 *
 * // Forward to both stdout and OTel:
 * const logger = pino(pino.multistream([
 *   { stream: process.stdout },
 *   { stream: otelDest },
 * ]));
 * ```
 */
declare function createPinoDestination(loggerProvider: LoggerProvider): NodeJS.WritableStream;

/**
 * Tracelit Node.js SDK
 *
 * Drop-in OpenTelemetry instrumentation for Node.js applications.
 * Sends traces, metrics, and logs to the Tracelit ingest API via OTLP/HTTP.
 *
 * @example
 * ```ts
 * import Tracelit from "tracelit";
 *
 * // Must be called before any other imports that require instrumentation.
 * Tracelit.configure((config) => {
 *   config.apiKey      = process.env.TRACELIT_API_KEY;
 *   config.serviceName = "payments-api";
 *   config.environment = process.env.NODE_ENV ?? "production";
 *   config.sampleRate  = 1.0;
 * });
 * Tracelit.start();
 *
 * // Manual spans:
 * Tracelit.tracer.startActiveSpan("process_payment", (span) => {
 *   span.setAttribute("payment.id", id);
 *   doWork();
 *   span.end();
 * });
 *
 * // Custom metrics:
 * const orders = Tracelit.metrics.counter("orders.placed", { unit: "{orders}" });
 * orders?.add(1, { currency: "USD" });
 * ```
 */

/**
 * Tracelit namespace — the primary entry point for configuring and using
 * the SDK. All methods are safe to call before `start()`.
 */
declare const Tracelit: {
    /**
     * Apply configuration options. The callback receives a mutable
     * Configuration instance. Call this before `start()`.
     *
     * @example
     * ```ts
     * Tracelit.configure((config) => {
     *   config.apiKey      = process.env.TRACELIT_API_KEY;
     *   config.serviceName = "my-service";
     *   config.sampleRate  = 0.1;
     * });
     * ```
     */
    readonly configure: (fn: (config: Configuration) => void) => void;
    /**
     * Returns the current Configuration instance. Useful for reading resolved
     * values after `configure()` has been called.
     */
    readonly config: Configuration;
    /**
     * Initialises all OTel SDK components (tracer provider, logger provider,
     * meter provider) and begins exporting telemetry to Tracelit.
     *
     * Idempotent — safe to call multiple times; subsequent calls are no-ops.
     * Returns immediately when `config.enabled` is false.
     *
     * **Important:** call `start()` at the very top of your application entry
     * file, before importing any modules that should be auto-instrumented
     * (Express, Mongoose, Redis, etc.).
     */
    readonly start: () => void;
    /**
     * An OpenTelemetry Tracer scoped to this service. Use for manual
     * instrumentation of custom operations.
     *
     * @example
     * ```ts
     * Tracelit.tracer.startActiveSpan("process_order", (span) => {
     *   span.setAttribute("order.id", order.id);
     *   const result = processOrder(order);
     *   span.end();
     *   return result;
     * });
     * ```
     */
    readonly tracer: Tracer;
    /**
     * The Tracelit metrics interface. Use for manual counter, histogram, and
     * gauge instrumentation.
     *
     * All methods return null when the SDK has not been started or is disabled,
     * so callers using optional chaining (`?.add(...)`) are safe at all times.
     *
     * @example
     * ```ts
     * const counter = Tracelit.metrics.counter("payments.processed");
     * counter?.add(1, { currency: "USD" });
     * ```
     */
    readonly metrics: typeof Metrics;
    /**
     * The OTel Logger for this service. Can be used to emit structured log
     * records directly — most users will prefer the console bridge or a
     * Winston/Pino integration instead.
     */
    readonly logger: Logger;
    /**
     * Returns an Express-compatible middleware that records HTTP server metrics.
     * Attach it early in your middleware stack to capture all requests.
     *
     * @example
     * ```ts
     * const app = express();
     * app.use(Tracelit.expressMetricsMiddleware());
     * ```
     */
    readonly expressMetricsMiddleware: typeof expressMetricsMiddleware;
    /**
     * @internal — exposed for testing purposes only. Resets the SDK to its
     * unconfigured state so tests can re-initialise with fresh configuration.
     */
    readonly _reset: () => void;
};

export { Configuration, type ConsoleBridgeOptions, ErrorAlwaysOnSampler, ErrorSpanProcessor, type InstrumentOptions, type TraceLitConfig, Metrics as TraceLitMetrics, WinstonTransport, createPinoDestination, Tracelit as default, installConsoleBridge };
