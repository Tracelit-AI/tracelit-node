import type { Context, SpanKind, Attributes, Link } from "@opentelemetry/api";
import {
  type Sampler,
  type SamplingResult,
  SamplingDecision,
} from "@opentelemetry/sdk-trace-base";
import { TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";

/**
 * ErrorAlwaysOnSampler wraps a ratio-based sampler and upgrades NOT_RECORD
 * decisions to RECORD. This guarantees that span processors — and in
 * particular ErrorSpanProcessor — fire onEnd for every span, even those
 * outside the configured sampling ratio.
 *
 * Without this, TraceIdRatioBasedSampler(0) returns NOT_RECORD, which causes
 * the SDK to produce NonRecordingSpans that bypass the processor pipeline
 * entirely, so ErrorSpanProcessor.onEnd is never called.
 *
 * With RECORD (not RECORD_AND_SAMPLED):
 *  - Real spans are created and all processors fire.
 *  - BatchSpanProcessor skips them because traceFlags.SAMPLED is not set.
 *  - ErrorSpanProcessor sees them and exports any that finish with ERROR status.
 */
export class ErrorAlwaysOnSampler implements Sampler {
  private readonly inner: TraceIdRatioBasedSampler;

  constructor(rate: number) {
    this.inner = new TraceIdRatioBasedSampler(rate);
  }

  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[],
  ): SamplingResult {
    // TraceIdRatioBasedSampler in OTel JS v2 only uses context + traceId.
    // Cast to the Sampler interface to forward all arguments as required by
    // the interface contract, without TypeScript narrowing to the 2-arg overload.
    const sampler: Sampler = this.inner;
    const result = sampler.shouldSample(
      context,
      traceId,
      spanName,
      spanKind,
      attributes,
      links,
    );

    if (result.decision !== SamplingDecision.NOT_RECORD) {
      return result;
    }

    // Upgrade NOT_RECORD → RECORD so the processor pipeline fires.
    // RECORD (without SAMPLED flag) means BatchSpanProcessor will ignore the
    // span during normal export, while ErrorSpanProcessor can still see it.
    const upgraded: SamplingResult = { decision: SamplingDecision.RECORD };
    if (result.attributes !== undefined) upgraded.attributes = result.attributes;
    if (result.traceState !== undefined) upgraded.traceState = result.traceState;
    return upgraded;
  }

  toString(): string {
    return `ErrorAlwaysOnSampler{${this.inner.toString()}}`;
  }
}
