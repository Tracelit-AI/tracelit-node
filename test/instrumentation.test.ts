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
  })),
  BatchSpanProcessor: jest.fn(() => ({})),
  ParentBasedSampler: jest.fn(() => ({})),
}));

jest.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: jest.fn(() => ({})),
}));

jest.mock("@opentelemetry/sdk-logs", () => ({
  LoggerProvider: jest.fn(() => ({})),
  BatchLogRecordProcessor: jest.fn(() => ({})),
}));

jest.mock("@opentelemetry/exporter-logs-otlp-http", () => ({
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

jest.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({
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

afterEach(() => {
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

  it("throws when config is invalid (missing apiKey)", () => {
    const c = makeConfig();
    c.apiKey = undefined;
    expect(() => Instrumentation.setup(c)).toThrow(/apiKey is required/);
  });

  it("throws when config is invalid (missing serviceName)", () => {
    const c = makeConfig();
    c.serviceName = undefined;
    expect(() => Instrumentation.setup(c)).toThrow(/serviceName is required/);
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
    const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http") as {
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
    const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http") as {
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
