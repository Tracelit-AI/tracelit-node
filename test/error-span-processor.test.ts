import { SpanStatusCode, TraceFlags, context } from "@opentelemetry/api";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { SpanContext, SpanStatus } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import { ErrorSpanProcessor } from "../src/error-span-processor";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSpan(
  statusCode: SpanStatusCode,
  traceFlags: number,
): ReadableSpan {
  const ctx: SpanContext = {
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
    traceFlags,
    isRemote: false,
  };

  const status: SpanStatus = { code: statusCode };

  return {
    name: "test-span",
    kind: 0,
    spanContext: () => ctx,
    startTime: [0, 0],
    endTime: [0, 1],
    status,
    attributes: {},
    links: [],
    events: [],
    duration: [0, 1],
    ended: true,
    resource: {} as never,
    instrumentationScope: { name: "test" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as ReadableSpan;
}

function makeExporter(overrides: Partial<SpanExporter> = {}): SpanExporter {
  return {
    export: jest.fn((_spans, cb) =>
      cb({ code: ExportResultCode.SUCCESS }),
    ),
    shutdown: jest.fn(() => Promise.resolve()),
    forceFlush: jest.fn(() => Promise.resolve()),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ErrorSpanProcessor", () => {
  describe("onStart()", () => {
    it("does nothing and does not throw", () => {
      const exporter = makeExporter();
      const processor = new ErrorSpanProcessor(exporter);

      expect(() =>
        processor.onStart({} as never, context.active()),
      ).not.toThrow();

      expect(exporter.export).not.toHaveBeenCalled();
    });
  });

  describe("onEnd()", () => {
    describe("span status is OK (not an error)", () => {
      it("does not call the exporter", () => {
        const exporter = makeExporter();
        const processor = new ErrorSpanProcessor(exporter);
        const span = makeSpan(SpanStatusCode.OK, TraceFlags.NONE);

        processor.onEnd(span);

        expect(exporter.export).not.toHaveBeenCalled();
      });
    });

    describe("span status is UNSET (not an error)", () => {
      it("does not call the exporter", () => {
        const exporter = makeExporter();
        const processor = new ErrorSpanProcessor(exporter);
        const span = makeSpan(SpanStatusCode.UNSET, TraceFlags.NONE);

        processor.onEnd(span);

        expect(exporter.export).not.toHaveBeenCalled();
      });
    });

    describe("span status is ERROR but was already sampled", () => {
      it("does not call the exporter (BatchSpanProcessor handles sampled spans)", () => {
        const exporter = makeExporter();
        const processor = new ErrorSpanProcessor(exporter);
        const span = makeSpan(SpanStatusCode.ERROR, TraceFlags.SAMPLED);

        processor.onEnd(span);

        expect(exporter.export).not.toHaveBeenCalled();
      });
    });

    describe("span status is ERROR and was NOT sampled", () => {
      it("force-exports the span via the exporter", () => {
        const exporter = makeExporter();
        const processor = new ErrorSpanProcessor(exporter);
        const span = makeSpan(SpanStatusCode.ERROR, TraceFlags.NONE);

        processor.onEnd(span);

        expect(exporter.export).toHaveBeenCalledWith([span], expect.any(Function));
      });

      it("passes the span wrapped in an array", () => {
        const exporter = makeExporter();
        const processor = new ErrorSpanProcessor(exporter);
        const span = makeSpan(SpanStatusCode.ERROR, TraceFlags.NONE);

        processor.onEnd(span);

        const [spans] = (exporter.export as jest.Mock).mock.calls[0] as [ReadableSpan[], unknown];
        expect(spans).toHaveLength(1);
        expect(spans[0]).toBe(span);
      });
    });

    describe("exporter throws during export", () => {
      it("swallows the exception and does not propagate to the application", () => {
        const exporter = makeExporter({
          export: jest.fn(() => {
            throw new Error("network timeout");
          }),
        });
        const processor = new ErrorSpanProcessor(exporter);
        const span = makeSpan(SpanStatusCode.ERROR, TraceFlags.NONE);

        expect(() => processor.onEnd(span)).not.toThrow();
      });
    });

    describe("exporter returns a FAILED result", () => {
      it("does not throw — failures are silently swallowed", () => {
        const exporter = makeExporter({
          export: jest.fn((_spans, cb) =>
            cb({ code: ExportResultCode.FAILED }),
          ),
        });
        const processor = new ErrorSpanProcessor(exporter);
        const span = makeSpan(SpanStatusCode.ERROR, TraceFlags.NONE);

        expect(() => processor.onEnd(span)).not.toThrow();
      });
    });
  });

  describe("forceFlush()", () => {
    it("delegates to the exporter's forceFlush", async () => {
      const exporter = makeExporter();
      const processor = new ErrorSpanProcessor(exporter);

      await processor.forceFlush();

      expect(exporter.forceFlush).toHaveBeenCalled();
    });

    it("resolves even when the exporter has no forceFlush method", async () => {
      const exporter: SpanExporter = {
        export: jest.fn(),
        shutdown: jest.fn(() => Promise.resolve()),
      };
      const processor = new ErrorSpanProcessor(exporter);

      await expect(processor.forceFlush()).resolves.toBeUndefined();
    });
  });

  describe("shutdown()", () => {
    it("does not call exporter.shutdown (lifecycle owned by BatchSpanProcessor)", async () => {
      const exporter = makeExporter();
      const processor = new ErrorSpanProcessor(exporter);

      await processor.shutdown();

      expect(exporter.shutdown).not.toHaveBeenCalled();
    });

    it("resolves successfully", async () => {
      const exporter = makeExporter();
      const processor = new ErrorSpanProcessor(exporter);

      await expect(processor.shutdown()).resolves.toBeUndefined();
    });
  });
});
