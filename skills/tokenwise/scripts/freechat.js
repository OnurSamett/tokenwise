#!/usr/bin/env node
// Free-tier OpenAI-compatible chat APIs as a read-only fallback worker (plain chat, no tools).
// Providers are tried in order; a rate limit or server error on one moves on to the next.
//   NVIDIA (build.nvidia.com)  NVIDIA_API_KEY
//   OpenRouter ":free" models  OPENROUTER_API_KEY
//   Groq                       GROQ_API_KEY
//   Mistral (free tier)        MISTRAL_API_KEY
//   any OpenAI-compatible API  TOKENWISE_FREE_BASE + TOKENWISE_FREE_KEY (+ TOKENWISE_FREE_MODEL)
// Order: TOKENWISE_FREE_PROVIDERS (default "nvidia,openrouter,groq,mistral,custom").
// Per-provider model override: TOKENWISE_<NAME>_MODEL (e.g. TOKENWISE_NVIDIA_MODEL); TOKENWISE_FREE_MODEL for the first one.
// Never prints or logs an API key.
import { pathToFileURL } from "node:url";

// `rank`: preferred model patterns, best first. Models not matching any pattern are kept as a last resort.
const KNOWN = {
  nvidia: { env: "NVIDIA_API_KEY", base: "https://integrate.api.nvidia.com/v1",
    rank: [/kimi-k3/i, /mistral-large-4/i, /deepseek-v4/i, /glm-5/i, /nemotron-3-ultra/i, /step-?5/i, /minimax-m3/i, /kimi-k2/i, /laguna/i, /gpt-oss-120b/i, /nemotron-3-super/i, /qwen3/i, /gpt-oss-20b/i] },
  openrouter: { env: "OPENROUTER_API_KEY", base: "https://openrouter.ai/api/v1", onlyFree: true,
    rank: [/kimi-k2/i, /deepseek/i, /glm/i, /qwen3.*coder/i, /gpt-oss-120b/i, /qwen/i, /llama/i] },
  groq: { env: "GROQ_API_KEY", base: "https://api.groq.com/openai/v1", rank: [/gpt-oss-120b/i, /kimi/i, /qwen/i, /llama-3\.3-70b|llama-4/i, /gpt-oss/i] },
  mistral: { env: "MISTRAL_API_KEY", base: "https://api.mistral.ai/v1", rank: [/mistral-large/i, /mistral-medium/i, /devstral|codestral/i] },
};

/** Configured providers in priority order: [{ name, base, key, prefer, onlyFree }]. */
export function freeProviders() {
  const order = (process.env.TOKENWISE_FREE_PROVIDERS || "nvidia,openrouter,groq,mistral,custom").split(",").map((s) => s.trim());
  const out = [];
  for (const name of order) {
    if (name === "custom") {
      if (process.env.TOKENWISE_FREE_BASE && process.env.TOKENWISE_FREE_KEY && /^[\x21-\x7e]+$/.test(process.env.TOKENWISE_FREE_KEY)) out.push({ name: "custom", base: process.env.TOKENWISE_FREE_BASE.replace(/\/$/, ""), key: process.env.TOKENWISE_FREE_KEY, rank: [] });
      continue;
    }
    const k = KNOWN[name];
    if (k && process.env[k.env]) {
      // A key with spaces/newlines/control characters would end up inside an error message: refuse it instead.
      if (!/^[\x21-\x7e]+$/.test(process.env[k.env])) { process.stderr.write(`${k.env} contains invalid characters; skipping ${name}\n`); continue; }
      out.push({ name, ...k, key: process.env[k.env] });
    }
  }
  return out;
}
export const freeProvider = () => freeProviders()[0] || null;

const picked = new Map();
/** Up to 3 candidate models for this provider, best first. */
export async function pickModels(p, first = false) {
  const forced = process.env[`TOKENWISE_${p.name.toUpperCase()}_MODEL`] || (first ? process.env.TOKENWISE_FREE_MODEL : null);
  if (forced) return [forced];
  if (picked.has(p.name)) return picked.get(p.name);
  const res = await fetch(`${p.base}/models`, { headers: { Authorization: `Bearer ${p.key}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw Object.assign(new Error(`models list failed (HTTP ${res.status})`), { status: res.status });
  const body = await res.json();
  let ids = (Array.isArray(body?.data) ? body.data : [])
    .filter((m) => !p.onlyFree || (m?.pricing?.prompt === "0" && m?.pricing?.completion === "0") || String(m?.id).endsWith(":free"))
    .map((m) => String(m.id))
    // Skip embedding / vision / speech / safety models.
    .filter((id) => !/embed|rerank|guard|safety|vision|-vl\b|-vl-|vlm|tts|whisper|asr|ocr|parse|reward/i.test(id));
  const score = (id) => { const i = p.rank.findIndex((re) => re.test(id)); return i < 0 ? p.rank.length : i; };
  const size = (id) => Number((id.match(/(\d+(?:\.\d+)?)b\b/i) || [])[1] || 0);
  ids.sort((a, b) => score(a) - score(b) || size(b) - size(a));
  const list = ids.slice(0, 3);
  if (!list.length) throw new Error(`no usable model found on ${p.name}`);
  picked.set(p.name, list);
  return list;
}
export const pickModel = async (p, first) => (await pickModels(p, first))[0];

const KEYS = ["NVIDIA_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "TOKENWISE_FREE_KEY"].map((k) => process.env[k]).filter(Boolean)
  // raw key, its JSON-escaped form, and every line fragment, so a malformed key can't leak through an error message
  .flatMap((v) => [v, JSON.stringify(v).slice(1, -1), ...v.split(/[\r\n\t]+/)]).filter((v) => v.length > 6);
const out = (o) => process.stdout.write(KEYS.reduce((s, k) => s.split(k).join("***"), JSON.stringify(o)) + "\n");
async function readStdin() { let s = ""; for await (const c of process.stdin) s += c; return s.trim(); }

async function ask(p, model, task) {
  const res = await fetch(`${p.base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, stream: false,
      messages: [
        { role: "system", content: "You are a careful read-only assistant. Answer the task concisely. You cannot see any files except what is in the task." },
        { role: "user", content: task },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw Object.assign(new Error(res.status === 429 ? `rate limit reached on ${p.name}` : `HTTP ${res.status} from ${p.name}: ${t}`), { status: res.status });
  }
  return res.json();
}

async function main() {
  const providers = freeProviders();
  if (!providers.length) {
    out({ type: "free.error", status: 0, message: "no free provider: set NVIDIA_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY or MISTRAL_API_KEY" });
    process.exit(2);
  }
  const task = process.argv[2] ?? (await readStdin());
  if (!task) { out({ type: "free.error", status: 0, message: "empty task" }); process.exit(1); }

  let last = null;
  for (const [i, p] of providers.entries()) {
    let models;
    try { models = await pickModels(p, i === 0); }
    catch (e) { last = { status: Number(e?.status) || 0, message: String(e?.message || e).slice(0, 200) }; out({ type: "free.skip", provider: p.name, status: last.status, message: last.message }); continue; }
    for (const model of models) {
      try {
        out({ type: "free.init", provider: p.name, model });
        const data = await ask(p, model, task);
        out({ type: "free.message", text: data?.choices?.[0]?.message?.content ?? "" });
        out({ type: "free.usage", usage: { prompt_tokens: data?.usage?.prompt_tokens ?? 0, completion_tokens: data?.usage?.completion_tokens ?? 0 } });
        return;
      } catch (e) {
        const status = Number(e?.status) || 0;
        last = { status, message: e?.name === "TimeoutError" ? `request to ${p.name} timed out after 120s` : String(e?.message || e).slice(0, 200) };
        out({ type: "free.skip", provider: p.name, model, status, message: last.message });
        // Bad key or rate limit: the whole provider is out, move on. Missing/unavailable model: try its next model.
        if (status === 401 || status === 403 || status === 429) break;
      }
    }
  }
  out({ type: "free.error", status: last?.status || 0, message: last?.status === 429 || /rate limit/i.test(last?.message || "") ? `rate limit reached on every free provider (${last.message})` : last?.message });
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
