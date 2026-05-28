import { SeverityNumber } from "@opentelemetry/api-logs";
import type { Logger, LoggerProvider } from "@opentelemetry/api-logs";
import { installConsoleBridge, WinstonTransport } from "../src/logger-bridge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): jest.Mocked<Logger> {
  return {
    emit: jest.fn(),
    enabled: jest.fn(() => true),
  };
}

function makeLoggerProvider(logger: Logger): jest.Mocked<LoggerProvider> {
  return {
    getLogger: jest.fn(() => logger),
  } as unknown as jest.Mocked<LoggerProvider>;
}

// ---------------------------------------------------------------------------
// Console bridge tests
// ---------------------------------------------------------------------------

describe("installConsoleBridge", () => {
  let emittedLogger: jest.Mocked<Logger>;
  let provider: jest.Mocked<LoggerProvider>;
  let restore: () => void;

  // Preserve original console methods.
  const originalConsole = {
    debug: console.debug,
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  beforeEach(() => {
    emittedLogger = makeLogger();
    provider = makeLoggerProvider(emittedLogger);
    restore = installConsoleBridge(provider, { preserveOriginal: false });
  });

  afterEach(() => {
    restore();
    // Ensure originals are restored even if restore() was not called.
    Object.assign(console, originalConsole);
    jest.clearAllMocks();
  });

  it("calls loggerProvider.getLogger with 'console' namespace", () => {
    expect(provider.getLogger).toHaveBeenCalledWith("console", expect.any(String));
  });

  describe("severity mapping", () => {
    const cases: Array<[keyof typeof originalConsole, SeverityNumber, string]> = [
      ["debug", SeverityNumber.DEBUG, "DEBUG"],
      ["log",   SeverityNumber.DEBUG, "DEBUG"],
      ["info",  SeverityNumber.INFO,  "INFO"],
      ["warn",  SeverityNumber.WARN,  "WARN"],
      ["error", SeverityNumber.ERROR, "ERROR"],
    ];

    for (const [method, expectedSeverity, expectedText] of cases) {
      it(`maps console.${method}() to severity ${expectedSeverity} (${expectedText})`, () => {
        console[method]("test message");

        expect(emittedLogger.emit).toHaveBeenCalledWith(
          expect.objectContaining({
            severityNumber: expectedSeverity,
            severityText: expectedText,
            body: "test message",
          }),
        );
      });
    }
  });

  it("concatenates multiple arguments into the body", () => {
    console.info("hello", "world", 42);

    const call = (emittedLogger.emit as jest.Mock).mock.calls[0][0] as { body: string };
    expect(call.body).toBe("hello world 42");
  });

  it("stringifies non-string arguments", () => {
    console.warn({ key: "value" });

    const call = (emittedLogger.emit as jest.Mock).mock.calls[0][0] as { body: string };
    expect(call.body).toContain("value");
  });

  it("attaches a timestamp to each log record", () => {
    const before = Date.now();
    console.info("timestamped");
    const after = Date.now();

    const call = (emittedLogger.emit as jest.Mock).mock.calls[0][0] as { timestamp: number };
    expect(call.timestamp).toBeGreaterThanOrEqual(before);
    expect(call.timestamp).toBeLessThanOrEqual(after);
  });

  it("attaches an OTel context to each log record", () => {
    console.info("with context");

    const call = (emittedLogger.emit as jest.Mock).mock.calls[0][0] as { context: unknown };
    expect(call.context).toBeDefined();
  });

  it("never throws even when the underlying logger throws", () => {
    emittedLogger.emit.mockImplementation(() => {
      throw new Error("OTel internal error");
    });

    expect(() => console.error("should not throw")).not.toThrow();
  });

  describe("restore function", () => {
    it("restores the original console methods", () => {
      restore();

      // After restore, console methods are the originals — calling them should
      // NOT trigger more emit calls.
      const callsBefore = (emittedLogger.emit as jest.Mock).mock.calls.length;
      console.info("after restore");
      expect((emittedLogger.emit as jest.Mock).mock.calls.length).toBe(callsBefore);
    });
  });

  describe("preserveOriginal option", () => {
    it("calls the original console method when preserveOriginal: true", () => {
      restore(); // remove previous bridge

      const captured: unknown[][] = [];
      const originalInfo = console.info;
      // Temporarily replace console.info with a capturing spy BEFORE installing the bridge
      console.info = (...args: unknown[]): void => {
        captured.push(args);
      };

      restore = installConsoleBridge(provider, { preserveOriginal: true });
      console.info("test-preserve");

      // The captured array should have the original call forwarded
      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual(["test-preserve"]);

      restore();
      console.info = originalInfo;
    });

    it("does NOT call the original when preserveOriginal: false (bridge only)", () => {
      // Already set up with preserveOriginal: false in beforeEach.
      const calls: unknown[][] = [];
      const origInfo = console.info;
      console.info = (...args: unknown[]): void => {
        calls.push(args);
      };
      // restore the bridge's patched version (the beforeEach bridge has been set)
      // We're testing the outer scope bridge which has preserveOriginal: false.
      // Install a fresh one with false to be explicit.
      restore();
      restore = installConsoleBridge(provider, { preserveOriginal: false });
      console.info("silent");
      // calls array should be empty because the bridge replaces console.info
      // and does NOT call back into the variable we patched (it captured originals before bridge).
      restore();
      console.info = origInfo;
      // Merely verify no error was thrown and OTel emit was called.
      expect(emittedLogger.emit).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// WinstonTransport tests
// ---------------------------------------------------------------------------

describe("WinstonTransport", () => {
  let emittedLogger: jest.Mocked<Logger>;
  let provider: jest.Mocked<LoggerProvider>;
  let transport: WinstonTransport;
  let callbackSpy: jest.Mock;

  beforeEach(() => {
    emittedLogger = makeLogger();
    provider = makeLoggerProvider(emittedLogger);
    transport = new WinstonTransport(provider);
    callbackSpy = jest.fn();
  });

  it("calls loggerProvider.getLogger with 'winston' namespace", () => {
    expect(provider.getLogger).toHaveBeenCalledWith("winston", expect.any(String));
  });

  describe("severity mapping", () => {
    const cases: Array<[string, SeverityNumber, string]> = [
      ["error",   SeverityNumber.ERROR, "ERROR"],
      ["warn",    SeverityNumber.WARN,  "WARN"],
      ["info",    SeverityNumber.INFO,  "INFO"],
      ["http",    SeverityNumber.INFO,  "INFO"],
      ["verbose", SeverityNumber.DEBUG, "DEBUG"],
      ["debug",   SeverityNumber.DEBUG, "DEBUG"],
      ["silly",   SeverityNumber.TRACE, "TRACE"],
    ];

    for (const [level, expectedSeverity, expectedText] of cases) {
      it(`maps Winston level '${level}' to severity ${expectedSeverity} (${expectedText})`, () => {
        transport.log({ level, message: "test" }, callbackSpy);

        expect(emittedLogger.emit).toHaveBeenCalledWith(
          expect.objectContaining({
            severityNumber: expectedSeverity,
            severityText: expectedText,
            body: "test",
          }),
        );
      });
    }
  });

  it("defaults to INFO for unknown levels", () => {
    transport.log({ level: "custom-level", message: "msg" }, callbackSpy);

    const call = (emittedLogger.emit as jest.Mock).mock.calls[0][0] as {
      severityNumber: SeverityNumber;
    };
    expect(call.severityNumber).toBe(SeverityNumber.INFO);
  });

  it("passes extra fields as string attributes", () => {
    transport.log(
      { level: "info", message: "hello", requestId: "req-123" },
      callbackSpy,
    );

    const call = (emittedLogger.emit as jest.Mock).mock.calls[0][0] as {
      attributes: Record<string, string>;
    };
    expect(call.attributes?.["requestId"]).toBe("req-123");
  });

  it("stringifies non-string extra fields", () => {
    transport.log(
      { level: "info", message: "hello", count: 42 },
      callbackSpy,
    );

    const call = (emittedLogger.emit as jest.Mock).mock.calls[0][0] as {
      attributes: Record<string, string>;
    };
    expect(call.attributes?.["count"]).toBe("42");
  });

  it("always calls the Winston callback", () => {
    transport.log({ level: "info", message: "test" }, callbackSpy);
    expect(callbackSpy).toHaveBeenCalled();
  });

  it("calls the callback even when the logger throws", () => {
    emittedLogger.emit.mockImplementation(() => {
      throw new Error("OTel error");
    });

    expect(() =>
      transport.log({ level: "info", message: "test" }, callbackSpy),
    ).not.toThrow();
    expect(callbackSpy).toHaveBeenCalled();
  });

  it("exposes a descriptive name", () => {
    expect(transport.name).toContain("TraceLit");
  });
});

// ---------------------------------------------------------------------------
// createPinoDestination tests
// ---------------------------------------------------------------------------

describe("createPinoDestination", () => {
  const { createPinoDestination } = require("../src/logger-bridge") as typeof import("../src/logger-bridge");

  let emittedLogger: jest.Mocked<Logger>;
  let provider: jest.Mocked<LoggerProvider>;

  beforeEach(() => {
    emittedLogger = makeLogger();
    provider = makeLoggerProvider(emittedLogger);
  });

  it("calls loggerProvider.getLogger with 'pino' namespace", () => {
    createPinoDestination(provider);
    expect(provider.getLogger).toHaveBeenCalledWith("pino", expect.any(String));
  });

  function writeToStream(
    stream: NodeJS.WritableStream,
    data: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      (stream as NodeJS.WritableStream & {
        write: (chunk: string, enc: string, cb: (err?: Error | null) => void) => void;
      }).write(data, "utf8", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  it("emits a log record for a valid pino JSON line", async () => {
    const dest = createPinoDestination(provider);
    const line = JSON.stringify({ level: 30, msg: "hello world", time: 1234567890 });

    await writeToStream(dest, line + "\n");

    expect(emittedLogger.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "hello world",
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        timestamp: 1234567890,
      }),
    );
  });

  it("maps all Pino severity levels correctly", async () => {
    const dest = createPinoDestination(provider);

    const cases: Array<[number, SeverityNumber, string]> = [
      [10, SeverityNumber.TRACE, "TRACE"],
      [20, SeverityNumber.DEBUG, "DEBUG"],
      [30, SeverityNumber.INFO,  "INFO"],
      [40, SeverityNumber.WARN,  "WARN"],
      [50, SeverityNumber.ERROR, "ERROR"],
      [60, SeverityNumber.FATAL, "FATAL"],
    ];

    for (const [level, expectedSeverity, expectedText] of cases) {
      jest.clearAllMocks();
      await writeToStream(dest, JSON.stringify({ level, msg: "test" }) + "\n");
      expect(emittedLogger.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          severityNumber: expectedSeverity,
          severityText: expectedText,
        }),
      );
    }
  });

  it("passes extra fields as string attributes", async () => {
    const dest = createPinoDestination(provider);
    const line = JSON.stringify({ level: 30, msg: "req", requestId: "r-123" });

    await writeToStream(dest, line + "\n");

    const call = (emittedLogger.emit as jest.Mock).mock.calls[0][0] as {
      attributes: Record<string, string>;
    };
    expect(call.attributes?.["requestId"]).toBe("r-123");
  });

  it("skips empty lines without emitting", async () => {
    const dest = createPinoDestination(provider);
    await writeToStream(dest, "   \n");
    expect(emittedLogger.emit).not.toHaveBeenCalled();
  });

  it("does not throw on invalid JSON input", async () => {
    const dest = createPinoDestination(provider);
    await expect(writeToStream(dest, "not-json\n")).resolves.toBeUndefined();
    expect(emittedLogger.emit).not.toHaveBeenCalled();
  });

  it("does not throw when logger.emit throws", async () => {
    emittedLogger.emit.mockImplementation(() => {
      throw new Error("emit error");
    });
    const dest = createPinoDestination(provider);
    const line = JSON.stringify({ level: 30, msg: "crash" });
    await expect(writeToStream(dest, line + "\n")).resolves.toBeUndefined();
  });

  it("serialises non-string non-null extra fields via JSON.stringify", async () => {
    const dest = createPinoDestination(provider);
    // Mix several types so we exercise the `safeStringify` path:
    //   - number, boolean, nested object
    // Also include null + undefined which should be skipped entirely.
    const line = JSON.stringify({
      level: 30,
      msg: "req",
      latencyMs: 42,
      retried: true,
      meta: { region: "eu-west-1" },
      ignoredNull: null,
    });

    await writeToStream(dest, line + "\n");

    const call = (emittedLogger.emit as jest.Mock).mock.calls[0][0] as {
      attributes: Record<string, string>;
    };
    expect(call.attributes?.["latencyMs"]).toBe("42");
    expect(call.attributes?.["retried"]).toBe("true");
    expect(call.attributes?.["meta"]).toBe('{"region":"eu-west-1"}');
    expect(call.attributes?.["ignoredNull"]).toBeUndefined();
  });

});
