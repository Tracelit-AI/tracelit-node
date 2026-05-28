import { trace, SpanStatusCode } from "@opentelemetry/api";
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

export const SDK_VERSION = "0.2.3";

/**
 * Modules that require auto-instrumentation hooks to be installed BEFORE
 * they are loaded. If any of these are already in `require.cache` when
 * `setup()` runs, OpenTelemetry cannot patch them and the corresponding
 * spans (HTTP server, DB client, etc.) will silently never be produced.
 */
const HOT_INSTRUMENTED_MODULES = [
  "express",
  "express-winston",
  "koa",
  "fastify",
  "@hapi/hapi",
  "@nestjs/core",
  "http",
  "https",
  "pg",
  "mysql",
  "mysql2",
  "mongodb",
  "redis",
  "ioredis",
  "@grpc/grpc-js",
] as const;

/** Internal setup state — reset via reset() for tests. */
let configured = false;
let tracerProviderRef: NodeTracerProvider | null = null;
let loggerProviderRef: LoggerProvider | null = null;
let exitHandlersInstalled = false;

/**
 * Sets up all OTel SDK components for the Tracelit SDK:
 *   1. NodeTracerProvider with BatchSpanProcessor + ErrorSpanProcessor
 *   2. Auto-instrumentation for all installed libraries
 *   3. LoggerProvider with BatchLogRecordProcessor → console bridge
 *   4. MeterProvider with PeriodicMetricReader
 *   5. Process-exit + crash handlers that flush pending telemetry
 *
 * Idempotent — safe to call multiple times; subsequent calls are no-ops.
 * Returns immediately if `config.enabled` is false. On configuration errors
 * the SDK disables itself with a console warning instead of throwing, so the
 * host application keeps running.
 */
export function setup(config: Configuration): void {
  if (configured) return;
  if (!config.enabled) return;

  const errors = config.collectValidationErrors();
  if (errors.length > 0) {
    console.warn(`[Tracelit] disabled — ${errors.join(", ")}`);
    return;
  }

  warnIfLoadedLate();

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

  installExitHandlers(config);

  configured = true;
}

/**
 * Detects the very common pitfall where the SDK is required AFTER express
 * (or other instrumented modules) and prints a loud warning. The user's
 * tracing will be broken until they move the SDK require to the top of
 * their entrypoint (or use `node -r`).
 */
function warnIfLoadedLate(): void {
  const alreadyLoaded: string[] = [];
  for (const mod of HOT_INSTRUMENTED_MODULES) {
    try {
      const resolved = require.resolve(mod);
      if (require.cache[resolved]) alreadyLoaded.push(mod);
    } catch {
      // Module not installed — fine.
    }
  }
  // Always skip 'http'/'https' from the warning because Node loads them
  // implicitly for many built-ins; their presence isn't a reliable signal.
  const externals = alreadyLoaded.filter((m) => m !== "http" && m !== "https");
  if (externals.length === 0) return;

  console.warn(
    "\x1b[33m" +
      "[Tracelit] ⚠️  SDK was loaded AFTER these modules: " +
      externals.join(", ") +
      "\n" +
      "           HTTP server spans and DB client spans will NOT be captured.\n" +
      "           Fix: move the Tracelit require/import to be the FIRST line of\n" +
      "           your entrypoint, BEFORE any other require/import. Recommended:\n" +
      "             node -r ./tracelit-init.js app.js" +
      "\x1b[0m",
  );
}

/** @internal — used in tests to reset state between runs. */
export function reset(): void {
  configured = false;
  tracerProviderRef = null;
  loggerProviderRef = null;
  exitHandlersInstalled = false;
  Metrics.reset();
}

/**
 * Flush all buffered telemetry (traces, logs, metrics) to the exporters.
 * Called by exit / crash handlers and exposed for advanced users who need
 * a forced flush (e.g. serverless handlers right before returning).
 */
export async function flush(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (tracerProviderRef) tasks.push(tracerProviderRef.forceFlush().catch(() => undefined));
  if (loggerProviderRef) tasks.push(loggerProviderRef.forceFlush().catch(() => undefined));
  tasks.push(Metrics.flush().catch(() => undefined));
  await Promise.all(tasks);
}

/**
 * Shutdown all providers (calls forceFlush then closes exporters). Used by
 * the SIGTERM handler so long-running pods get a clean drain on rolling
 * deploys. Safe to call multiple times.
 */
export async function shutdown(): Promise<void> {
  await flush();
  const tasks: Promise<unknown>[] = [];
  if (tracerProviderRef) tasks.push(tracerProviderRef.shutdown().catch(() => undefined));
  if (loggerProviderRef) tasks.push(loggerProviderRef.shutdown().catch(() => undefined));
  await Promise.all(tasks);
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
  tracerProviderRef = tracerProvider;

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
  loggerProviderRef = loggerProvider;

  // Install the console bridge after the provider is ready.
  installConsoleBridge(loggerProvider);
}

/**
 * Install process-level handlers for graceful telemetry shutdown.
 *
 * Always installed (safe — these only fire on intentional exits):
 *   • `SIGTERM` / `SIGINT` — orchestrator (k8s, pm2, systemd) shutdown
 *   • `beforeExit`         — normal event-loop drain, last-chance flush
 *
 * Opt-in via `config.captureUncaughtExceptions`:
 *   • `uncaughtException`  — record the error as a span
 *   • `unhandledRejection` — record the rejection as a span
 *
 * Important design notes:
 *   - We NEVER block the event loop awaiting flush. The flush is fire-and-
 *     forget, so an unreachable ingest endpoint can never freeze the host
 *     application.
 *   - We use `process.prependListener` so other listeners — including
 *     Node's built-in default which prints the stack and exits — still run
 *     exactly as they would without the SDK.
 *   - We do NOT call setImmediate(throw) to "rethrow" the error after a
 *     flush, because that delays the original stack trace by the flush
 *     duration (up to BatchSpanProcessor's 30s timeout) and can mask the
 *     real cause of the crash.
 */
function installExitHandlers(config: Configuration): void {
  if (exitHandlersInstalled) return;
  exitHandlersInstalled = true;

  // `beforeExit` fires when the event loop empties — safe to flush here.
  process.on("beforeExit", () => {
    void flush();
  });

  // SIGTERM/SIGINT — graceful shutdown path. We do NOT call process.exit or
  // re-raise the signal because that would interfere with the host
  // application's own signal handlers. The host is responsible for exiting;
  // we just attempt to drain telemetry.
  const handleSignal = () => {
    void shutdown();
  };
  process.once("SIGTERM", handleSignal);
  process.once("SIGINT", handleSignal);

  // Crash capture is opt-in. When OFF (default), Node's built-in behaviour
  // is preserved: an uncaught exception prints the stack and exits with
  // code 1 — exactly as in vanilla Node.
  if (!config.captureUncaughtExceptions) return;

  // `prependListener` runs BEFORE other listeners (including Node's
  // default fatal-exception handler when no other listener exists). We
  // record the span and return synchronously; the flush happens in the
  // background and the original Node behaviour proceeds unmodified.
  process.prependListener("uncaughtException", (err) => {
    try {
      recordCrashAsSpan(err, "uncaughtException");
    } catch {
      // The crash handler must never crash. Swallow.
    }
    // Fire-and-forget: do NOT await, do NOT delay the exception.
    void flush();
  });

  process.prependListener("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    try {
      recordCrashAsSpan(err, "unhandledRejection");
    } catch {
      // never crash the crash handler
    }
    void flush();
  });
}

/**
 * Open a one-off ERROR span describing a crash and end it immediately.
 * The ErrorSpanProcessor + BatchSpanProcessor will pick it up on the next
 * flush — which we trigger explicitly from the caller.
 */
function recordCrashAsSpan(err: Error, source: string): void {
  if (!tracerProviderRef) return;
  const tracer = tracerProviderRef.getTracer("tracelit-crash", SDK_VERSION);
  const span = tracer.startSpan(source);
  span.recordException(err);
  span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  span.setAttribute("error.source", source);
  span.setAttribute("error.type", err.name);
  span.setAttribute("error.message", err.message);
  if (err.stack) span.setAttribute("exception.stacktrace", err.stack);
  span.end();
}

