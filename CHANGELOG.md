# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
