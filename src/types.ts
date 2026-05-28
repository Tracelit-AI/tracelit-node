import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { Logger } from "@opentelemetry/api-logs";

/**
 * All configurable options for the Tracelit SDK.
 * Every field can be set programmatically or via the corresponding
 * environment variable. Programmatic values take precedence over env vars.
 */
export interface TraceLitConfig {
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

  /**
   * If true, the SDK installs `process.on('uncaughtException')` and
   * `process.on('unhandledRejection')` handlers that record the error as a
   * span before the process exits.
   *
   * **Off by default** because registering these handlers overrides Node's
   * built-in crash behaviour (which prints the stack trace and exits with
   * code 1). Enable only if you understand the trade-off.
   *
   * When enabled the SDK uses `process.prependListener` so other listeners
   * — including Node's default if no other handler exists — still run, and
   * the export is fired-and-forgotten so the process is never delayed.
   *
   * Env: TRACELIT_CAPTURE_UNCAUGHT_EXCEPTIONS. Default: false
   */
  captureUncaughtExceptions: boolean;
}

/** Options for creating a manual metric instrument. */
export interface InstrumentOptions {
  /** Human-readable description of what this instrument measures. */
  description?: string;
  /** UCUM unit string, e.g. "ms", "MB", "{requests}". */
  unit?: string;
}

/** Options for the console logger bridge. */
export interface ConsoleBridgeOptions {
  /**
   * Whether to preserve the original console output after forwarding to OTel.
   * Default: true
   */
  preserveOriginal?: boolean;
}

/** Internal: an OTel SpanExporter instance + its owning provider reference. */
export interface ExporterRef {
  exporter: SpanExporter;
}

/** Internal: the resolved logger instance after SDK setup. */
export interface LoggerRef {
  logger: Logger;
}
