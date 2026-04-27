# Tracelit Node.js SDK

Official Node.js SDK for [Tracelit](https://tracelit.io) — drop-in OpenTelemetry instrumentation for Node.js applications. Sends traces, metrics, and logs to the Tracelit ingest API via OTLP/HTTP.

**Requirements:** Node.js >= 18.0.0

---

## Set up with AI

Copy the prompt below and paste it into Cursor, Claude, ChatGPT, or any AI assistant. It contains everything the AI needs to fully integrate Tracelit into your app — package, configuration, manual spans, custom metrics, and logger bridge.

````
You are integrating the Tracelit Node.js SDK into this codebase.

## What Tracelit does
Tracelit is a drop-in OpenTelemetry SDK that sends traces, metrics, and logs
to https://tracelit.io via OTLP/HTTP. It auto-instruments Express, Fastify,
HTTP, database clients, Redis, and more with zero code changes.

## Steps

### 1. Install the package
npm install tracelit
# or: yarn add tracelit / pnpm add tracelit

### 2. Initialise at the top of your entry file
Create a file called tracelit.ts (or tracelit.js) and import it FIRST in your
entry point (before express, mongoose, redis, etc.):

  import Tracelit from "tracelit";

  Tracelit.configure((config) => {
    config.apiKey      = process.env.TRACELIT_API_KEY;
    config.serviceName = "MY_SERVICE_NAME";
    config.environment = process.env.NODE_ENV ?? "production";
    config.sampleRate  = 1.0;
  });
  Tracelit.start();

Then in your entry point (e.g. server.ts):
  import "./tracelit";  // MUST be first
  import express from "express";
  // ...

### 3. Disable in tests
Set TRACELIT_ENABLED=false in your test environment:
  TRACELIT_ENABLED=false npx jest

### 4. Add manual spans (optional)
  Tracelit.tracer.startActiveSpan("describe_the_operation", (span) => {
    span.setAttribute("relevant.attribute", String(value));
    doWork();
    span.end();
  });

### 5. Add custom metrics (optional)
  const counter = Tracelit.metrics.counter("my.event.count", {
    description: "...", unit: "{events}"
  });
  counter?.add(1, { key: "value" });

  const histogram = Tracelit.metrics.histogram("my.operation.duration", {
    description: "...", unit: "ms"
  });
  histogram?.record(elapsed, { service: "stripe" });

### 6. Connect your logger (optional)

  // Winston:
  import { WinstonTransport } from "tracelit";
  const logger = winston.createLogger({
    transports: [new winston.transports.Console(), new WinstonTransport(loggerProvider)],
  });

  // Pino:
  import { createPinoDestination } from "tracelit";
  const logger = pino(pino.multistream([
    { stream: process.stdout },
    { stream: createPinoDestination(loggerProvider) },
  ]));

## What you get automatically (no code required)
- Traces for every HTTP request, database query, Redis call, gRPC call, etc.
- Metrics: process.memory.rss (MB), process.event_loop.lag (ms)
- Error spans always exported even when outside the sample ratio
- Auto-instrumentations for Express, Fastify, HTTP, pg, mysql2, Redis,
  MongoDB, gRPC, GraphQL, Kafka, Prisma, and 30+ more

## Configuration reference
| Option             | Env var                  | Default                        |
|--------------------|--------------------------|--------------------------------|
| apiKey             | TRACELIT_API_KEY         | undefined (required)           |
| serviceName        | TRACELIT_SERVICE_NAME    | undefined (required)           |
| environment        | TRACELIT_ENVIRONMENT     | "production"                   |
| endpoint           | TRACELIT_ENDPOINT        | https://ingest.tracelit.app    |
| sampleRate         | TRACELIT_SAMPLE_RATE     | 1.0                            |
| enabled            | TRACELIT_ENABLED         | true                           |
| resourceAttributes | —                        | {} (extra span/metric tags)    |
````

---

## Installation

```bash
npm install tracelit
# or
yarn add tracelit
pnpm add tracelit
```

---

## Quick start

**Important:** The SDK must be initialised before any other modules that need auto-instrumentation (Express, Mongoose, Redis, etc.). Create a dedicated init file and import it first.

`tracelit.ts` (new file):

```ts
import Tracelit from "tracelit";

Tracelit.configure((config) => {
  config.apiKey      = process.env.TRACELIT_API_KEY;   // required
  config.serviceName = "payments-api";                  // required
  config.environment = process.env.NODE_ENV ?? "production";
  config.sampleRate  = 1.0;
});

Tracelit.start();
```

`server.ts` (entry point):

```ts
import "./tracelit"; // MUST be the very first import
import express from "express";

const app = express();
// ... routes
app.listen(3000);
```

---

## Configuration reference

All options can be set in the `configure` callback or via environment variables.

| Option | Env variable | Default | Description |
|--------|-------------|---------|-------------|
| `apiKey` | `TRACELIT_API_KEY` | `undefined` | **Required.** Your Tracelit ingest API key. |
| `serviceName` | `TRACELIT_SERVICE_NAME` | `undefined` | **Required.** Name of this service as it appears in Tracelit. |
| `environment` | `TRACELIT_ENVIRONMENT` | `"production"` | Deployment environment tag — e.g. `production`, `staging`, `development`. |
| `endpoint` | `TRACELIT_ENDPOINT` | `https://ingest.tracelit.app` | Base URL of the Tracelit ingest API. Override only when self-hosting. |
| `sampleRate` | `TRACELIT_SAMPLE_RATE` | `1.0` | Head-based trace sampling ratio between `0.0` and `1.0`. **Errors are always exported regardless of this setting.** |
| `enabled` | `TRACELIT_ENABLED` | `true` | Set to `false` to disable all telemetry — useful in test environments. |
| `resourceAttributes` | — | `{}` | Extra key/value pairs added to every span, metric, and log record as resource attributes. |

### Custom resource attributes

```ts
Tracelit.configure((config) => {
  config.apiKey      = process.env.TRACELIT_API_KEY;
  config.serviceName = "orders-api";
  config.resourceAttributes = {
    "deployment.region": "us-east-1",
    "team": "platform",
  };
});
```

---

## Manual trace instrumentation

Use `Tracelit.tracer` to create custom spans around any operation:

```ts
import Tracelit from "tracelit";

// Using startActiveSpan (recommended — automatically ends on return/throw)
const result = await Tracelit.tracer.startActiveSpan("process_payment", async (span) => {
  span.setAttribute("payment.id", payment.id);
  span.setAttribute("payment.amount", String(amount));
  span.setAttribute("payment.currency", currency);

  try {
    const result = await processPayment(payment);
    span.setAttribute("payment.status", result.status);
    return result;
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({ code: 2 /* ERROR */, message: (err as Error).message });
    throw err;
  } finally {
    span.end();
  }
});
```

`Tracelit.tracer` is a standard OpenTelemetry `Tracer` and supports the full [OpenTelemetry JS API](https://opentelemetry.io/docs/languages/js/).

---

## Manual metrics instrumentation

Access the metrics interface via `Tracelit.metrics`. All methods return `null` before `start()` is called or when the SDK is disabled, so optional chaining (`?.`) is safe everywhere.

### Counter

Counts discrete events. Use for request counts, job completions, errors, etc.

```ts
const ordersPlaced = Tracelit.metrics.counter("orders.placed", {
  description: "Total orders placed",
  unit: "{orders}",
});

ordersPlaced?.add(1, { currency: "USD", channel: "web" });
```

### Histogram

Records distributions of values. Use for durations, payload sizes, etc.

```ts
const apiLatency = Tracelit.metrics.histogram("external.api.duration", {
  description: "External API call duration",
  unit: "ms",
});

const start = Date.now();
await callExternalApi();
apiLatency?.record(Date.now() - start, { service: "stripe" });
```

### Gauge

Records a point-in-time value. Use for queue depths, pool sizes, cache hit rates, etc.

```ts
const queueDepth = Tracelit.metrics.gauge("job_queue.depth", {
  description: "Number of pending background jobs",
  unit: "{jobs}",
});

queueDepth?.record(await queue.pendingCount(), { queue: "default" });
```

### Observable gauge (callback-based)

Use when the value is expensive to compute and should only be read on the export interval:

```ts
const queueGauge = Tracelit.metrics.observableGauge("message.queue.size", {
  description: "Estimated message queue size",
  unit: "{messages}",
});

queueGauge?.addCallback((result) => {
  result.observe(getQueueSize(), { queue: "events" });
});
```

---

## HTTP server metrics (Express middleware)

Add the Tracelit Express middleware to automatically record per-request metrics:

```ts
import express from "express";
import Tracelit from "tracelit";

const app = express();
app.use(Tracelit.expressMetricsMiddleware());
```

Metrics recorded per request:

| Metric | Type | Description |
|--------|------|-------------|
| `http.server.request.count` | Counter | Total HTTP requests |
| `http.server.request.duration` | Histogram | Request duration (ms) |
| `http.server.error.count` | Counter | 5xx responses |

Attributes: `http.method`, `http.route`, `http.status_code`.

---

## Automatic instrumentation

`Tracelit.start()` enables every auto-instrumentation gem present in your `node_modules` via `@opentelemetry/auto-instrumentations-node`, including:

| Library | What is captured |
|---------|-----------------|
| Express / Fastify / Koa / Hapi | HTTP request traces, route and method attributes |
| `http` / `https` | All inbound and outbound HTTP call traces |
| pg / mysql2 / better-sqlite3 | SQL query traces with sanitised statement text |
| Mongoose / MongoDB | MongoDB operation traces |
| Redis / ioredis | Cache command traces |
| gRPC | Client and server RPC traces |
| GraphQL | Resolver and query traces |
| Kafka.js / rhea | Message publish/consume traces |
| Prisma | ORM operation traces |
| Undici / fetch | Outbound HTTP call traces |

---

## Automatic metrics collection

Once `Tracelit.start()` is called, the following metrics are collected with no additional configuration:

| Metric | Type | Description | Interval |
|--------|------|-------------|----------|
| `process.memory.rss` | Gauge | Process RSS memory (MB) | 60 s |
| `process.event_loop.lag` | Histogram | Node.js event loop lag (ms) | 30 s |

Both pollers use `unref()`'d timers and will not prevent your process from exiting.

---

## Logger integration

### Console bridge (automatic)

When `Tracelit.start()` is called, all `console.debug/log/info/warn/error` calls are automatically forwarded to the OTel LoggerProvider. The original console output is preserved. Log records are correlated with the active trace via `trace_id` and `span_id`.

Severity mapping:

| console method | OTel SeverityNumber |
|---------------|---------------------|
| `debug` / `log` | 5 (DEBUG) |
| `info` | 9 (INFO) |
| `warn` | 13 (WARN) |
| `error` | 17 (ERROR) |

### Winston transport

```ts
import winston from "winston";
import { WinstonTransport } from "tracelit";
import { logs } from "@opentelemetry/api-logs";

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new WinstonTransport(logs.getLoggerProvider()),
  ],
});

logger.info("Order created", { orderId: "ord_123" });
```

### Pino destination

```ts
import pino from "pino";
import { createPinoDestination } from "tracelit";
import { logs } from "@opentelemetry/api-logs";

const otelDest = createPinoDestination(logs.getLoggerProvider());

const logger = pino(
  pino.multistream([
    { stream: process.stdout },
    { stream: otelDest },
  ])
);

logger.info({ orderId: "ord_123" }, "Order created");
```

---

## Sampling and error guarantee

Set `config.sampleRate` below `1.0` to reduce trace volume in high-traffic environments:

```ts
Tracelit.configure((config) => {
  config.sampleRate = 0.1; // keep 10% of traces
});
```

**Error spans are always exported**, even when the parent trace is outside the sample ratio. The SDK uses `ErrorAlwaysOnSampler` + `ErrorSpanProcessor` to guarantee this — no configuration required.

---

## Disabling in tests

```ts
// tracelit.ts
Tracelit.configure((config) => {
  config.apiKey      = process.env.TRACELIT_API_KEY;
  config.serviceName = "my-service";
  config.enabled     = process.env.TRACELIT_ENABLED !== "false";
});
Tracelit.start();
```

Then in your test runner:

```bash
TRACELIT_ENABLED=false npx jest
```

Or set it permanently in `.env.test`:

```
TRACELIT_ENABLED=false
```

---

## Running the SDK's own tests

```bash
npm install
npm test
npm run test:coverage
```

---

## TypeScript / JavaScript compatibility

The package ships as dual CJS + ESM bundles with full TypeScript declaration files. It works with:

- TypeScript ≥ 5
- Node.js ≥ 18 (CJS `require()` or ESM `import`)
- JavaScript (no TypeScript needed)

```js
// CommonJS
const Tracelit = require("tracelit").default;
Tracelit.configure((c) => { c.apiKey = process.env.TRACELIT_API_KEY; c.serviceName = "my-app"; });
Tracelit.start();

// ESM
import Tracelit from "tracelit";
```
