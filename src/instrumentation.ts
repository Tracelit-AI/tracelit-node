import { trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from "@opentelemetry/semantic-conventions";
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
} from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { execFileSync } from "child_process";
import type { Resource } from "@opentelemetry/resources";
import type { Configuration } from "./configuration";
import { ErrorAlwaysOnSampler } from "./error-always-on-sampler";
import { ErrorSpanProcessor } from "./error-span-processor";
import { installConsoleBridge } from "./logger-bridge";
import * as Metrics from "./metrics";

export const SDK_VERSION = "0.1.0";

/** Internal setup state — reset via reset() for tests. */
let configured = false;

/**
 * Sets up all OTel SDK components for the Tracelit SDK:
 *   1. NodeTracerProvider with BatchSpanProcessor + ErrorSpanProcessor
 *   2. Auto-instrumentation for all installed libraries
 *   3. LoggerProvider with BatchLogRecordProcessor → console bridge
 *   4. MeterProvider with PeriodicMetricReader
 *
 * Idempotent — safe to call multiple times; subsequent calls are no-ops.
 * Returns immediately if `config.enabled` is false.
 */
export function setup(config: Configuration): void {
  if (configured) return;
  if (!config.enabled) return;

  config.validate();

  const serviceName = config.resolvedServiceName();
  const headers = config.exportHeaders();
  const resource = buildResource(config, serviceName);

  setupTraces(config, resource, headers, serviceName);

  try {
    setupLogs(config, resource, headers);
  } catch (err) {
    console.warn(
      `Tracelit: failed to set up logs: ${(err as Error).message}`,
    );
  }

  try {
    Metrics.setup(config.baseEndpoint, headers, resource, serviceName);
  } catch (err) {
    console.warn(
      `Tracelit: failed to set up metrics: ${(err as Error).message}`,
    );
  }

  configured = true;
}

/** @internal — used in tests to reset state between runs. */
export function reset(): void {
  configured = false;
  Metrics.reset();
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildResource(
  config: Configuration,
  serviceName: string,
): Resource {
  const attrs: Record<string, string> = {
    [SEMRESATTRS_SERVICE_NAME]: serviceName,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: config.environment,
    "telemetry.sdk.language": "nodejs",
    "telemetry.sdk.name": detectFramework(),
    "telemetry.sdk.version": SDK_VERSION,
    ...config.resourceAttributes,
  };

  // Attach the git commit SHA automatically — no developer config needed.
  // Resolution order mirrors every other Tracelit SDK:
  //   1. Common CI/CD env vars (set by GitHub Actions, Render, GitLab, etc.)
  //   2. `git rev-parse HEAD` — works in local dev and any cloned environment.
  const sha = resolveCommitSha();
  if (sha) {
    attrs["service.commit_sha"] = sha;
  }

  return resourceFromAttributes(attrs);
}

/**
 * Resolves the current git commit SHA with zero developer friction.
 * Checks common CI/CD environment variables first, then falls back to
 * running `git rev-parse HEAD`. Result is not cached here — setup() is
 * already guarded by `configured` so this runs at most once per process.
 */
function resolveCommitSha(): string | undefined {
  const envVars = [
    "GITHUB_SHA",            // GitHub Actions
    "GIT_COMMIT",            // Jenkins, generic
    "GIT_COMMIT_SHA",        // generic
    "SOURCE_COMMIT",         // Heroku
    "HEROKU_SLUG_COMMIT",    // Heroku (slug)
    "RENDER_GIT_COMMIT",     // Render
    "CI_COMMIT_SHA",         // GitLab CI
    "CIRCLE_SHA1",           // CircleCI
    "BITBUCKET_COMMIT",      // Bitbucket Pipelines
    "RAILWAY_GIT_COMMIT_SHA",// Railway
    "FLY_APP_VERSION",       // Fly.io
  ];

  for (const envVar of envVars) {
    const v = process.env[envVar]?.trim();
    if (v && v.length >= 7) return v;
  }

  // Fall back to running git — works in local dev and CI with a cloned repo.
  // execFileSync avoids shell injection and throws on non-zero exit.
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (sha.length >= 7) return sha;
  } catch {
    // git not on PATH, not a git repo, or timed out — skip silently.
  }

  return undefined;
}

/**
 * Detects the web framework in use for the `telemetry.sdk.name` resource
 * attribute. Checked via duck-typed require to avoid hard dependencies.
 */
function detectFramework(): string {
  if (isModulePresent("express")) return "express";
  if (isModulePresent("fastify")) return "fastify";
  if (isModulePresent("koa")) return "koa";
  if (isModulePresent("hapi") || isModulePresent("@hapi/hapi")) return "hapi";
  if (isModulePresent("nestjs/core") || isModulePresent("@nestjs/core"))
    return "nestjs";
  return "nodejs";
}

function isModulePresent(name: string): boolean {
  try {
    // Using require.resolve so we don't actually load the module.
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

function setupTraces(
  config: Configuration,
  resource: Resource,
  headers: Record<string, string>,
  serviceName: string,
): void {
  const exporter = new OTLPTraceExporter({
    url: `${config.baseEndpoint}/v1/traces`,
    headers,
  });

  const sampler =
    config.sampleRate < 1.0
      ? new ParentBasedSampler({
          root: new ErrorAlwaysOnSampler(config.sampleRate),
        })
      : undefined;

  const tracerProvider = new NodeTracerProvider({
    resource,
    ...(sampler !== undefined ? { sampler } : {}),
    spanProcessors: [
      new BatchSpanProcessor(exporter),
      new ErrorSpanProcessor(exporter),
    ],
  });

  tracerProvider.register();

  registerInstrumentations({
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy file system instrumentation by default.
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
    tracerProvider,
  });

  // Surface the tracer provider on the global trace API so Tracelit.tracer works.
  void trace.getTracerProvider(); // ensures global is wired
}

function setupLogs(
  config: Configuration,
  resource: Resource,
  headers: Record<string, string>,
): void {
  const logsExporter = new OTLPLogExporter({
    url: `${config.baseEndpoint}/v1/logs`,
    headers,
  });

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor(logsExporter)],
  });

  logs.setGlobalLoggerProvider(loggerProvider);

  // Install the console bridge after the provider is ready.
  installConsoleBridge(loggerProvider);
}

