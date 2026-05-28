import type { TraceLitConfig } from "./types";

const DEFAULT_ENDPOINT = "https://ingest.tracelit.app";

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
export class Configuration implements TraceLitConfig {
  apiKey: string | undefined;
  serviceName: string | undefined;
  environment: string;
  endpoint: string;
  sampleRate: number;
  enabled: boolean;
  resourceAttributes: Record<string, string>;

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
  validate(): void {
    const errors = this.collectValidationErrors();
    if (errors.length > 0) {
      throw new Error("Tracelit: " + errors[0]);
    }
  }

  /**
   * Returns a list of validation errors without throwing. The SDK uses this
   * during start-up so misconfiguration disables telemetry with a warning
   * instead of crashing the host application.
   */
  collectValidationErrors(): string[] {
    const errors: string[] = [];
    if (!this.apiKey) {
      errors.push(
        "config.apiKey is required. Set it programmatically or via the TRACELIT_API_KEY environment variable.",
      );
    }
    if (this.sampleRate < 0 || this.sampleRate > 1) {
      errors.push(
        `config.sampleRate must be between 0.0 and 1.0, got ${this.sampleRate}.`,
      );
    }
    return errors;
  }

  /**
   * Returns the effective service name. Falls back to "unknown-service" when
   * serviceName is not set — telemetry still flows so developers can locate
   * their service in the dashboard and rename it later.
   */
  resolvedServiceName(): string {
    if (this.serviceName && this.serviceName.trim().length > 0) {
      return this.serviceName.trim();
    }
    const envName = process.env["OTEL_SERVICE_NAME"] || process.env["SERVICE_NAME"] || process.env["APP_NAME"];
    if (envName && envName.trim().length > 0) return envName.trim();
    return "unknown-service";
  }

  /**
   * Convenience getter: returns the trailing-slash-free base URL so callers
   * can safely append a path segment.
   */
  get baseEndpoint(): string {
    return this.endpoint.replace(/\/+$/, "");
  }

  /**
   * Returns the three standard Tracelit request headers that are sent with
   * every OTLP export request.
   */
  exportHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey ?? ""}`,
      "X-Service-Name": this.resolvedServiceName(),
      "X-Environment": this.environment,
    };
  }
}

function parseSampleRate(raw: string | undefined): number {
  if (raw === undefined) return 1.0;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 1.0;
}
