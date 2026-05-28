# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.3] - 2026-05-28

### Changes

- chore(release): bump version to 0.2.3 (67044c5)
- fix(sdk-node): make uncaughtException handlers opt-in to prevent app hangs (53f2411)
- chore(release): update CHANGELOG for v0.2.2 (6ab29cd)

[0.2.3]: https://github.com/Tracelit-AI/tracelit-node/compare/v0.2.2...v0.2.3

## [0.2.3] - 2026-05-28

### Fixed

- **Critical: host applications no longer hang on uncaught exceptions.**
  The crash handlers introduced in `0.2.0` awaited `flush()` before allowing
  the exception to propagate, which could freeze the process for up to 30s
  (the BatchSpanProcessor export timeout) on a slow or unreachable ingest
  endpoint. Crash export is now fire-and-forget and never blocks the event
  loop.
- Stack traces from uncaught exceptions are now printed by Node exactly as
  they would be in a vanilla app. Previously, registering an
  `uncaughtException` handler suppressed Node's default crash output.

### Changed

- **`captureUncaughtExceptions` is now opt-in and defaults to `false`.**
  In `0.2.0` we registered `uncaughtException` and `unhandledRejection`
  handlers unconditionally, which changed Node's built-in crash behaviour
  for every customer. The new default preserves vanilla Node semantics;
  set `captureUncaughtExceptions: true` (or `TRACELIT_CAPTURE_UNCAUGHT_EXCEPTIONS=true`)
  to opt back into capturing process-level crashes as spans.
- When crash capture is enabled, the SDK now uses `process.prependListener`
  so the host application's own handlers — and Node's default fatal-error
  handler — continue to run exactly as they would without the SDK.
- `SIGTERM`/`SIGINT` handlers no longer re-raise the signal. The host
  application is responsible for exiting; the SDK only drains telemetry.

### Added

- Load-order detection: when `setup()` runs, the SDK now scans `require.cache`
  for instrumented modules (`express`, `koa`, `fastify`, `pg`, `mysql2`,
  `redis`, etc.) and prints a loud yellow warning if any are already loaded.
  This is the #1 silent failure mode for Node.js OpenTelemetry — the warning
  tells customers exactly how to fix it.

[0.2.3]: https://github.com/Tracelit-AI/tracelit-node/compare/v0.2.2...v0.2.3

## [0.2.2] - 2026-05-28

### Changes

- chore(release): bump version to 0.2.2 (0bf4b05)
- test(sdk-node): cover new flush/shutdown + crash handlers to meet 80% coverage threshold (0990a5f)

[0.2.2]: https://github.com/Tracelit-AI/tracelit-node/compare/v0.2.1...v0.2.2

## [0.2.0] - 2026-05-28

### Added

- Automatic crash capture: `uncaughtException` and `unhandledRejection` are now
  recorded as ERROR spans and flushed to Tracelit before the process exits.
  Customers no longer need to wrap their entry point to get incidents from
  server crashes.
- Graceful shutdown handlers for `SIGTERM`, `SIGINT`, and `beforeExit` —
  in-flight traces, logs, and metrics are flushed on rolling deploys.
- New public APIs:
  - `Tracelit.flush()` — force-drain pending telemetry. Useful in serverless
    handlers and right before manual `process.exit()` calls.
  - `Tracelit.shutdown()` — gracefully close all OpenTelemetry providers.

### Changed

- `Tracelit.start()` no longer throws when configuration is missing.
  Misconfiguration now disables the SDK with a `[Tracelit] disabled — …`
  console warning so it can never crash the host application.
- `serviceName` is no longer required. The SDK falls back to
  `OTEL_SERVICE_NAME`, `SERVICE_NAME`, then `APP_NAME` environment variables
  before defaulting to `"unknown-service"`.

### Fixed

- Pending spans in the `BatchSpanProcessor` queue are now flushed on crash and
  shutdown. Previously these were lost when the process exited, which
  prevented error spans from reaching the Tracelit dashboard.

[0.2.0]: https://github.com/Tracelit-AI/tracelit-node/compare/v0.1.2...v0.2.0

## [0.1.1] - 2026-04-27

### Changes

- fix: correct repository URL to Tracelit-AI org (37451cd)

[0.1.1]: https://github.com/Tracelit-AI/tracelit-node/compare/v0.1.0...v0.1.1

## [0.1.0] - 2026-04-27

### Changes

- fix(release): remove provenance flag (private repo not supported) (fd1d2ee)

[0.1.0]: https://github.com/Tracelit-AI/tracelit-node/compare/v0.1.1...v0.1.0

## [0.1.0] - 2024-04-27

### Added

- Initial release of the official Tracelit Node.js SDK (`@tracelit/sdk`).
- Drop-in OpenTelemetry instrumentation for Node.js apps.
- OTLP/HTTP exporters for traces, metrics, and logs sent to the Tracelit ingest API.
- Auto-instrumentation via `@opentelemetry/auto-instrumentations-node`.
- Optional `pino` and `winston` log bridge support.
- Dual CJS + ESM build output with full TypeScript declarations.
- Supports Node.js >= 18.

[0.1.0]: https://github.com/tracelit/tracelit-node/releases/tag/v0.1.0
