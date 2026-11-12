import { describe, expect, it } from "vitest";
import {
  CLAUDE_HELLO_PROBE_PROMPT,
  CLAUDE_HELLO_UNEXPECTED_OUTPUT_HINT,
} from "./probe-prompt.js";

describe("Claude hello probe prompt", () => {
  it("asks for the literal English word so a configured response language cannot fail the probe", () => {
    // A bare "Respond with hello." makes a Claude configured to answer in Spanish
    // reply "¡Hola!", which does not match /\bhello\b/i and fails the probe.
    expect(CLAUDE_HELLO_PROBE_PROMPT).toMatch(/\benglish\b/i);
    expect(CLAUDE_HELLO_PROBE_PROMPT).toMatch(/\bhello\b/);
    expect(CLAUDE_HELLO_PROBE_PROMPT).toMatch(/\bone word\b/i);
  });

  it("explains in the unexpected-output hint that a response language can cause it", () => {
    expect(CLAUDE_HELLO_UNEXPECTED_OUTPUT_HINT).toMatch(/language/i);
    expect(CLAUDE_HELLO_UNEXPECTED_OUTPUT_HINT).toMatch(/\bhello\b/);
  });

  it("keeps the hint free of untrusted or interpolated content", () => {
    expect(CLAUDE_HELLO_UNEXPECTED_OUTPUT_HINT).not.toMatch(/\$\{|%s|undefined/);
  });
});
