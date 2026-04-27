import type { Context } from "@opentelemetry/api";
import { SpanStatusCode, TraceFlags } from "@opentelemetry/api";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { SpanProcessor, Span } from "@opentelemetry/sdk-trace-base";
import { ExportResultCode } from "@opentelemetry/core";

/**
 * ErrorSpanProcessor ensures error spans are always exported regardless of
 * the sampling decision made at span creation time.
 *
 * How it works:
 * - ErrorAlwaysOnSampler returns RECORD (not NOT_RECORD) for unsampled spans,
 *   which ensures onEnd is called for every span.
 * - On span end, if the span has status ERROR, this processor forces it through
 *   the exporter directly, bypassing the BatchSpanProcessor.
 * - BatchSpanProcessor ignores RECORD spans (traceFlags.SAMPLED === false),
 *   so there is no double-export for sampled error spans.
 *
 * NOTE: shutdown() is intentionally a no-op because this processor shares the
 * exporter instance with BatchSpanProcessor, which owns the exporter lifecycle.
 */
export class ErrorSpanProcessor implements SpanProcessor {
  private readonly exporter: SpanExporter;

  constructor(exporter: SpanExporter) {
    this.exporter = exporter;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onStart(_span: Span, _parentContext: Context): void {
    // nothing to do at span creation time
  }

  onEnd(span: ReadableSpan): void {
    try {
      // Only intervene for spans that finished with ERROR status.
      if (span.status.code !== SpanStatusCode.ERROR) return;

      // If the span was fully sampled, BatchSpanProcessor will export it.
      // Skip to avoid double-export.
      if (span.spanContext().traceFlags & TraceFlags.SAMPLED) return;

      // Force-export this unsampled error span immediately.
      this.exporter.export([span], (result) => {
        if (result.code === ExportResultCode.FAILED) {
          // Intentionally silent — telemetry errors must never crash the app.
        }
      });
    } catch {
      // Swallow all exceptions — processor errors must never propagate.
    }
  }

  forceFlush(): Promise<void> {
    return this.exporter.forceFlush?.() ?? Promise.resolve();
  }

  shutdown(): Promise<void> {
    // Do not shut down the shared exporter here.
    // BatchSpanProcessor owns its lifecycle.
    return Promise.resolve();
  }
}
