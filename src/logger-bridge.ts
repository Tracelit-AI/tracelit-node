import { context as otelContext } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { Logger, LoggerProvider } from "@opentelemetry/api-logs";
import type { ConsoleBridgeOptions } from "./types";

export const VERSION = "0.1.0";

/**
 * Severity mapping mirrors the Ruby SDK:
 *   console.debug → OTel DEBUG (5)
 *   console.log   → OTel DEBUG (5)  — Node.js log = verbose debug
 *   console.info  → OTel INFO  (9)
 *   console.warn  → OTel WARN  (13)
 *   console.error → OTel ERROR (17)
 */
const CONSOLE_SEVERITY: Record<
  "debug" | "log" | "info" | "warn" | "error",
  SeverityNumber
> = {
  debug: SeverityNumber.DEBUG,
  log: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

const CONSOLE_SEVERITY_TEXT: Record<
  "debug" | "log" | "info" | "warn" | "error",
  string
> = {
  debug: "DEBUG",
  log: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

type ConsoleMethod = "debug" | "log" | "info" | "warn" | "error";

/**
 * installConsoleBridge patches the global `console` so that every
 * `console.debug/log/info/warn/error` call is also forwarded to the OTel
 * LoggerProvider as a LogRecord.
 *
 * The original console output is preserved by default (preserveOriginal: true).
 * Trace correlation is automatic — the active OTel context is attached to
 * every log record, so `trace_id` and `span_id` are populated whenever a
 * span is active.
 *
 * Returns a cleanup function that restores the original console methods.
 */
export function installConsoleBridge(
  loggerProvider: LoggerProvider,
  options: ConsoleBridgeOptions = {},
): () => void {
  const { preserveOriginal = true } = options;

  const otelLogger: Logger = loggerProvider.getLogger("console", VERSION);

  const methods: ConsoleMethod[] = ["debug", "log", "info", "warn", "error"];
  const originals: Record<ConsoleMethod, (...args: unknown[]) => void> =
    {} as Record<ConsoleMethod, (...args: unknown[]) => void>;

  for (const method of methods) {
    const original = console[method].bind(console);
    originals[method] = original;

    console[method] = (...args: unknown[]): void => {
      if (preserveOriginal) {
        original(...args);
      }

      try {
        const body = args
          .map((a) =>
            typeof a === "string" ? a : safeStringify(a),
          )
          .join(" ");

        otelLogger.emit({
          timestamp: Date.now(),
          severityNumber: CONSOLE_SEVERITY[method],
          severityText: CONSOLE_SEVERITY_TEXT[method],
          body,
          context: otelContext.active(),
        });
      } catch {
        // Never let OTel errors surface to the application.
      }
    };
  }

  return function restore(): void {
    for (const method of methods) {
      console[method] = originals[method] as typeof console[typeof method];
    }
  };
}

/**
 * WinstonTransport is a Winston transport that forwards log entries to the
 * OTel LoggerProvider. Add it alongside your existing transports so the
 * original output is preserved:
 *
 * @example
 * ```ts
 * import winston from "winston";
 * import { WinstonTransport } from "tracelit";
 *
 * const logger = winston.createLogger({
 *   transports: [
 *     new winston.transports.Console(),
 *     new WinstonTransport(loggerProvider),
 *   ],
 * });
 * ```
 */
export class WinstonTransport {
  private readonly otelLogger: Logger;
  name = "TraceLitWinstonTransport";

  /**
   * Severity mapping for Winston level strings.
   * Winston levels: error(0) warn(1) info(2) http(3) verbose(4) debug(5) silly(6)
   */
  private static readonly LEVEL_MAP: Record<string, SeverityNumber> = {
    error: SeverityNumber.ERROR,
    warn: SeverityNumber.WARN,
    info: SeverityNumber.INFO,
    http: SeverityNumber.INFO,
    verbose: SeverityNumber.DEBUG,
    debug: SeverityNumber.DEBUG,
    silly: SeverityNumber.TRACE,
  };

  private static readonly LEVEL_TEXT_MAP: Record<string, string> = {
    error: "ERROR",
    warn: "WARN",
    info: "INFO",
    http: "INFO",
    verbose: "DEBUG",
    debug: "DEBUG",
    silly: "TRACE",
  };

  constructor(loggerProvider: LoggerProvider) {
    this.otelLogger = loggerProvider.getLogger("winston", VERSION);
  }

  /**
   * Called by Winston for each log entry. Compatible with the Winston
   * Transport interface (duck-typed, no winston peer dependency at runtime).
   */
  log(
    info: { level: string; message: string; [key: string]: unknown },
    callback: () => void,
  ): void {
    try {
      const { level, message, ...rest } = info;
      const severityNumber =
        WinstonTransport.LEVEL_MAP[level] ?? SeverityNumber.INFO;
      const severityText =
        WinstonTransport.LEVEL_TEXT_MAP[level] ?? "INFO";

      const attributes: Record<string, string> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (typeof v === "string") {
          attributes[k] = v;
        } else if (v !== undefined && v !== null) {
          attributes[k] = safeStringify(v);
        }
      }

      this.otelLogger.emit({
        timestamp: Date.now(),
        severityNumber,
        severityText,
        body: message,
        attributes,
        context: otelContext.active(),
      });
    } catch {
      // Never let OTel errors surface to the application.
    } finally {
      callback();
    }
  }
}

/**
 * createPinoDestination returns a Pino-compatible writable destination stream
 * that forwards every parsed log line to the OTel LoggerProvider.
 *
 * Use it as a Pino `destination` or as one target in a `pino.multistream`:
 *
 * @example
 * ```ts
 * import pino from "pino";
 * import { createPinoDestination } from "tracelit";
 *
 * const otelDest = createPinoDestination(loggerProvider);
 *
 * // Forward to both stdout and OTel:
 * const logger = pino(pino.multistream([
 *   { stream: process.stdout },
 *   { stream: otelDest },
 * ]));
 * ```
 */
export function createPinoDestination(
  loggerProvider: LoggerProvider,
): NodeJS.WritableStream {
  const otelLogger: Logger = loggerProvider.getLogger("pino", VERSION);

  /**
   * Pino severity to OTel SeverityNumber.
   * Pino levels: trace(10) debug(20) info(30) warn(40) error(50) fatal(60)
   */
  const pinoLevelToSeverity = (level: number): SeverityNumber => {
    if (level >= 60) return SeverityNumber.FATAL;
    if (level >= 50) return SeverityNumber.ERROR;
    if (level >= 40) return SeverityNumber.WARN;
    if (level >= 30) return SeverityNumber.INFO;
    if (level >= 20) return SeverityNumber.DEBUG;
    return SeverityNumber.TRACE;
  };

  const pinoLevelToText = (level: number): string => {
    if (level >= 60) return "FATAL";
    if (level >= 50) return "ERROR";
    if (level >= 40) return "WARN";
    if (level >= 30) return "INFO";
    if (level >= 20) return "DEBUG";
    return "TRACE";
  };

  const writable = new (require("stream").Writable)({
    objectMode: false,
    write(
      chunk: Buffer | string,
      _encoding: string,
      done: (err?: Error) => void,
    ) {
      try {
        const line = chunk.toString().trim();
        if (!line) {
          done();
          return;
        }

        const parsed = JSON.parse(line) as {
          level?: number;
          msg?: string;
          time?: number;
          [key: string]: unknown;
        };

        const { level = 30, msg = "", time, ...rest } = parsed;

        const attributes: Record<string, string> = {};
        for (const [k, v] of Object.entries(rest)) {
          if (typeof v === "string") {
            attributes[k] = v;
          } else if (v !== undefined && v !== null) {
            attributes[k] = safeStringify(v);
          }
        }

        otelLogger.emit({
          timestamp: time ?? Date.now(),
          severityNumber: pinoLevelToSeverity(level),
          severityText: pinoLevelToText(level),
          body: msg,
          attributes,
          context: otelContext.active(),
        });
      } catch {
        // Never let OTel errors surface to the application.
      }
      done();
    },
  }) as NodeJS.WritableStream;

  return writable;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
