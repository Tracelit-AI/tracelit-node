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
    if (!this.apiKey) {
      throw new Error(
        "Tracelit: config.apiKey is required. " +
          "Set it programmatically or via the TRACELIT_API_KEY environment variable.",
      );
    }

    if (!this.serviceName) {
      throw new Error(
        "Tracelit: config.serviceName is required. " +
          "Set it programmatically or via the TRACELIT_SERVICE_NAME environment variable.",
      );
    }

    if (this.sampleRate < 0 || this.sampleRate > 1) {
      throw new Error(
        `Tracelit: config.sampleRate must be between 0.0 and 1.0, got ${this.sampleRate}.`,
      );
    }
  }

  /**
   * Returns the effective service name. Falls back to "unknown-service" when
   * serviceName is not set — callers that need a validated name should call
   * validate() first.
   */
  resolvedServiceName(): string {
    if (this.serviceName && this.serviceName.trim().length > 0) {
      return this.serviceName.trim();
    }
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
