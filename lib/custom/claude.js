// Minimal streaming client for the Anthropic Messages API.
// Forces a single tool call so the output is always valid JSON.
const API = process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages";

async function callJSON({ system, content, toolName = "write", description = "Write the result.", maxTokens = 16000, model }) {
  if (process.env.VB_MOCK) return require("./mock")(toolName);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const body = {
    model: model || process.env.CLAUDE_MODEL || "claude-opus-5-5",
    max_tokens: maxTokens,
    stream: true,
    system,
    // Some models refuse a forced tool_choice, so the tool is offered with "auto" and the
    // system prompt requires it. If the model answers in plain text instead, that JSON is parsed.
    tools: [{ name: toolName, description, input_schema: { type: "object", additionalProperties: true } }],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content }],
  };
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Claude API ${res.status}: ${t.slice(0, 500)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", json = "", text = "", stop = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "input_json_delta") json += ev.delta.partial_json;
      else if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") text += ev.delta.text;
      else if (ev.type === "message_delta" && ev.delta) stop = ev.delta.stop_reason || stop;
      else if (ev.type === "error") throw new Error("Claude API stream error: " + JSON.stringify(ev.error));
    }
  }
  if (stop === "max_tokens") throw new Error("Output hit max_tokens");
  if (json.trim()) {
    try { return JSON.parse(json); } catch (e) { throw new Error("Could not parse model JSON: " + json.slice(0, 300)); }
  }
  // Fallback: JSON written as text (possibly inside a code fence).
  const i = text.indexOf("{"), j = text.lastIndexOf("}");
  if (i >= 0 && j > i) {
    try { return JSON.parse(text.slice(i, j + 1)); } catch (e) {}
  }
  throw new Error("Model returned no JSON: " + text.slice(0, 300));
}

async function withRetry(fn, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(i); } catch (e) { last = e; console.error("[claude] attempt", i + 1, "failed:", e.message); }
  }
  throw last;
}

module.exports = { callJSON, withRetry };
