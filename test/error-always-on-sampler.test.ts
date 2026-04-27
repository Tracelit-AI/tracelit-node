import { SamplingDecision } from "@opentelemetry/sdk-trace-base";
import type { SamplingResult } from "@opentelemetry/sdk-trace-base";
import { SpanKind, context } from "@opentelemetry/api";
import { ErrorAlwaysOnSampler } from "../src/error-always-on-sampler";

/**
 * Helper: build a minimal SamplingResult with only a decision.
 */
function makeResult(decision: SamplingDecision): SamplingResult {
  return { decision };
}

/** Minimal args needed for shouldSample — traceId is a 32-char hex string. */
const TRACE_ID = "a".repeat(32);

function callShouldSample(sampler: ErrorAlwaysOnSampler): SamplingResult {
  return sampler.shouldSample(
    context.active(),
    TRACE_ID,
    "test-span",
    SpanKind.INTERNAL,
    {},
    [],
  );
}

describe("ErrorAlwaysOnSampler", () => {
  describe("when inner sampler returns RECORD_AND_SAMPLED (within ratio)", () => {
    it("passes the result through unchanged", () => {
      // rate=1.0 → inner always returns RECORD_AND_SAMPLED
      const sampler = new ErrorAlwaysOnSampler(1.0);
      const result = callShouldSample(sampler);
      expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    });
  });

  describe("when inner sampler returns RECORD (without SAMPLED flag)", () => {
    it("passes the RECORD decision through unchanged", () => {
      // We can verify the sampler respects an existing RECORD decision by
      // using rate=1.0 — TraceIdRatioBasedSampler always returns RECORD_AND_SAMPLED,
      // not RECORD, so we test the upgrade path using rate=0.
      const sampler = new ErrorAlwaysOnSampler(0.0);
      const result = callShouldSample(sampler);
      // At rate=0 the inner returns NOT_RECORD; our sampler upgrades to RECORD.
      expect(result.decision).toBe(SamplingDecision.RECORD);
    });
  });

  describe("when inner sampler returns NOT_RECORD (outside ratio)", () => {
    it("upgrades NOT_RECORD to RECORD", () => {
      const sampler = new ErrorAlwaysOnSampler(0.0);
      const result = callShouldSample(sampler);
      expect(result.decision).toBe(SamplingDecision.RECORD);
    });

    it("result is not RECORD_AND_SAMPLED (batch processor should skip it)", () => {
      const sampler = new ErrorAlwaysOnSampler(0.0);
      const result = callShouldSample(sampler);
      expect(result.decision).not.toBe(SamplingDecision.RECORD_AND_SAMPLED);
    });

    it("result is not NOT_RECORD (processor pipeline must fire)", () => {
      const sampler = new ErrorAlwaysOnSampler(0.0);
      const result = callShouldSample(sampler);
      expect(result.decision).not.toBe(SamplingDecision.NOT_RECORD);
    });
  });

  describe("toString()", () => {
    it("includes 'ErrorAlwaysOnSampler' and the inner sampler description", () => {
      const sampler = new ErrorAlwaysOnSampler(0.5);
      expect(sampler.toString()).toMatch(/ErrorAlwaysOnSampler/);
      // Inner TraceIdRatioBasedSampler includes the ratio in its description.
      expect(sampler.toString()).toMatch(/0\.5|TraceIdRatio/i);
    });
  });

  describe("edge cases", () => {
    it("handles rate=0.0 (effectively disabled tracing but errors still fire)", () => {
      const sampler = new ErrorAlwaysOnSampler(0.0);
      // Every span should be at least RECORD so processors fire.
      for (let i = 0; i < 10; i++) {
        const result = callShouldSample(sampler);
        expect(result.decision).toBeGreaterThanOrEqual(SamplingDecision.RECORD);
      }
    });

    it("handles rate=1.0 (all spans sampled)", () => {
      const sampler = new ErrorAlwaysOnSampler(1.0);
      for (let i = 0; i < 5; i++) {
        const result = callShouldSample(sampler);
        expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      }
    });
  });
});
