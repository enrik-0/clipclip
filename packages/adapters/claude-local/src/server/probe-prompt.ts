/**
 * Prompt of the Claude hello probe, shared by the CLI and ACP test lanes.
 *
 * The probe passes only when the reply matches /\bhello\b/i. A bare "Respond with
 * hello." makes a Claude that is configured to answer in another language (for
 * example Spanish) reply "¡Hola!", so the probe failed with `unexpected_output`
 * even though the login worked. Asking for the literal English word keeps the
 * check strict and independent of the user's response language.
 */
export const CLAUDE_HELLO_PROBE_PROMPT =
  "Respond with exactly one word, in English, with no other text: hello";

/** Fixed hint for `claude_hello_probe_unexpected_output`; never includes probe output. */
export const CLAUDE_HELLO_UNEXPECTED_OUTPUT_HINT =
  "The probe expects the English word `hello`. A configured response language or a custom system prompt can change the reply. Try the probe manually (`claude --print - --output-format stream-json --verbose`) and prompt `Respond with exactly one word, in English, with no other text: hello`.";
