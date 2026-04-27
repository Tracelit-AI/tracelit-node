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

import { trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import type { Tracer } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import { Configuration } from "./configuration";
import * as Instrumentation from "./instrumentation";
import * as Metrics from "./metrics";

export { Configuration } from "./configuration";
export { ErrorAlwaysOnSampler } from "./error-always-on-sampler";
export { ErrorSpanProcessor } from "./error-span-processor";
export {
  installConsoleBridge,
  WinstonTransport,
  createPinoDestination,
} from "./logger-bridge";
export * as TraceLitMetrics from "./metrics";
export type { TraceLitConfig, InstrumentOptions, ConsoleBridgeOptions } from "./types";

const SDK_NAME = "tracelit";
const SDK_VERSION = "0.1.0";

let _config: Configuration = new Configuration();

/**
 * Tracelit namespace — the primary entry point for configuring and using
 * the SDK. All methods are safe to call before `start()`.
 */
const Tracelit = {
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
  configure(fn: (config: Configuration) => void): void {
    fn(_config);
  },

  /**
   * Returns the current Configuration instance. Useful for reading resolved
   * values after `configure()` has been called.
   */
  get config(): Configuration {
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
  start(): void {
    Instrumentation.setup(_config);
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
  get tracer(): Tracer {
    return trace.getTracer(SDK_NAME, SDK_VERSION);
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
  get metrics(): typeof Metrics {
    return Metrics;
  },

  /**
   * The OTel Logger for this service. Can be used to emit structured log
   * records directly — most users will prefer the console bridge or a
   * Winston/Pino integration instead.
   */
  get logger(): Logger {
    return logs.getLogger(SDK_NAME, SDK_VERSION);
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
  expressMetricsMiddleware: Metrics.expressMetricsMiddleware,

  /**
   * @internal — exposed for testing purposes only. Resets the SDK to its
   * unconfigured state so tests can re-initialise with fresh configuration.
   */
  _reset(): void {
    Instrumentation.reset();
    _config = new Configuration();
  },
} as const;

export default Tracelit;
