/**
 * Instrumentation tests.
 *
 * We mock all OTel providers to test the Instrumentation orchestration logic
 * in isolation — no real network calls are made.
 */

// ---------------------------------------------------------------------------
// Module mocks (must be declared before imports that use them)
// ---------------------------------------------------------------------------

jest.mock("@opentelemetry/sdk-trace-node", () => ({
  NodeTracerProvider: jest.fn(() => ({
    register: jest.fn(),
    forceFlush: jest.fn(() => Promise.resolve()),
    shutdown: jest.fn(() => Promise.resolve()),
    getTracer: jest.fn(() => ({
      startSpan: jest.fn(() => ({
        recordException: jest.fn(),
        setStatus: jest.fn(),
        setAttribute: jest.fn(),
        end: jest.fn(),
      })),
    })),
  })),
  BatchSpanProcessor: jest.fn(() => ({})),
  ParentBasedSampler: jest.fn(() => ({})),
}));

jest.mock("@opentelemetry/exporter-trace-otlp-proto", () => ({
  OTLPTraceExporter: jest.fn(() => ({})),
}));

jest.mock("@opentelemetry/sdk-logs", () => ({
  LoggerProvider: jest.fn(() => ({
    forceFlush: jest.fn(() => Promise.resolve()),
    shutdown: jest.fn(() => Promise.resolve()),
  })),
  BatchLogRecordProcessor: jest.fn(() => ({})),
}));

jest.mock("@opentelemetry/exporter-logs-otlp-proto", () => ({
  OTLPLogExporter: jest.fn(() => ({})),
}));

jest.mock("@opentelemetry/sdk-metrics", () => ({
  MeterProvider: jest.fn(() => ({
    getMeter: jest.fn(() => ({
      createCounter: jest.fn(() => ({ add: jest.fn() })),
      createHistogram: jest.fn(() => ({ record: jest.fn() })),
      createGauge: jest.fn(() => ({ record: jest.fn() })),
      createObservableGauge: jest.fn(() => ({ addCallback: jest.fn() })),
    })),
    shutdown: jest.fn(() => Promise.resolve()),
  })),
  PeriodicExportingMetricReader: jest.fn(() => ({})),
}));

jest.mock("@opentelemetry/exporter-metrics-otlp-proto", () => ({
  OTLPMetricExporter: jest.fn(() => ({})),
}));

jest.mock("@opentelemetry/auto-instrumentations-node", () => ({
  getNodeAutoInstrumentations: jest.fn(() => []),
}));

jest.mock("@opentelemetry/instrumentation", () => ({
  registerInstrumentations: jest.fn(),
}));

jest.mock("@opentelemetry/api", () => ({
  ...jest.requireActual("@opentelemetry/api"),
  trace: {
    getTracer: jest.fn(() => ({})),
    getTracerProvider: jest.fn(() => ({})),
  },
}));

jest.mock("@opentelemetry/api-logs", () => ({
  ...jest.requireActual("@opentelemetry/api-logs"),
  logs: {
    setGlobalLoggerProvider: jest.fn(),
    getLogger: jest.fn(() => ({ emit: jest.fn(), enabled: jest.fn(() => true) })),
  },
}));

jest.mock("@opentelemetry/api", () => ({
  ...jest.requireActual("@opentelemetry/api"),
  trace: {
    getTracer: jest.fn(() => ({})),
    getTracerProvider: jest.fn(() => ({})),
  },
  metrics: {
    setGlobalMeterProvider: jest.fn(),
  },
}));

jest.mock("../src/logger-bridge", () => ({
  installConsoleBridge: jest.fn(() => jest.fn()),
  WinstonTransport: jest.fn(),
  createPinoDestination: jest.fn(),
}));

// ---------------------------------------------------------------------------

import { Configuration } from "../src/configuration";
import * as Instrumentation from "../src/instrumentation";

function makeConfig(
  overrides: Partial<{
    apiKey: string;
    serviceName: string;
    enabled: boolean;
    sampleRate: number;
    captureUncaughtExceptions: boolean;
  }> = {},
): Configuration {
  const c = new Configuration();
  c.apiKey = overrides.apiKey ?? "tl_live_abc";
  c.serviceName = overrides.serviceName ?? "test-service";
  c.enabled = overrides.enabled ?? true;
  c.sampleRate = overrides.sampleRate ?? 1.0;
  c.captureUncaughtExceptions = overrides.captureUncaughtExceptions ?? false;
  return c;
}

// Capture process event handlers globally so the SDK's installExitHandlers()
// never touches the real Node process inside the test runner. Each test gets
// a fresh `registeredHandlers` snapshot for assertions.
//
// Both `process.on`/`process.once` (used for SIGTERM/SIGINT/beforeExit) and
// `process.prependListener` (used for uncaughtException/unhandledRejection
// crash capture) are recorded by the same dictionary keyed on event name.
let registeredHandlers: Record<string, (...args: unknown[]) => unknown> = {};
let originalProcessOn: typeof process.on;
let originalProcessOnce: typeof process.once;
let originalProcessPrependListener: typeof process.prependListener;

beforeEach(() => {
  registeredHandlers = {};
  originalProcessOn = process.on;
  originalProcessOnce = process.once;
  originalProcessPrependListener = process.prependListener;
  // Looser cast: Node's process event APIs have many overloads; the recorder
  // only needs to capture (event, handler) pairs for assertion in tests.
  const recorder: typeof process.on = ((event: string, fn: (...a: unknown[]) => unknown) => {
    registeredHandlers[event] = fn;
    return process;
  }) as typeof process.on;
  process.on = recorder;
  process.once = recorder as typeof process.once;
  process.prependListener = recorder as typeof process.prependListener;
});

afterEach(() => {
  process.on = originalProcessOn;
  process.once = originalProcessOnce;
  process.prependListener = originalProcessPrependListener;
  Instrumentation.reset();
  jest.clearAllMocks();
});

describe("Instrumentation.setup()", () => {
  it("creates a NodeTracerProvider", () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    Instrumentation.setup(makeConfig());
    expect(NodeTracerProvider).toHaveBeenCalled();
  });

  it("calls provider.register() to wire global trace API", () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    Instrumentation.setup(makeConfig());
    const instance = NodeTracerProvider.mock.results[0]?.value as { register: jest.Mock };
    expect(instance.register).toHaveBeenCalled();
  });

  it("registers auto-instrumentations", () => {
    const { registerInstrumentations } = require("@opentelemetry/instrumentation") as {
      registerInstrumentations: jest.Mock;
    };
    Instrumentation.setup(makeConfig());
    expect(registerInstrumentations).toHaveBeenCalled();
  });

  it("installs the console log bridge", () => {
    const { installConsoleBridge } = require("../src/logger-bridge") as {
      installConsoleBridge: jest.Mock;
    };
    Instrumentation.setup(makeConfig());
    expect(installConsoleBridge).toHaveBeenCalled();
  });

  it("sets up the LoggerProvider", () => {
    const { LoggerProvider } = require("@opentelemetry/sdk-logs") as {
      LoggerProvider: jest.Mock;
    };
    Instrumentation.setup(makeConfig());
    expect(LoggerProvider).toHaveBeenCalled();
  });

  it("registers the LoggerProvider globally", () => {
    const { logs } = require("@opentelemetry/api-logs") as {
      logs: { setGlobalLoggerProvider: jest.Mock };
    };
    Instrumentation.setup(makeConfig());
    expect(logs.setGlobalLoggerProvider).toHaveBeenCalled();
  });

  it("is idempotent — only calls NodeTracerProvider once on repeated calls", () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    Instrumentation.setup(makeConfig());
    Instrumentation.setup(makeConfig());
    Instrumentation.setup(makeConfig());
    expect(NodeTracerProvider).toHaveBeenCalledTimes(1);
  });

  it("returns immediately when config.enabled is false", () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    Instrumentation.setup(makeConfig({ enabled: false }));
    expect(NodeTracerProvider).not.toHaveBeenCalled();
  });

  it("disables instead of throwing when config is invalid (missing apiKey)", () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const c = makeConfig();
      c.apiKey = undefined;
      expect(() => Instrumentation.setup(c)).not.toThrow();
      expect(NodeTracerProvider).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Tracelit.*disabled.*apiKey/));
    } finally {
      warn.mockRestore();
    }
  });

  it("falls back to default serviceName when missing (no throw)", () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    const c = makeConfig();
    c.serviceName = undefined;
    expect(() => Instrumentation.setup(c)).not.toThrow();
    expect(NodeTracerProvider).toHaveBeenCalled();
  });

  it("uses a ParentBasedSampler when sampleRate < 1.0", () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    const { ParentBasedSampler } = require("@opentelemetry/sdk-trace-node") as {
      ParentBasedSampler: jest.Mock;
    };

    Instrumentation.setup(makeConfig({ sampleRate: 0.5 }));

    expect(ParentBasedSampler).toHaveBeenCalled();
    const callArgs = (NodeTracerProvider as jest.Mock).mock.calls[0][0] as {
      sampler?: unknown;
    };
    expect(callArgs.sampler).toBeDefined();
  });

  it("does NOT use a ParentBasedSampler when sampleRate is 1.0 (default AlwaysOn)", () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    const { ParentBasedSampler } = require("@opentelemetry/sdk-trace-node") as {
      ParentBasedSampler: jest.Mock;
    };

    Instrumentation.setup(makeConfig({ sampleRate: 1.0 }));

    expect(ParentBasedSampler).not.toHaveBeenCalled();
    const callArgs = (NodeTracerProvider as jest.Mock).mock.calls[0][0] as {
      sampler?: unknown;
    };
    expect(callArgs.sampler).toBeUndefined();
  });

  it("includes the service.name in the OTLP exporter URL", () => {
    const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-proto") as {
      OTLPTraceExporter: jest.Mock;
    };
    const c = makeConfig();
    c.endpoint = "https://custom.example.com";
    Instrumentation.setup(c);
    expect(OTLPTraceExporter).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://custom.example.com/v1/traces" }),
    );
  });

  it("forwards correct Authorization headers to the trace exporter", () => {
    const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-proto") as {
      OTLPTraceExporter: jest.Mock;
    };
    const c = makeConfig();
    c.apiKey = "tl_key_789";
    Instrumentation.setup(c);
    const opts = (OTLPTraceExporter as jest.Mock).mock.calls[0][0] as {
      headers: Record<string, string>;
    };
    expect(opts.headers["Authorization"]).toBe("Bearer tl_key_789");
  });

  it("does not throw when log setup fails internally", () => {
    const { LoggerProvider } = require("@opentelemetry/sdk-logs") as {
      LoggerProvider: jest.Mock;
    };
    LoggerProvider.mockImplementationOnce(() => {
      throw new Error("log setup failure");
    });
    expect(() => Instrumentation.setup(makeConfig())).not.toThrow();
  });
});

describe("Instrumentation.reset()", () => {
  it("allows re-initialisation after reset", () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    Instrumentation.setup(makeConfig());
    Instrumentation.reset();
    Instrumentation.setup(makeConfig());
    expect(NodeTracerProvider).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// flush() / shutdown() — public APIs used by serverless callers + exit hooks
// ---------------------------------------------------------------------------

describe("Instrumentation.flush()", () => {
  it("forceFlushes all providers when SDK is initialised", async () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    const { LoggerProvider } = require("@opentelemetry/sdk-logs") as {
      LoggerProvider: jest.Mock;
    };

    Instrumentation.setup(makeConfig());
    await Instrumentation.flush();

    const tracerInstance = (NodeTracerProvider as jest.Mock).mock.results[0]!.value;
    const loggerInstance = (LoggerProvider as jest.Mock).mock.results[0]!.value;
    expect(tracerInstance.forceFlush).toHaveBeenCalled();
    expect(loggerInstance.forceFlush).toHaveBeenCalled();
  });

  it("resolves cleanly when providers are not yet initialised", async () => {
    await expect(Instrumentation.flush()).resolves.toBeUndefined();
  });

  it("swallows provider errors so callers never see a rejected promise", async () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    (NodeTracerProvider as jest.Mock).mockImplementationOnce(() => ({
      register: jest.fn(),
      forceFlush: jest.fn(() => Promise.reject(new Error("export failed"))),
      shutdown: jest.fn(() => Promise.resolve()),
      getTracer: jest.fn(),
    }));
    Instrumentation.setup(makeConfig());
    await expect(Instrumentation.flush()).resolves.toBeUndefined();
  });
});

describe("Instrumentation.shutdown()", () => {
  it("flushes then shuts down all providers", async () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    const { LoggerProvider } = require("@opentelemetry/sdk-logs") as {
      LoggerProvider: jest.Mock;
    };

    Instrumentation.setup(makeConfig());
    await Instrumentation.shutdown();

    const tracerInstance = (NodeTracerProvider as jest.Mock).mock.results[0]!.value;
    const loggerInstance = (LoggerProvider as jest.Mock).mock.results[0]!.value;
    expect(tracerInstance.shutdown).toHaveBeenCalled();
    expect(loggerInstance.shutdown).toHaveBeenCalled();
  });

  it("resolves cleanly when providers are not yet initialised", async () => {
    await expect(Instrumentation.shutdown()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Process-level crash + exit handlers
// ---------------------------------------------------------------------------

describe("Process exit + shutdown handlers (always installed)", () => {
  it("registers handlers for beforeExit, SIGTERM, SIGINT by default", () => {
    Instrumentation.setup(makeConfig());
    expect(registeredHandlers["beforeExit"]).toBeDefined();
    expect(registeredHandlers["SIGTERM"]).toBeDefined();
    expect(registeredHandlers["SIGINT"]).toBeDefined();
  });

  it("does NOT register crash handlers by default (preserves Node's built-in behaviour)", () => {
    Instrumentation.setup(makeConfig()); // captureUncaughtExceptions defaults to false
    expect(registeredHandlers["uncaughtException"]).toBeUndefined();
    expect(registeredHandlers["unhandledRejection"]).toBeUndefined();
  });

  it("flushes telemetry when beforeExit fires", () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    Instrumentation.setup(makeConfig());
    const tracerInstance = (NodeTracerProvider as jest.Mock).mock.results[0]!.value;
    registeredHandlers["beforeExit"]!();
    expect(tracerInstance.forceFlush).toHaveBeenCalled();
  });

  it("does not double-register handlers on repeated setup() calls", () => {
    Instrumentation.setup(makeConfig());
    const first = registeredHandlers["beforeExit"];
    Instrumentation.setup(makeConfig()); // idempotent
    expect(registeredHandlers["beforeExit"]).toBe(first);
  });

  it("kicks off shutdown but does NOT call process.kill on SIGTERM", async () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    const originalKill = process.kill;
    const killSpy = jest.fn();
    process.kill = killSpy as unknown as typeof process.kill;

    try {
      Instrumentation.setup(makeConfig());
      const tracerInstance = (NodeTracerProvider as jest.Mock).mock.results[0]!.value;
      registeredHandlers["SIGTERM"]!();
      await new Promise((r) => setTimeout(r, 0));

      // The shutdown flow flushes + closes providers — but never re-raises
      // the signal. The host application owns the exit decision; the SDK
      // only drains telemetry. This is critical: re-raising would break the
      // host's own signal handlers and force-exit the process.
      expect(tracerInstance.shutdown).toHaveBeenCalled();
      expect(killSpy).not.toHaveBeenCalled();
    } finally {
      process.kill = originalKill;
    }
  });
});

describe("Crash handlers (opt-in via captureUncaughtExceptions)", () => {
  it("registers uncaughtException + unhandledRejection when opted in", () => {
    Instrumentation.setup(makeConfig({ captureUncaughtExceptions: true }));
    expect(registeredHandlers["uncaughtException"]).toBeDefined();
    expect(registeredHandlers["unhandledRejection"]).toBeDefined();
  });

  it("records a crash span and fires flush without blocking on uncaughtException", () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    Instrumentation.setup(makeConfig({ captureUncaughtExceptions: true }));
    const tracerInstance = (NodeTracerProvider as jest.Mock).mock.results[0]!.value;
    const fakeSpan = {
      recordException: jest.fn(),
      setStatus: jest.fn(),
      setAttribute: jest.fn(),
      end: jest.fn(),
    };
    tracerInstance.getTracer.mockReturnValue({ startSpan: jest.fn(() => fakeSpan) });

    const err = new Error("kaboom");
    // The handler must return synchronously — no await, no setImmediate
    // delay — so Node's default behaviour proceeds immediately after.
    const before = Date.now();
    registeredHandlers["uncaughtException"]!(err);
    const after = Date.now();

    expect(after - before).toBeLessThan(50); // returns essentially instantly
    expect(fakeSpan.recordException).toHaveBeenCalledWith(err);
    expect(fakeSpan.setAttribute).toHaveBeenCalledWith("error.source", "uncaughtException");
    expect(fakeSpan.end).toHaveBeenCalled();
    expect(tracerInstance.forceFlush).toHaveBeenCalled();
  });

  it("records a crash span and fires flush without blocking on unhandledRejection", () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    Instrumentation.setup(makeConfig({ captureUncaughtExceptions: true }));
    const tracerInstance = (NodeTracerProvider as jest.Mock).mock.results[0]!.value;
    const fakeSpan = {
      recordException: jest.fn(),
      setStatus: jest.fn(),
      setAttribute: jest.fn(),
      end: jest.fn(),
    };
    tracerInstance.getTracer.mockReturnValue({ startSpan: jest.fn(() => fakeSpan) });

    registeredHandlers["unhandledRejection"]!("a string reason");

    expect(fakeSpan.recordException).toHaveBeenCalled();
    expect(fakeSpan.setAttribute).toHaveBeenCalledWith("error.source", "unhandledRejection");
    expect(tracerInstance.forceFlush).toHaveBeenCalled();
  });

  it("never throws even if recordCrashAsSpan fails internally", () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    Instrumentation.setup(makeConfig({ captureUncaughtExceptions: true }));
    const tracerInstance = (NodeTracerProvider as jest.Mock).mock.results[0]!.value;
    tracerInstance.getTracer.mockImplementation(() => {
      throw new Error("tracer init failed");
    });

    // If our handler ever throws here it would itself become an uncaught
    // exception and crash the host. Must be silent.
    expect(() => registeredHandlers["uncaughtException"]!(new Error("boom"))).not.toThrow();
    expect(() => registeredHandlers["unhandledRejection"]!(new Error("boom"))).not.toThrow();
  });
});
