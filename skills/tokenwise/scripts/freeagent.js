#!/usr/bin/env node
// A small, locked-down tool-using agent loop on top of free OpenAI-compatible chat APIs (NVIDIA,
// OpenRouter, Groq, Mistral, custom). The model is UNTRUSTED: it can read the repo and, in write mode,
// edit files inside the job's own folder (a git worktree in tokenwise studio). It cannot run commands.
//
// Usage: freeagent.js [--write] "<task>"        (cwd = the folder the agent may touch)
// Output: JSON lines (free.init, free.tool, free.skip, free.message, free.usage, free.error).
//
// Safety:
// - One path policy for every tool: inside the working folder, no symlink in any existing path
//   component, no `.git` component, no secret files (.env, keys, tokens, credentials).
// - Writes and reads go through O_NOFOLLOW file descriptors; sizes are capped; only regular files are read.
// - No command execution, no regex from model input (search is a literal substring match).
// - Hard limits: max steps and a wall-clock limit for the whole run.
// Never prints an API key.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { freeProviders, pickModels } from "./freechat.js";

const MAX_STEPS = Number(process.env.TOKENWISE_FREE_MAX_STEPS || 40);
const MAX_MINUTES = Number(process.env.TOKENWISE_FREE_MAX_MINUTES) > 0 ? Number(process.env.TOKENWISE_FREE_MAX_MINUTES) : 15;
const MAX_READ = 2 << 20, MAX_WRITE = 1 << 20, MAX_SEARCH_FILE = 1_000_000, MAX_SEARCH_TOTAL = 50 << 20, MAX_HITS = 120;
const SKIP_DIRS = new Set([".git", "node_modules", ".tokenwise-studio", "__pycache__", ".venv", "venv", "dist", "build", ".next", "target"]);
const SECRET_FILE = [/^\.env(\..*)?$/i, /^\.envrc$/i, /^\.dev\.vars$/i, /\.(pem|key|p12|pfx|keystore|jks|tfvars|tfstate)$/i, /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^\.(npmrc|pypirc|netrc|pgpass|git-credentials)$/i, /^(credentials|secrets?)(\.\w+)?$/i];
// macOS file names are case-insensitive and Unicode-folding ("ſecrets" opens "secrets"), so compare a
// normalized form; and refuse non-ASCII path parts outright to close lookalike tricks.
const norm = (name) => String(name).normalize("NFKC").toLowerCase();
const isSecret = (name) => SECRET_FILE.some((re) => re.test(norm(name)));
const BLOCKED_DIRS = new Set([".git", ".tokenwise-studio", ".docker", ".ssh", ".aws", ".gnupg"]);
// Never let an API key reach the output, even inside an error message.
const KEYS = ["NVIDIA_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "TOKENWISE_FREE_KEY"].map((k) => process.env[k]).filter(Boolean)
  // raw key, its JSON-escaped form, and every line fragment, so a malformed key can't leak through an error message
  .flatMap((v) => [v, JSON.stringify(v).slice(1, -1), ...v.split(/[\r\n\t]+/)]).filter((v) => v.length > 6);
const redact = (t) => KEYS.reduce((s, k) => s.split(k).join("***"), String(t));
const out = (o) => process.stdout.write(redact(JSON.stringify(o)) + "\n");

// ---------- path policy (used by every tool) ----------
const ROOT = fs.realpathSync(process.cwd());
// Returns the absolute path, or throws. `file: true` additionally blocks secret file names.
function safePath(p, { file = false } = {}) {
  const abs = path.resolve(ROOT, String(p || "."));
  const rel = path.relative(ROOT, abs);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) throw new Error(`path outside the working folder: ${p}`);
  const parts = rel ? rel.split(path.sep) : [];
  if (parts.some((x) => /[^\x20-\x7e]/.test(x))) throw new Error(`non-ASCII path names are not allowed: ${p}`);
  if (parts.some((x) => BLOCKED_DIRS.has(norm(x)))) throw new Error(`access to this folder is not allowed: ${p}`);
  if (file && parts.length && isSecret(parts[parts.length - 1])) throw new Error(`secret files are not accessible: ${p}`);
  // Every existing component, including the last, must not be a symbolic link.
  let cur = ROOT;
  for (const part of parts) {
    cur = path.join(cur, part);
    let st;
    try { st = fs.lstatSync(cur); } catch (e) { if (e.code === "ENOENT") break; throw new Error(`cannot access ${p}: ${e.code || e.message}`); }
    if (st.isSymbolicLink()) throw new Error(`symbolic links are not allowed: ${p}`);
  }
  return abs;
}
const relp = (abs) => path.relative(ROOT, abs) || ".";

// Read a regular file (never a FIFO, device, directory or symlink) through an O_NOFOLLOW descriptor.
function readText(abs, max) {
  const st = fs.lstatSync(abs);
  if (!st.isFile()) throw new Error(`not a regular file: ${relp(abs)}`);
  if (st.size > max) throw new Error(`file too large (${st.size} bytes, limit ${max}): ${relp(abs)}`);
  const fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { return fs.readFileSync(fd, "utf8"); } finally { fs.closeSync(fd); }
}
// Write through an O_NOFOLLOW descriptor after re-checking the (possibly just created) parent folder.
function writeText(abs, content) {
  if (Buffer.byteLength(content) > MAX_WRITE) throw new Error(`content too large (limit ${MAX_WRITE} bytes)`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  safePath(path.dirname(abs));
  try { if (!fs.lstatSync(abs).isFile()) throw new Error(`not a regular file: ${relp(abs)}`); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW } = fs.constants;
  const fd = fs.openSync(abs, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0o644);
  try { fs.writeFileSync(fd, content); } finally { fs.closeSync(fd); }
}

// ---------- tools ----------
function listDir(p = ".") {
  const abs = safePath(p);
  const items = fs.readdirSync(abs, { withFileTypes: true }).filter((d) => !SKIP_DIRS.has(d.name)).slice(0, 300);
  return items.map((d) => (d.isDirectory() ? d.name + "/" : d.name)).join("\n") || "(empty)";
}
function readFile(p, start, end) {
  const lines = readText(safePath(p, { file: true }), MAX_READ).split("\n");
  const a = Math.max(1, Number(start) || 1), b = Math.min(lines.length, Number(end) || lines.length);
  const text = lines.slice(a - 1, b).map((l, i) => `${a + i}: ${l}`).join("\n");
  return text.length > 60000 ? text.slice(0, 60000) + "\n…(truncated; ask for a line range)" : text;
}
// Literal, case-insensitive substring search (no regex from model input).
function search(pattern, p = ".") {
  const needle = String(pattern ?? "").toLowerCase();
  if (!needle) throw new Error("empty search pattern");
  const hits = [];
  let scanned = 0;
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (hits.length >= MAX_HITS || scanned >= MAX_SEARCH_TOTAL) return;
      if (SKIP_DIRS.has(d.name) || d.isSymbolicLink()) continue;
      const f = path.join(dir, d.name);
      if (d.isDirectory()) { walk(f); continue; }
      if (!d.isFile() || isSecret(d.name)) continue;
      let text;
      try {
        const size = fs.lstatSync(f).size;
        if (size > MAX_SEARCH_FILE) continue;
        scanned += size;
        text = readText(f, MAX_SEARCH_FILE);
      } catch { continue; }
      text.split("\n").forEach((l, i) => { if (hits.length < MAX_HITS && l.toLowerCase().includes(needle)) hits.push(`${relp(f)}:${i + 1}: ${l.slice(0, 200)}`); });
    }
  };
  walk(safePath(p));
  return hits.join("\n") || "(no matches)";
}
function writeFile(p, content) {
  const abs = safePath(p, { file: true });
  writeText(abs, String(content));
  return `wrote ${relp(abs)} (${String(content).length} chars)`;
}
function replaceInFile(p, oldText, newText) {
  const abs = safePath(p, { file: true });
  const s = readText(abs, MAX_READ);
  const n = s.split(String(oldText)).length - 1;
  if (n === 0) throw new Error("old_text not found; read the file again and copy the exact text");
  if (n > 1) throw new Error(`old_text appears ${n} times; include more surrounding lines to make it unique`);
  writeText(abs, s.replace(String(oldText), () => String(newText)));
  return `edited ${relp(abs)}`;
}

const fn = (name, description, properties, required) => ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });
const READ_TOOLS = [
  fn("list_dir", "List files and folders (relative path, default '.').", { path: { type: "string" } }, []),
  fn("read_file", "Read a text file with line numbers; optionally a line range.", { path: { type: "string" }, start_line: { type: "integer" }, end_line: { type: "integer" } }, ["path"]),
  fn("search", "Search file contents for a literal text (case-insensitive substring, not a regex) under a folder.", { pattern: { type: "string" }, path: { type: "string" } }, ["pattern"]),
];
const WRITE_TOOLS = [
  fn("replace_in_file", "Replace one exact, unique snippet in a file. Prefer this for edits.", { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, ["path", "old_text", "new_text"]),
  fn("write_file", "Create or overwrite a whole file.", { path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
];
function callTool(name, a) {
  switch (name) {
    case "list_dir": return listDir(a.path);
    case "read_file": return readFile(a.path, a.start_line, a.end_line);
    case "search": return search(a.pattern, a.path);
    case "replace_in_file": return replaceInFile(a.path, a.old_text, a.new_text);
    case "write_file": return writeFile(a.path, a.content);
    default: throw new Error(`unknown tool ${name}`);
  }
}
const toolEvent = (name, a) => ({
  list_dir: { kind: "search", text: `list ${a.path || "."}` }, read_file: { kind: "read", text: a.path },
  search: { kind: "search", text: `search ${a.pattern}` }, replace_in_file: { kind: "edit", text: `edit ${a.path}` },
  write_file: { kind: "edit", text: `write ${a.path}` },
}[name] || { kind: "tool", text: name });

// ---------- the loop ----------
async function chat(p, model, messages, tools, timeoutMs = 180_000) {
  const res = await fetch(`${p.base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools, tool_choice: "auto", stream: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const t = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw Object.assign(new Error(res.status === 429 ? `rate limit reached on ${p.name}` : `HTTP ${res.status} from ${p.name}: ${t}`), { status: res.status });
  }
  return res.json();
}

async function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes("--write");
  const task = argv.filter((x) => x !== "--write").join(" ").trim();
  const providers = freeProviders();
  if (!providers.length) { out({ type: "free.error", status: 0, message: "no free provider: set NVIDIA_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY or MISTRAL_API_KEY" }); process.exit(2); }
  if (!task) { out({ type: "free.error", status: 0, message: "empty task" }); process.exit(1); }

  const tools = write ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS;
  const messages = [
    { role: "system", content: `You are a careful coding worker. Your working folder is the project root; use relative paths. Use the tools to look at the code before answering${write ? ", then make the smallest correct change. You cannot run commands or tests" : ". You cannot change files or run commands"}. Do exactly the task, nothing more. When done, reply with a short summary (what you found or changed${write ? ", and which test command the user should run to verify it" : ""}).` },
    { role: "user", content: task },
  ];
  // Candidate (provider, model) pairs in order; the conversation is portable, so a rate limit
  // mid-task just continues on the next pair.
  const pairs = [];
  for (const [i, p] of providers.entries()) {
    try { for (const m of await pickModels(p, i === 0)) pairs.push([p, m]); }
    catch (e) { out({ type: "free.skip", provider: p.name, status: Number(e?.status) || 0, message: String(e?.message || e).slice(0, 200) }); }
  }
  if (!pairs.length) { out({ type: "free.error", status: 0, message: "no usable free model" }); process.exit(1); }

  let k = 0, usage = { prompt_tokens: 0, completion_tokens: 0 }, announced = -1, last = null;
  const deadline = Date.now() + MAX_MINUTES * 60_000;
  const timeUp = () => {
    if (Date.now() < deadline) return false;
    out({ type: "free.usage", usage });
    out({ type: "free.error", status: 0, message: `stopped after the ${MAX_MINUTES} minute time limit` });
    process.exit(1);
  };
  for (let step = 0; step < MAX_STEPS; step++) {
    timeUp();
    if (k >= pairs.length) break;
    const [p, model] = pairs[k];
    if (announced !== k) { out({ type: "free.init", provider: p.name, model, agent: true, write }); announced = k; }
    let data;
    try { data = await chat(p, model, messages, tools, Math.max(1000, Math.min(180_000, deadline - Date.now()))); }
    catch (e) {
      const status = Number(e?.status) || 0;
      last = { status, message: e?.name === "TimeoutError" ? `request to ${p.name} timed out` : String(e?.message || e).slice(0, 200) };
      out({ type: "free.skip", provider: p.name, model, status, message: last.message });
      // Bad key or rate limit: skip this provider's other models too.
      if (status === 401 || status === 403 || status === 429) { const name = p.name; while (k < pairs.length && pairs[k][0].name === name) k++; } else k++;
      step--; continue;
    }
    usage.prompt_tokens += data?.usage?.prompt_tokens || 0;
    usage.completion_tokens += data?.usage?.completion_tokens || 0;
    const msg = data?.choices?.[0]?.message || {};
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      out({ type: "free.message", text: msg.content || "" });
      out({ type: "free.usage", usage });
      return;
    }
    messages.push({ role: "assistant", content: msg.content || null, tool_calls: calls });
    for (const c of calls) {
      timeUp();
      if (!c || typeof c !== "object") continue;
      let a = {}; try { a = JSON.parse(c.function?.arguments || "{}"); } catch {}
      if (!a || typeof a !== "object" || Array.isArray(a)) a = {};
      const name = c.function?.name;
      let result;
      try {
        if (!tools.some((t) => t.function.name === name)) throw new Error(`tool ${name} is not available in this mode`);
        result = callTool(name, a);
        out({ type: "free.tool", ...toolEvent(name, a) });
      } catch (e) {
        result = `ERROR: ${e.message}`;
        out({ type: "free.tool", ...toolEvent(name, a), error: e.message });
      }
      messages.push({ role: "tool", tool_call_id: c.id, content: String(result) });
    }
  }
  out({ type: "free.usage", usage });
  out({ type: "free.error", status: last?.status || 0, message: last ? (last.status === 429 || /rate limit/i.test(last.message) ? `rate limit reached on every free provider (${last.message})` : last.message) : `stopped after ${MAX_STEPS} steps without finishing` });
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { out({ type: "free.error", status: 0, message: redact(String(e?.message || e)).slice(0, 200) }); process.exit(1); });
}
