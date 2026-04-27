import { context, SpanStatusCode, TraceFlags, metrics, trace } from '@opentelemetry/api';
import { SeverityNumber, logs } from '@opentelemetry/api-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SEMRESATTRS_DEPLOYMENT_ENVIRONMENT, SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ParentBasedSampler, NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { TraceIdRatioBasedSampler, SamplingDecision } from '@opentelemetry/sdk-trace-base';
import { PeriodicExportingMetricReader, MeterProvider } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';

var __defProp = Object.defineProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/configuration.ts
var DEFAULT_ENDPOINT = "https://ingest.tracelit.app";
var Configuration = class {
  constructor() {
    this.apiKey = process.env["TRACELIT_API_KEY"];
    this.serviceName = process.env["TRACELIT_SERVICE_NAME"];
    this.environment = process.env["TRACELIT_ENVIRONMENT"] ?? "production";
    this.endpoint = process.env["TRACELIT_ENDPOINT"] ?? DEFAULT_ENDPOINT;
    this.sampleRate = parseSampleRate(process.env["TRACELIT_SAMPLE_RATE"]);
    this.enabled = process.env["TRACELIT_ENABLED"] !== "false";
    this.resourceAttributes = {};
  }
  /**
   * Validates that all required fields are present and within acceptable ranges.
   * Throws a descriptive Error on the first validation failure found.
   */
  validate() {
    if (!this.apiKey) {
      throw new Error(
        "Tracelit: config.apiKey is required. Set it programmatically or via the TRACELIT_API_KEY environment variable."
      );
    }
    if (!this.serviceName) {
      throw new Error(
        "Tracelit: config.serviceName is required. Set it programmatically or via the TRACELIT_SERVICE_NAME environment variable."
      );
    }
    if (this.sampleRate < 0 || this.sampleRate > 1) {
      throw new Error(
        `Tracelit: config.sampleRate must be between 0.0 and 1.0, got ${this.sampleRate}.`
      );
    }
  }
  /**
   * Returns the effective service name. Falls back to "unknown-service" when
   * serviceName is not set — callers that need a validated name should call
   * validate() first.
   */
  resolvedServiceName() {
    if (this.serviceName && this.serviceName.trim().length > 0) {
      return this.serviceName.trim();
    }
    return "unknown-service";
  }
  /**
   * Convenience getter: returns the trailing-slash-free base URL so callers
   * can safely append a path segment.
   */
  get baseEndpoint() {
    return this.endpoint.replace(/\/+$/, "");
  }
  /**
   * Returns the three standard Tracelit request headers that are sent with
   * every OTLP export request.
   */
  exportHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey ?? ""}`,
      "X-Service-Name": this.resolvedServiceName(),
      "X-Environment": this.environment
    };
  }
};
function parseSampleRate(raw) {
  if (raw === void 0) return 1;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 1;
}

// node_modules/@opentelemetry/instrumentation/build/esm/autoLoaderUtils.js
function enableInstrumentations(instrumentations, tracerProvider, meterProvider, loggerProvider) {
  for (let i = 0, j = instrumentations.length; i < j; i++) {
    const instrumentation = instrumentations[i];
    if (tracerProvider) {
      instrumentation.setTracerProvider(tracerProvider);
    }
    if (meterProvider) {
      instrumentation.setMeterProvider(meterProvider);
    }
    if (loggerProvider && instrumentation.setLoggerProvider) {
      instrumentation.setLoggerProvider(loggerProvider);
    }
    if (!instrumentation.getConfig().enabled) {
      instrumentation.enable();
    }
  }
}
function disableInstrumentations(instrumentations) {
  instrumentations.forEach((instrumentation) => instrumentation.disable());
}

// node_modules/@opentelemetry/instrumentation/build/esm/autoLoader.js
function registerInstrumentations(options) {
  const tracerProvider = options.tracerProvider || trace.getTracerProvider();
  const meterProvider = options.meterProvider || metrics.getMeterProvider();
  const loggerProvider = options.loggerProvider || logs.getLoggerProvider();
  const instrumentations = options.instrumentations?.flat() ?? [];
  enableInstrumentations(instrumentations, tracerProvider, meterProvider, loggerProvider);
  return () => {
    disableInstrumentations(instrumentations);
  };
}
var ErrorAlwaysOnSampler = class {
  constructor(rate) {
    this.inner = new TraceIdRatioBasedSampler(rate);
  }
  shouldSample(context, traceId, spanName, spanKind, attributes, links) {
    const sampler = this.inner;
    const result = sampler.shouldSample(
      context,
      traceId,
      spanName,
      spanKind,
      attributes,
      links
    );
    if (result.decision !== SamplingDecision.NOT_RECORD) {
      return result;
    }
    const upgraded = { decision: SamplingDecision.RECORD };
    if (result.attributes !== void 0) upgraded.attributes = result.attributes;
    if (result.traceState !== void 0) upgraded.traceState = result.traceState;
    return upgraded;
  }
  toString() {
    return `ErrorAlwaysOnSampler{${this.inner.toString()}}`;
  }
};

// node_modules/@opentelemetry/core/build/esm/ExportResult.js
var ExportResultCode;
(function(ExportResultCode2) {
  ExportResultCode2[ExportResultCode2["SUCCESS"] = 0] = "SUCCESS";
  ExportResultCode2[ExportResultCode2["FAILED"] = 1] = "FAILED";
})(ExportResultCode || (ExportResultCode = {}));

// src/error-span-processor.ts
var ErrorSpanProcessor = class {
  constructor(exporter) {
    this.exporter = exporter;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onStart(_span, _parentContext) {
  }
  onEnd(span) {
    try {
      if (span.status.code !== SpanStatusCode.ERROR) return;
      if (span.spanContext().traceFlags & TraceFlags.SAMPLED) return;
      this.exporter.export([span], (result) => {
        if (result.code === ExportResultCode.FAILED) {
        }
      });
    } catch {
    }
  }
  forceFlush() {
    return this.exporter.forceFlush?.() ?? Promise.resolve();
  }
  shutdown() {
    return Promise.resolve();
  }
};
var VERSION = "0.1.0";
var CONSOLE_SEVERITY = {
  debug: SeverityNumber.DEBUG,
  log: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR
};
var CONSOLE_SEVERITY_TEXT = {
  debug: "DEBUG",
  log: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR"
};
function installConsoleBridge(loggerProvider, options = {}) {
  const { preserveOriginal = true } = options;
  const otelLogger = loggerProvider.getLogger("console", VERSION);
  const methods = ["debug", "log", "info", "warn", "error"];
  const originals = {};
  for (const method of methods) {
    const original = console[method].bind(console);
    originals[method] = original;
    console[method] = (...args) => {
      if (preserveOriginal) {
        original(...args);
      }
      try {
        const body = args.map(
          (a) => typeof a === "string" ? a : safeStringify(a)
        ).join(" ");
        otelLogger.emit({
          timestamp: Date.now(),
          severityNumber: CONSOLE_SEVERITY[method],
          severityText: CONSOLE_SEVERITY_TEXT[method],
          body,
          context: context.active()
        });
      } catch {
      }
    };
  }
  return function restore() {
    for (const method of methods) {
      console[method] = originals[method];
    }
  };
}
var WinstonTransport = class _WinstonTransport {
  constructor(loggerProvider) {
    this.name = "TraceLitWinstonTransport";
    this.otelLogger = loggerProvider.getLogger("winston", VERSION);
  }
  static {
    /**
     * Severity mapping for Winston level strings.
     * Winston levels: error(0) warn(1) info(2) http(3) verbose(4) debug(5) silly(6)
     */
    this.LEVEL_MAP = {
      error: SeverityNumber.ERROR,
      warn: SeverityNumber.WARN,
      info: SeverityNumber.INFO,
      http: SeverityNumber.INFO,
      verbose: SeverityNumber.DEBUG,
      debug: SeverityNumber.DEBUG,
      silly: SeverityNumber.TRACE
    };
  }
  static {
    this.LEVEL_TEXT_MAP = {
      error: "ERROR",
      warn: "WARN",
      info: "INFO",
      http: "INFO",
      verbose: "DEBUG",
      debug: "DEBUG",
      silly: "TRACE"
    };
  }
  /**
   * Called by Winston for each log entry. Compatible with the Winston
   * Transport interface (duck-typed, no winston peer dependency at runtime).
   */
  log(info, callback) {
    try {
      const { level, message, ...rest } = info;
      const severityNumber = _WinstonTransport.LEVEL_MAP[level] ?? SeverityNumber.INFO;
      const severityText = _WinstonTransport.LEVEL_TEXT_MAP[level] ?? "INFO";
      const attributes = {};
      for (const [k, v] of Object.entries(rest)) {
        if (typeof v === "string") {
          attributes[k] = v;
        } else if (v !== void 0 && v !== null) {
          attributes[k] = safeStringify(v);
        }
      }
      this.otelLogger.emit({
        timestamp: Date.now(),
        severityNumber,
        severityText,
        body: message,
        attributes,
        context: context.active()
      });
    } catch {
    } finally {
      callback();
    }
  }
};
function createPinoDestination(loggerProvider) {
  const otelLogger = loggerProvider.getLogger("pino", VERSION);
  const pinoLevelToSeverity = (level) => {
    if (level >= 60) return SeverityNumber.FATAL;
    if (level >= 50) return SeverityNumber.ERROR;
    if (level >= 40) return SeverityNumber.WARN;
    if (level >= 30) return SeverityNumber.INFO;
    if (level >= 20) return SeverityNumber.DEBUG;
    return SeverityNumber.TRACE;
  };
  const pinoLevelToText = (level) => {
    if (level >= 60) return "FATAL";
    if (level >= 50) return "ERROR";
    if (level >= 40) return "WARN";
    if (level >= 30) return "INFO";
    if (level >= 20) return "DEBUG";
    return "TRACE";
  };
  const writable = new (__require("stream")).Writable({
    objectMode: false,
    write(chunk, _encoding, done) {
      try {
        const line = chunk.toString().trim();
        if (!line) {
          done();
          return;
        }
        const parsed = JSON.parse(line);
        const { level = 30, msg = "", time, ...rest } = parsed;
        const attributes = {};
        for (const [k, v] of Object.entries(rest)) {
          if (typeof v === "string") {
            attributes[k] = v;
          } else if (v !== void 0 && v !== null) {
            attributes[k] = safeStringify(v);
          }
        }
        otelLogger.emit({
          timestamp: time ?? Date.now(),
          severityNumber: pinoLevelToSeverity(level),
          severityText: pinoLevelToText(level),
          body: msg,
          attributes,
          context: context.active()
        });
      } catch {
      }
      done();
    }
  });
  return writable;
}
function safeStringify(value) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// src/metrics.ts
var metrics_exports = {};
__export(metrics_exports, {
  VERSION: () => VERSION2,
  counter: () => counter,
  expressMetricsMiddleware: () => expressMetricsMiddleware,
  gauge: () => gauge,
  histogram: () => histogram,
  installEventLoopLagPoller: () => installEventLoopLagPoller,
  installMemoryPoller: () => installMemoryPoller,
  observableGauge: () => observableGauge,
  reset: () => reset,
  setup: () => setup
});
var VERSION2 = "0.1.0";
var meter = null;
var provider = null;
function setup(endpoint, headers, resource, serviceName) {
  if (meter !== null) return;
  try {
    const exporter = new OTLPMetricExporter({
      url: `${endpoint}/v1/metrics`,
      headers
    });
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 6e4,
      exportTimeoutMillis: 1e4
    });
    provider = new MeterProvider({
      resource,
      readers: [reader]
    });
    metrics.setGlobalMeterProvider(provider);
    meter = provider.getMeter(serviceName, VERSION2);
    installMemoryPoller();
    installEventLoopLagPoller();
  } catch (err) {
    console.warn(
      `Tracelit: failed to set up metrics: ${err.message}`
    );
  }
}
function reset() {
  meter = null;
  if (provider) {
    provider.shutdown().catch(() => void 0);
    provider = null;
  }
}
function counter(name, options = {}) {
  if (!meter) return null;
  return meter.createCounter(name, {
    description: options.description ?? "",
    unit: options.unit ?? ""
  });
}
function histogram(name, options = {}) {
  if (!meter) return null;
  return meter.createHistogram(name, {
    description: options.description ?? "",
    unit: options.unit ?? ""
  });
}
function gauge(name, options = {}) {
  if (!meter) return null;
  return meter.createGauge(name, {
    description: options.description ?? "",
    unit: options.unit ?? ""
  });
}
function observableGauge(name, options = {}) {
  if (!meter) return null;
  return meter.createObservableGauge(name, {
    description: options.description ?? "",
    unit: options.unit ?? ""
  });
}
function installMemoryPoller() {
  if (!meter) return null;
  const rssGauge = meter.createGauge("process.memory.rss", {
    description: "Process resident set size (RSS)",
    unit: "MB"
  });
  const pid = String(process.pid);
  const timer = setInterval(() => {
    try {
      const rssMb = process.memoryUsage().rss / (1024 * 1024);
      rssGauge.record(rssMb, {
        "process.pid": pid,
        "process.runtime": "nodejs"
      });
    } catch {
    }
  }, 6e4);
  timer.unref();
  return timer;
}
function installEventLoopLagPoller() {
  if (!meter) return null;
  const lagHistogram = meter.createHistogram("process.event_loop.lag", {
    description: "Node.js event loop lag",
    unit: "ms"
  });
  const pid = String(process.pid);
  const INTERVAL_MS = 3e4;
  let lastTick = Date.now();
  const timer = setInterval(() => {
    try {
      const now = Date.now();
      const lag = Math.max(0, now - lastTick - INTERVAL_MS);
      lastTick = now;
      lagHistogram.record(lag, {
        "process.pid": pid,
        "process.runtime": "nodejs"
      });
    } catch {
    }
  }, INTERVAL_MS);
  timer.unref();
  return timer;
}
function expressMetricsMiddleware() {
  if (!meter) {
    return (_req, _res, next) => next();
  }
  const requestCounter = meter.createCounter("http.server.request.count", {
    description: "Total HTTP requests processed",
    unit: "{requests}"
  });
  const durationHistogram = meter.createHistogram(
    "http.server.request.duration",
    {
      description: "HTTP request duration",
      unit: "ms"
    }
  );
  const errorCounter = meter.createCounter("http.server.error.count", {
    description: "Total HTTP 5xx responses",
    unit: "{errors}"
  });
  return function traceLitMetricsMiddleware(req, res, next) {
    const start = Date.now();
    try {
      res.on("finish", () => {
        try {
          const elapsed = Date.now() - start;
          const attrs = {
            "http.method": req.method ?? "UNKNOWN",
            "http.route": req.route?.path ?? req.path ?? req.url ?? "/",
            "http.status_code": String(res.statusCode)
          };
          requestCounter.add(1, attrs);
          durationHistogram.record(elapsed, attrs);
          if (res.statusCode >= 500) {
            errorCounter.add(1, attrs);
          }
        } catch {
        }
      });
    } catch {
    }
    next();
  };
}

// src/instrumentation.ts
var SDK_VERSION = "0.1.0";
var configured = false;
function setup2(config) {
  if (configured) return;
  if (!config.enabled) return;
  config.validate();
  const serviceName = config.resolvedServiceName();
  const headers = config.exportHeaders();
  const resource = buildResource(config, serviceName);
  setupTraces(config, resource, headers);
  try {
    setupLogs(config, resource, headers);
  } catch (err) {
    console.warn(
      `Tracelit: failed to set up logs: ${err.message}`
    );
  }
  try {
    setup(config.baseEndpoint, headers, resource, serviceName);
  } catch (err) {
    console.warn(
      `Tracelit: failed to set up metrics: ${err.message}`
    );
  }
  configured = true;
}
function reset2() {
  configured = false;
  reset();
}
function buildResource(config, serviceName) {
  return resourceFromAttributes({
    [SEMRESATTRS_SERVICE_NAME]: serviceName,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: config.environment,
    "telemetry.sdk.language": "nodejs",
    "telemetry.sdk.name": detectFramework(),
    "telemetry.sdk.version": SDK_VERSION,
    ...config.resourceAttributes
  });
}
function detectFramework() {
  if (isModulePresent("express")) return "express";
  if (isModulePresent("fastify")) return "fastify";
  if (isModulePresent("koa")) return "koa";
  if (isModulePresent("hapi") || isModulePresent("@hapi/hapi")) return "hapi";
  if (isModulePresent("nestjs/core") || isModulePresent("@nestjs/core"))
    return "nestjs";
  return "nodejs";
}
function isModulePresent(name) {
  try {
    __require.resolve(name);
    return true;
  } catch {
    return false;
  }
}
function setupTraces(config, resource, headers, serviceName) {
  const exporter = new OTLPTraceExporter({
    url: `${config.baseEndpoint}/v1/traces`,
    headers
  });
  const sampler = config.sampleRate < 1 ? new ParentBasedSampler({
    root: new ErrorAlwaysOnSampler(config.sampleRate)
  }) : void 0;
  const tracerProvider = new NodeTracerProvider({
    resource,
    ...sampler !== void 0 ? { sampler } : {},
    spanProcessors: [
      new BatchSpanProcessor(exporter),
      new ErrorSpanProcessor(exporter)
    ]
  });
  tracerProvider.register();
  registerInstrumentations({
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy file system instrumentation by default.
        "@opentelemetry/instrumentation-fs": { enabled: false }
      })
    ],
    tracerProvider
  });
  void trace.getTracerProvider();
}
function setupLogs(config, resource, headers) {
  const logsExporter = new OTLPLogExporter({
    url: `${config.baseEndpoint}/v1/logs`,
    headers
  });
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor(logsExporter)]
  });
  logs.setGlobalLoggerProvider(loggerProvider);
  installConsoleBridge(loggerProvider);
}

// src/index.ts
var SDK_NAME = "tracelit";
var SDK_VERSION2 = "0.1.0";
var _config = new Configuration();
var Tracelit = {
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
  configure(fn) {
    fn(_config);
  },
  /**
   * Returns the current Configuration instance. Useful for reading resolved
   * values after `configure()` has been called.
   */
  get config() {
    return _config;
  },
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
  start() {
    setup2(_config);
  },
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
  get tracer() {
    return trace.getTracer(SDK_NAME, SDK_VERSION2);
  },
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
  get metrics() {
    return metrics_exports;
  },
  /**
   * The OTel Logger for this service. Can be used to emit structured log
   * records directly — most users will prefer the console bridge or a
   * Winston/Pino integration instead.
   */
  get logger() {
    return logs.getLogger(SDK_NAME, SDK_VERSION2);
  },
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
  expressMetricsMiddleware,
  /**
   * @internal — exposed for testing purposes only. Resets the SDK to its
   * unconfigured state so tests can re-initialise with fresh configuration.
   */
  _reset() {
    reset2();
    _config = new Configuration();
  }
};
var index_default = Tracelit;

export { Configuration, ErrorAlwaysOnSampler, ErrorSpanProcessor, metrics_exports as TraceLitMetrics, WinstonTransport, createPinoDestination, index_default as default, installConsoleBridge };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map