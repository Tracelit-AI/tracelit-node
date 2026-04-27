# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2024-04-27

### Added

- Initial release of the official Tracelit Node.js SDK.
- Drop-in OpenTelemetry instrumentation for Node.js apps.
- OTLP/HTTP exporters for traces, metrics, and logs sent to the Tracelit ingest API.
- Auto-instrumentation via `@opentelemetry/auto-instrumentations-node`.
- Optional `pino` and `winston` log bridge support.
- Dual CJS + ESM build output with full TypeScript declarations.
- Supports Node.js >= 18.

[0.1.0]: https://github.com/tracelit/tracelit-node/releases/tag/v0.1.0
