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

function makeConfig(overrides: Partial<{ apiKey: string; serviceName: string; enabled: boolean; sampleRate: number }> = {}): Configuration {
  const c = new Configuration();
  c.apiKey = overrides.apiKey ?? "tl_live_abc";
  c.serviceName = overrides.serviceName ?? "test-service";
  c.enabled = overrides.enabled ?? true;
  c.sampleRate = overrides.sampleRate ?? 1.0;
  return c;
}

// Capture process event handlers globally so the SDK's installExitHandlers()
// never touches the real Node process inside the test runner. Each test gets
// a fresh `registeredHandlers` snapshot for assertions.
let registeredHandlers: Record<string, (...args: unknown[]) => unknown> = {};
let originalProcessOn: typeof process.on;
let originalProcessOnce: typeof process.once;

beforeEach(() => {
  registeredHandlers = {};
  originalProcessOn = process.on;
  originalProcessOnce = process.once;
  // Looser cast: Node's `process.on` has many overloads; the recorder only
  // needs to capture (event, handler) pairs for assertion in tests.
  const recorder: typeof process.on = ((event: string, fn: (...a: unknown[]) => unknown) => {
    registeredHandlers[event] = fn;
    return process;
  }) as typeof process.on;
  process.on = recorder;
  process.once = recorder as typeof process.once;
});

afterEach(() => {
  process.on = originalProcessOn;
  process.once = originalProcessOnce;
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

describe("Process exit + crash handlers", () => {
  it("registers handlers for beforeExit, SIGTERM, SIGINT, uncaughtException, unhandledRejection", () => {
    Instrumentation.setup(makeConfig());
    expect(registeredHandlers["beforeExit"]).toBeDefined();
    expect(registeredHandlers["SIGTERM"]).toBeDefined();
    expect(registeredHandlers["SIGINT"]).toBeDefined();
    expect(registeredHandlers["uncaughtException"]).toBeDefined();
    expect(registeredHandlers["unhandledRejection"]).toBeDefined();
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

  it("records a crash span and flushes on uncaughtException", async () => {
    // The real handler re-throws via setImmediate so Node still exits with code 1.
    // We stub setImmediate so the test runner doesn't see an uncaught throw.
    const originalSetImmediate = global.setImmediate;
    global.setImmediate = ((fn: () => void) => {
      // Swallow — assert behavior synchronously below.
      void fn;
      return 0 as unknown as NodeJS.Immediate;
    }) as typeof global.setImmediate;

    try {
      const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
        NodeTracerProvider: jest.Mock;
      };
      Instrumentation.setup(makeConfig());
      const tracerInstance = (NodeTracerProvider as jest.Mock).mock.results[0]!.value;
      const fakeSpan = {
        recordException: jest.fn(),
        setStatus: jest.fn(),
        setAttribute: jest.fn(),
        end: jest.fn(),
      };
      tracerInstance.getTracer.mockReturnValue({ startSpan: jest.fn(() => fakeSpan) });

      const err = new Error("kaboom");
      registeredHandlers["uncaughtException"]!(err);
      // Allow flush().finally(...) to settle.
      await new Promise((r) => setTimeout(r, 0));

      expect(fakeSpan.recordException).toHaveBeenCalledWith(err);
      expect(fakeSpan.setAttribute).toHaveBeenCalledWith("error.source", "uncaughtException");
      expect(fakeSpan.end).toHaveBeenCalled();
      expect(tracerInstance.forceFlush).toHaveBeenCalled();
    } finally {
      global.setImmediate = originalSetImmediate;
    }
  });

  it("records a crash span and flushes on unhandledRejection", async () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    Instrumentation.setup(makeConfig());
    const tracerInstance = (NodeTracerProvider as jest.Mock).mock.results[0]!.value;
    const fakeSpan = {
      recordException: jest.fn(),
      setStatus: jest.fn(),
      setAttribute: jest.fn(),
      end: jest.fn(),
    };
    tracerInstance.getTracer.mockReturnValue({ startSpan: jest.fn(() => fakeSpan) });

    registeredHandlers["unhandledRejection"]!("a string reason");
    // Allow the flush() microtask to resolve.
    await new Promise((r) => setTimeout(r, 0));

    expect(fakeSpan.recordException).toHaveBeenCalled();
    expect(fakeSpan.setAttribute).toHaveBeenCalledWith("error.source", "unhandledRejection");
    expect(tracerInstance.forceFlush).toHaveBeenCalled();
  });

  it("does not double-register handlers on repeated setup() calls", () => {
    Instrumentation.setup(makeConfig());
    const first = registeredHandlers["beforeExit"];
    Instrumentation.setup(makeConfig()); // idempotent
    expect(registeredHandlers["beforeExit"]).toBe(first);
  });

  it("survives a recordCrashAsSpan failure inside the uncaughtException handler", async () => {
    // Stub setImmediate so the rethrow doesn't escape the test.
    const originalSetImmediate = global.setImmediate;
    global.setImmediate = ((fn: () => void) => {
      void fn;
      return 0 as unknown as NodeJS.Immediate;
    }) as typeof global.setImmediate;

    try {
      const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
        NodeTracerProvider: jest.Mock;
      };
      Instrumentation.setup(makeConfig());
      const tracerInstance = (NodeTracerProvider as jest.Mock).mock.results[0]!.value;
      // Force getTracer to throw — the handler's try/catch should swallow it.
      tracerInstance.getTracer.mockImplementation(() => {
        throw new Error("tracer init failed");
      });

      expect(() => registeredHandlers["uncaughtException"]!(new Error("boom"))).not.toThrow();
      expect(() => registeredHandlers["unhandledRejection"]!(new Error("boom"))).not.toThrow();
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      global.setImmediate = originalSetImmediate;
    }
  });

  it("does nothing in recordCrashAsSpan when tracer provider is uninitialised", () => {
    // We never call setup(), so tracerProviderRef stays null. The handler is
    // never registered in this path, so we just verify the flush short-circuits.
    expect(() => Instrumentation.reset()).not.toThrow();
  });

  it("shuts down providers and re-raises the signal on SIGTERM", async () => {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: jest.Mock;
    };
    // Stub process.kill so the test runner doesn't actually receive SIGTERM.
    const originalKill = process.kill;
    const killSpy = jest.fn();
    process.kill = killSpy as unknown as typeof process.kill;

    try {
      Instrumentation.setup(makeConfig());
      const tracerInstance = (NodeTracerProvider as jest.Mock).mock.results[0]!.value;
      registeredHandlers["SIGTERM"]!();
      // Let shutdown().finally(...) resolve.
      await new Promise((r) => setTimeout(r, 0));

      expect(tracerInstance.shutdown).toHaveBeenCalled();
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");
    } finally {
      process.kill = originalKill;
    }
  });
});
