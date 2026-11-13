#!/usr/bin/env node
// A small, safe tool-using agent loop on top of free OpenAI-compatible chat APIs (NVIDIA, OpenRouter,
// Groq, Mistral, custom). Lets free models work like real workers: read the repo, and in write mode
// edit files and run tests inside the job's own folder (a git worktree in tokenwise studio).
//
// Usage: freeagent.js [--write] "<task>"        (cwd = the folder the agent may touch)
// Output: JSON lines (free.init, free.tool, free.skip, free.message, free.usage, free.error).
//
// Safety:
// - Every path must resolve inside the working folder (symlink escapes are blocked).
// - Commands run without a shell, only from a fixed allowlist (tests, syntax checks, read-only git).
// - Read-only mode has no write/command tools at all.
// Never prints an API key.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { freeProviders, pickModels } from "./freechat.js";

const MAX_STEPS = Number(process.env.TOKENWISE_FREE_MAX_STEPS || 40);
const SKIP_DIRS = new Set([".git", "node_modules", ".tokenwise-studio", "__pycache__", ".venv", "venv", "dist", "build", ".next", "target"]);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

// ---------- sandboxed file access ----------
const ROOT = fs.realpathSync(process.cwd());
function safePath(p) {
  const abs = path.resolve(ROOT, String(p || "."));
  const inside = (x) => x === ROOT || x.startsWith(ROOT + path.sep);
  if (!inside(abs)) throw new Error(`path outside the working folder: ${p}`);
  // Resolve symlinks of the deepest existing ancestor to block escapes through links.
  let probe = abs;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  if (!inside(fs.realpathSync(probe))) throw new Error(`path escapes the working folder through a link: ${p}`);
  return abs;
}
const relp = (abs) => path.relative(ROOT, abs) || ".";

// ---------- command allowlist (no shell) ----------
function splitArgs(cmd) {
  const args = []; let cur = "", q = null;
  for (const ch of String(cmd)) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === "'" || ch === '"') { q = ch; continue; }
    if (/\s/.test(ch)) { if (cur) { args.push(cur); cur = ""; } continue; }
    if (/[;&|<>`$]/.test(ch)) throw new Error("shell operators are not allowed");
    cur += ch;
  }
  if (q) throw new Error("unbalanced quotes");
  if (cur) args.push(cur);
  return args;
}
const ALLOWED = [
  (a) => /^python3?$/.test(a[0]) && a[1] === "-m" && ["unittest", "pytest", "py_compile"].includes(a[2]),
  (a) => a[0] === "pytest",
  (a) => a[0] === "node" && (a[1] === "--check" || a[1] === "--test"),
  (a) => a[0] === "npm" && (a[1] === "test" || (a[1] === "run" && /^(test|lint|build|typecheck)(:\S+)?$/.test(a[2] || ""))),
  (a) => a[0] === "go" && (a[1] === "test" || a[1] === "vet" || a[1] === "build"),
  (a) => a[0] === "cargo" && ["test", "check", "build"].includes(a[1]),
  (a) => a[0] === "git" && ["status", "diff", "log", "show"].includes(a[1]),
];
function runCommand(cmd) {
  const args = splitArgs(cmd);
  if (!args.length || !ALLOWED.some((ok) => ok(args))) {
    throw new Error("command not allowed. Allowed: python3 -m unittest|pytest|py_compile, pytest, node --check|--test, npm test / npm run test|lint|build|typecheck, go test|vet|build, cargo test|check|build, git status|diff|log|show");
  }
  try {
    const o = execFileSync(args[0], args.slice(1), { cwd: ROOT, encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 << 20 });
    return `exit 0\n${o}`.slice(0, 12000);
  } catch (e) {
    return `exit ${e.status ?? 1}\n${e.stdout || ""}${e.stderr || ""}`.slice(0, 12000);
  }
}

// ---------- tools ----------
function listDir(p = ".") {
  const abs = safePath(p);
  const items = fs.readdirSync(abs, { withFileTypes: true }).filter((d) => !SKIP_DIRS.has(d.name)).slice(0, 300);
  return items.map((d) => (d.isDirectory() ? d.name + "/" : d.name)).join("\n") || "(empty)";
}
function readFile(p, start, end) {
  const abs = safePath(p);
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  const a = Math.max(1, Number(start) || 1), b = Math.min(lines.length, Number(end) || lines.length);
  const text = lines.slice(a - 1, b).map((l, i) => `${a + i}: ${l}`).join("\n");
  return text.length > 60000 ? text.slice(0, 60000) + "\n…(truncated; ask for a line range)" : text;
}
function search(pattern, p = ".") {
  let re; try { re = new RegExp(pattern, "i"); } catch { re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
  const hits = [];
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (hits.length >= 120 || SKIP_DIRS.has(d.name)) continue;
      const f = path.join(dir, d.name);
      if (d.isDirectory()) walk(f);
      else if (d.isFile() && fs.statSync(f).size < 1_000_000) {
        fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (hits.length < 120 && re.test(l)) hits.push(`${relp(f)}:${i + 1}: ${l.slice(0, 200)}`); });
      }
    }
  };
  walk(safePath(p));
  return hits.join("\n") || "(no matches)";
}
function writeFile(p, content) {
  const abs = safePath(p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, String(content));
  return `wrote ${relp(abs)} (${String(content).length} chars)`;
}
function replaceInFile(p, oldText, newText) {
  const abs = safePath(p);
  const s = fs.readFileSync(abs, "utf8");
  const n = s.split(String(oldText)).length - 1;
  if (n === 0) throw new Error("old_text not found; read the file again and copy the exact text");
  if (n > 1) throw new Error(`old_text appears ${n} times; include more surrounding lines to make it unique`);
  fs.writeFileSync(abs, s.replace(String(oldText), String(newText)));
  return `edited ${relp(abs)}`;
}

const fn = (name, description, properties, required) => ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });
const READ_TOOLS = [
  fn("list_dir", "List files and folders (relative path, default '.').", { path: { type: "string" } }, []),
  fn("read_file", "Read a text file with line numbers; optionally a line range.", { path: { type: "string" }, start_line: { type: "integer" }, end_line: { type: "integer" } }, ["path"]),
  fn("search", "Search file contents for a regex (case-insensitive) under a folder.", { pattern: { type: "string" }, path: { type: "string" } }, ["pattern"]),
];
const WRITE_TOOLS = [
  fn("replace_in_file", "Replace one exact, unique snippet in a file. Prefer this for edits.", { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, ["path", "old_text", "new_text"]),
  fn("write_file", "Create or overwrite a whole file.", { path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
  fn("run_command", "Run an allowed command (tests, syntax checks, read-only git) in the project folder. No shell operators.", { command: { type: "string" } }, ["command"]),
];
function callTool(name, a) {
  switch (name) {
    case "list_dir": return listDir(a.path);
    case "read_file": return readFile(a.path, a.start_line, a.end_line);
    case "search": return search(a.pattern, a.path);
    case "replace_in_file": return replaceInFile(a.path, a.old_text, a.new_text);
    case "write_file": return writeFile(a.path, a.content);
    case "run_command": return runCommand(a.command);
    default: throw new Error(`unknown tool ${name}`);
  }
}
const toolEvent = (name, a) => ({
  list_dir: { kind: "search", text: `list ${a.path || "."}` }, read_file: { kind: "read", text: a.path },
  search: { kind: "search", text: `search ${a.pattern}` }, replace_in_file: { kind: "edit", text: `edit ${a.path}` },
  write_file: { kind: "edit", text: `write ${a.path}` }, run_command: { kind: "cmd", text: a.command },
}[name] || { kind: "tool", text: name });

// ---------- the loop ----------
async function chat(p, model, messages, tools) {
  const res = await fetch(`${p.base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools, tool_choice: "auto", stream: false }),
    signal: AbortSignal.timeout(180_000),
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
    { role: "system", content: `You are a careful coding worker. Your working folder is the project root; use relative paths. Use the tools to look at the code before answering${write ? ", make the smallest correct change, then run the relevant tests with run_command if there are any" : ". You cannot change files"}. Do exactly the task, nothing more. When done, reply with a short summary (what you found or changed, and test results).` },
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
  for (let step = 0; step < MAX_STEPS; step++) {
    if (k >= pairs.length) break;
    const [p, model] = pairs[k];
    if (announced !== k) { out({ type: "free.init", provider: p.name, model, agent: true, write }); announced = k; }
    let data;
    try { data = await chat(p, model, messages, tools); }
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
      let a = {}; try { a = JSON.parse(c.function?.arguments || "{}"); } catch {}
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
