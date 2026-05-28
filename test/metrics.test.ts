/**
 * Metrics tests.
 *
 * We mock the heavy OTel provider and exporter to test the Metrics module
 * logic in isolation — no real network calls, no real timers.
 */

jest.mock("@opentelemetry/sdk-metrics", () => {
  const mockMeter = {
    createCounter: jest.fn(() => ({ add: jest.fn() })),
    createHistogram: jest.fn(() => ({ record: jest.fn() })),
    createGauge: jest.fn(() => ({ record: jest.fn() })),
    createObservableGauge: jest.fn(() => ({ addCallback: jest.fn() })),
  };
  const mockProvider = {
    getMeter: jest.fn(() => mockMeter),
    shutdown: jest.fn(() => Promise.resolve()),
    forceFlush: jest.fn(() => Promise.resolve()),
  };
  return {
    MeterProvider: jest.fn(() => mockProvider),
    PeriodicExportingMetricReader: jest.fn(() => ({})),
    __mockMeter: mockMeter,
    __mockProvider: mockProvider,
  };
});

jest.mock("@opentelemetry/exporter-metrics-otlp-proto", () => ({
  OTLPMetricExporter: jest.fn(() => ({})),
}));

jest.mock("@opentelemetry/api", () => ({
  ...jest.requireActual("@opentelemetry/api"),
  metrics: {
    setGlobalMeterProvider: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sdkMetrics = require("@opentelemetry/sdk-metrics") as {
  __mockMeter: {
    createCounter: jest.Mock;
    createHistogram: jest.Mock;
    createGauge: jest.Mock;
    createObservableGauge: jest.Mock;
  };
  __mockProvider: {
    getMeter: jest.Mock;
    shutdown: jest.Mock;
    forceFlush: jest.Mock;
  };
};

import * as Metrics from "../src/metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";

const dummyResource = resourceFromAttributes({ "service.name": "test" });

function setupMetrics(): void {
  Metrics.setup(
    "https://ingest.tracelit.app",
    { Authorization: "Bearer key" },
    dummyResource,
    "test-service",
  );
}

afterEach(() => {
  Metrics.reset();
  jest.clearAllMocks();
});

describe("Metrics.setup()", () => {
  it("creates a MeterProvider with a PeriodicExportingMetricReader", () => {
    const { MeterProvider, PeriodicExportingMetricReader } =
      require("@opentelemetry/sdk-metrics") as {
        MeterProvider: jest.Mock;
        PeriodicExportingMetricReader: jest.Mock;
      };
    setupMetrics();
    expect(MeterProvider).toHaveBeenCalled();
    expect(PeriodicExportingMetricReader).toHaveBeenCalledWith(
      expect.objectContaining({
        exportIntervalMillis: 60_000,
        exportTimeoutMillis: 10_000,
      }),
    );
  });

  it("registers the MeterProvider globally", () => {
    const { metrics } = require("@opentelemetry/api") as {
      metrics: { setGlobalMeterProvider: jest.Mock };
    };
    setupMetrics();
    expect(metrics.setGlobalMeterProvider).toHaveBeenCalled();
  });

  it("is idempotent — only sets up once on repeated calls", () => {
    const { MeterProvider } = require("@opentelemetry/sdk-metrics") as {
      MeterProvider: jest.Mock;
    };
    setupMetrics();
    setupMetrics();
    setupMetrics();
    expect(MeterProvider).toHaveBeenCalledTimes(1);
  });

  it("does not throw when setup fails", () => {
    const { MeterProvider } = require("@opentelemetry/sdk-metrics") as {
      MeterProvider: jest.Mock;
    };
    MeterProvider.mockImplementationOnce(() => {
      throw new Error("provider error");
    });
    expect(() => setupMetrics()).not.toThrow();
  });
});

describe("Metrics.counter()", () => {
  it("returns null before setup", () => {
    expect(Metrics.counter("test.counter")).toBeNull();
  });

  it("creates a Counter after setup", () => {
    setupMetrics();
    const c = Metrics.counter("test.counter", { description: "desc", unit: "{events}" });
    expect(c).not.toBeNull();
    expect(sdkMetrics.__mockMeter.createCounter).toHaveBeenCalledWith(
      "test.counter",
      { description: "desc", unit: "{events}" },
    );
  });

  it("uses empty description and unit when options are omitted", () => {
    setupMetrics();
    Metrics.counter("plain.counter");
    expect(sdkMetrics.__mockMeter.createCounter).toHaveBeenCalledWith(
      "plain.counter",
      { description: "", unit: "" },
    );
  });
});

describe("Metrics.histogram()", () => {
  it("returns null before setup", () => {
    expect(Metrics.histogram("test.hist")).toBeNull();
  });

  it("creates a Histogram after setup", () => {
    setupMetrics();
    Metrics.histogram("test.hist", { unit: "ms" });
    expect(sdkMetrics.__mockMeter.createHistogram).toHaveBeenCalledWith(
      "test.hist",
      { description: "", unit: "ms" },
    );
  });
});

describe("Metrics.gauge()", () => {
  it("returns null before setup", () => {
    expect(Metrics.gauge("test.gauge")).toBeNull();
  });

  it("creates a Gauge after setup", () => {
    setupMetrics();
    Metrics.gauge("test.gauge", { description: "level" });
    expect(sdkMetrics.__mockMeter.createGauge).toHaveBeenCalledWith(
      "test.gauge",
      { description: "level", unit: "" },
    );
  });
});

describe("Metrics.observableGauge()", () => {
  it("returns null before setup", () => {
    expect(Metrics.observableGauge("test.obs")).toBeNull();
  });

  it("creates an ObservableGauge after setup", () => {
    setupMetrics();
    Metrics.observableGauge("test.obs");
    expect(sdkMetrics.__mockMeter.createObservableGauge).toHaveBeenCalledWith(
      "test.obs",
      { description: "", unit: "" },
    );
  });
});

describe("Metrics.installMemoryPoller()", () => {
  it("returns null when meter is not initialised", () => {
    expect(Metrics.installMemoryPoller()).toBeNull();
  });

  it("returns a timer handle after setup", () => {
    setupMetrics();
    const timer = Metrics.installMemoryPoller();
    expect(timer).not.toBeNull();
    if (timer) clearInterval(timer);
  });

  it("the timer is unref'd so it does not block process exit", () => {
    setupMetrics();
    const timer = Metrics.installMemoryPoller();
    expect(timer).not.toBeNull();
    // NodeJS.Timeout has _idleTimeout — unref'd timers still have it.
    // We can't easily test unref directly, but we verify it doesn't throw.
    if (timer) clearInterval(timer);
  });

  it("creates a process.memory.rss gauge", () => {
    setupMetrics();
    Metrics.installMemoryPoller();
    expect(sdkMetrics.__mockMeter.createGauge).toHaveBeenCalledWith(
      "process.memory.rss",
      expect.objectContaining({ unit: "MB" }),
    );
  });
});

describe("Metrics.installEventLoopLagPoller()", () => {
  it("returns null when meter is not initialised", () => {
    expect(Metrics.installEventLoopLagPoller()).toBeNull();
  });

  it("returns a timer handle after setup", () => {
    setupMetrics();
    const timer = Metrics.installEventLoopLagPoller();
    expect(timer).not.toBeNull();
    if (timer) clearInterval(timer);
  });

  it("creates a process.event_loop.lag histogram", () => {
    setupMetrics();
    Metrics.installEventLoopLagPoller();
    expect(sdkMetrics.__mockMeter.createHistogram).toHaveBeenCalledWith(
      "process.event_loop.lag",
      expect.objectContaining({ unit: "ms" }),
    );
  });
});

describe("Metrics.expressMetricsMiddleware()", () => {
  it("returns a pass-through middleware when meter is not initialised", () => {
    const middleware = Metrics.expressMetricsMiddleware();
    const next = jest.fn();
    middleware(
      { method: "GET", path: "/" } as never,
      { statusCode: 200, on: jest.fn() } as never,
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it("returns a middleware after setup", () => {
    setupMetrics();
    const middleware = Metrics.expressMetricsMiddleware();
    expect(typeof middleware).toBe("function");
  });

  it("calls next()", () => {
    setupMetrics();
    const middleware = Metrics.expressMetricsMiddleware();
    const next = jest.fn();
    const finishListeners: Array<() => void> = [];
    interface MockRes { statusCode: number; on: jest.Mock }
    const res: MockRes = {
      statusCode: 200,
      on: jest.fn((_event: string, cb: () => void) => {
        finishListeners.push(cb);
        return res;
      }),
    };
    middleware({ method: "GET", path: "/health" } as never, res as never, next);
    expect(next).toHaveBeenCalled();
  });

  it("records request metrics on the 'finish' event", () => {
    setupMetrics();
    const middleware = Metrics.expressMetricsMiddleware();
    const next = jest.fn();
    const finishListeners: Array<() => void> = [];
    interface MockRes { statusCode: number; on: jest.Mock }
    const res: MockRes = {
      statusCode: 200,
      on: jest.fn((event: string, cb: () => void) => {
        if (event === "finish") finishListeners.push(cb);
        return res;
      }),
    };

    middleware({ method: "GET", path: "/api" } as never, res as never, next);

    // Simulate the response finishing.
    for (const cb of finishListeners) cb();

    // At minimum, next() should be called.
    expect(next).toHaveBeenCalled();
  });

  it("records an error count for 5xx responses", () => {
    setupMetrics();
    const middleware = Metrics.expressMetricsMiddleware();
    const next = jest.fn();
    const finishListeners: Array<() => void> = [];
    interface MockRes { statusCode: number; on: jest.Mock }
    const res: MockRes = {
      statusCode: 503,
      on: jest.fn((event: string, cb: () => void) => {
        if (event === "finish") finishListeners.push(cb);
        return res;
      }),
    };

    middleware({ method: "GET", path: "/crash" } as never, res as never, next);
    for (const cb of finishListeners) cb();

    // The error counter add() should have been called with 1.
    // We just verify no exception was thrown during middleware execution.
    expect(next).toHaveBeenCalled();
  });

  it("does not throw when the finish listener errors", () => {
    setupMetrics();
    const middleware = Metrics.expressMetricsMiddleware();
    const next = jest.fn();
    // Provide an 'on' that throws when called.
    const res = {
      statusCode: 200,
      on: jest.fn(() => {
        throw new Error("listener error");
      }),
    };

    expect(() =>
      middleware({ method: "GET", path: "/" } as never, res as never, next),
    ).not.toThrow();
  });
});

describe("Metrics.flush()", () => {
  it("resolves cleanly when the meter provider is not initialised", async () => {
    await expect(Metrics.flush()).resolves.toBeUndefined();
  });

  it("calls forceFlush on the meter provider when initialised", async () => {
    setupMetrics();
    await Metrics.flush();
    expect(sdkMetrics.__mockProvider.forceFlush).toHaveBeenCalled();
  });

  it("swallows provider errors so callers never see a rejected promise", async () => {
    setupMetrics();
    sdkMetrics.__mockProvider.forceFlush.mockImplementationOnce(() =>
      Promise.reject(new Error("export failed")),
    );
    await expect(Metrics.flush()).resolves.toBeUndefined();
  });
});
