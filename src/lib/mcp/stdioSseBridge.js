// Inline stdio<->SSE bridge for MCP. Spawns one child per plugin on demand,
// broadcasts JSON-RPC frames over SSE, accepts client messages via HTTP POST.

const { spawn, execSync } = require("child_process");
const crypto = require("crypto");
const { LOCAL_STDIO_PLUGINS } = require("../../shared/constants/coworkPlugins");

const G_KEY = "__9routerMcpBridges";
const MAX_TEXT_CHARS = 50000;
const COLLAPSE_THRESHOLD = 30;
const COLLAPSE_KEEP_HEAD = 10;
const COLLAPSE_KEEP_TAIL = 5;
const IDLE_TIMEOUT_MS = 30_000;

function freePort(port) {
  if (!port) return;
  try {
    if (process.platform === "win32") {
      const out = execSync("netstat -ano -p tcp", { encoding: "utf8", windowsHide: true, timeout: 3000 });
      const pids = new Set();
      for (const line of out.split("\n")) {
        if (line.includes(`:${port}`) && line.includes("LISTENING")) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && !isNaN(pid) && pid !== "0" && pid !== String(process.pid)) pids.add(pid);
        }
      }
      for (const pid of pids) {
        try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 3000 }); } catch {}
      }
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: "ignore", timeout: 3000 });
    }
  } catch {}
}

function killProcess(proc) {
  if (!proc) return;
  const pid = proc.pid;
  try {
    if (process.platform === "win32" && pid) {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 3000 });
    } else {
      proc.kill("SIGKILL");
    }
  } catch {
    try { proc.kill("SIGKILL"); } catch { /* ignore */ }
  }
}

// Drop noise nodes, collapse repeated siblings, hard-truncate. Preserve [ref=eXX].
function smartFilterText(text) {
  if (typeof text !== "string" || text.length < 2000) return text;
  let out = text;
  out = out.replace(/^\s*-\s*generic:?\s*$/gm, "");
  out = out.replace(/^\s*-\s*text:\s*""\s*$/gm, "");
  out = collapseRepeated(out);
  if (out.length > MAX_TEXT_CHARS) {
    const head = out.slice(0, MAX_TEXT_CHARS - 300);
    out = `${head}\n\n... [truncated ${text.length - head.length} chars by 9router bridge. Page is large; ask user to scroll/navigate to a specific section, or click an element with the refs shown above]`;
  }
  return out;
}

// Group consecutive lines sharing the same leading indent + role prefix; collapse if >= COLLAPSE_THRESHOLD.
function collapseRepeated(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^(\s*)-\s*([a-zA-Z]+)\b/);
    if (!m) { out.push(line); i++; continue; }
    const indent = m[1];
    const role = m[2];
    let j = i;
    while (j < lines.length) {
      const ln = lines[j];
      const mm = ln.match(/^(\s*)-\s*([a-zA-Z]+)\b/);
      if (mm && mm[1] === indent && mm[2] === role) { j++; continue; }
      if (ln.startsWith(`${indent} `) || ln.startsWith(`${indent}\t`)) { j++; continue; }
      break;
    }
    const groupLen = j - i;
    if (groupLen >= COLLAPSE_THRESHOLD) {
      const headEnd = findNthSiblingEnd(lines, i, indent, role, COLLAPSE_KEEP_HEAD);
      const tailStart = findLastNSiblingStart(lines, j, indent, role, COLLAPSE_KEEP_TAIL);
      for (let k = i; k < headEnd; k++) out.push(lines[k]);
      out.push(`${indent}... [${groupLen - COLLAPSE_KEEP_HEAD - COLLAPSE_KEEP_TAIL} similar "${role}" items omitted by 9router bridge]`);
      for (let k = tailStart; k < j; k++) out.push(lines[k]);
    } else {
      for (let k = i; k < j; k++) out.push(lines[k]);
    }
    i = j;
  }
  return out.join("\n");
}

function findNthSiblingEnd(lines, start, indent, role, n) {
  let count = 0;
  for (let k = start; k < lines.length; k++) {
    const mm = lines[k].match(/^(\s*)-\s*([a-zA-Z]+)\b/);
    if (mm && mm[1] === indent && mm[2] === role) {
      count++;
      if (count > n) return k;
    }
  }
  return lines.length;
}

function findLastNSiblingStart(lines, end, indent, role, n) {
  const positions = [];
  for (let k = 0; k < end; k++) {
    const mm = lines[k].match(/^(\s*)-\s*([a-zA-Z]+)\b/);
    if (mm && mm[1] === indent && mm[2] === role) positions.push(k);
  }
  return positions.length > n ? positions[positions.length - n] : end;
}

// Apply filter to JSON-RPC tool/result content text blocks only.
function filterFrame(line) {
  try {
    const msg = JSON.parse(line);
    const content = msg?.result?.content;
    if (!Array.isArray(content)) return line;
    let mutated = false;
    for (const item of content) {
      if (item?.type === "text" && typeof item.text === "string") {
        const filtered = smartFilterText(item.text);
        if (filtered !== item.text) { item.text = filtered; mutated = true; }
      }
    }
    return mutated ? JSON.stringify(msg) : line;
  } catch { return line; }
}
const getStore = () => {
  if (!globalThis[G_KEY]) globalThis[G_KEY] = new Map();
  return globalThis[G_KEY];
};

// Only preset stdio plugins may spawn. No user-defined commands (RCE prevention).
function findPlugin(name) {
  return LOCAL_STDIO_PLUGINS.find((p) => p.name === name) || null;
}

function getOrSpawn(name) {
  const store = getStore();
  let entry = store.get(name);
  if (entry?.proc && !entry.proc.killed && entry.proc.exitCode === null) return entry;

  const plugin = findPlugin(name);
  if (!plugin) throw new Error(`Unknown local plugin: ${name}`);

  if (plugin.port) {
    freePort(plugin.port);
  }

  const isWin = process.platform === "win32";
  const cmd = isWin && plugin.command === "npx" ? "npx.cmd" : plugin.command;

  let proc;
  try {
    proc = spawn(cmd, plugin.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      shell: isWin,
      windowsHide: true,
    });
  } catch (err) {
    console.error(`[mcp:${name}] spawn sync error:`, err.message);
    return null;
  }

  entry = { proc, sessions: new Map(), buffer: "", idleTimer: null };
  store.set(name, entry);

  proc.on("error", (err) => {
    console.error(`[mcp:${name}] process error:`, err.message);
    store.delete(name);
    for (const send of entry.sessions.values()) {
      try {
        send(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: `Failed to spawn ${name}: ${err.message}` } })}\n\n`);
      } catch { /* ignore broken pipe */ }
    }
  });

  // Parse newline-delimited JSON-RPC from child stdout, broadcast to all sessions.
  proc.stdout?.on("data", (chunk) => {
    entry.buffer += chunk.toString("utf8");
    let idx;
    while ((idx = entry.buffer.indexOf("\n")) >= 0) {
      const raw = entry.buffer.slice(0, idx).trim();
      entry.buffer = entry.buffer.slice(idx + 1);
      if (!raw) continue;
      const line = filterFrame(raw);
      for (const send of entry.sessions.values()) {
        try { send(`event: message\ndata: ${line}\n\n`); } catch { /* ignore broken pipe */ }
      }
    }
  });

  proc.stderr?.on("data", (d) => {
    const text = d.toString().trim();
    if (!text) return;
    // Suppress upstream @browsermcp/mcp harmless netstat/findstr exit-1 stderr log on start
    if (text.includes("Failed to kill process on port") && text.includes("findstr")) return;
    console.log(`[mcp:${name}]`, text);
  });
  proc.on("exit", (code) => {
    console.log(`[mcp:${name}] exited`, code);
    store.delete(name);
  });

  return entry;
}

function killBridge(name, entry) {
  if (!entry) return;
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
  if (entry.proc) {
    entry.proc.removeAllListeners("exit");
    entry.proc.removeAllListeners("error");
    killProcess(entry.proc);
  }
  const plugin = findPlugin(name);
  if (plugin?.port) {
    freePort(plugin.port);
  }
  getStore().delete(name);
}

function registerSession(name, sendFn) {
  const entry = getOrSpawn(name);
  if (!entry) return null;
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
  const sid = crypto.randomUUID();
  entry.sessions.set(sid, sendFn);
  return sid;
}

function unregisterSession(name, sid) {
  const entry = getStore().get(name);
  if (!entry) return;
  entry.sessions.delete(sid);
  // Grace period before killing child to prevent rapid spawn/kill thrashing
  if (entry.sessions.size === 0) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      const current = getStore().get(name);
      if (current === entry && current.sessions.size === 0) {
        killBridge(name, entry);
      }
    }, IDLE_TIMEOUT_MS);
  }
}

// Kill all spawned MCP children — called on app shutdown to prevent orphans.
function killAllBridges() {
  const store = getStore();
  for (const [name, entry] of store) {
    killBridge(name, entry);
  }
}

function sendToChild(name, jsonRpc) {
  const entry = getStore().get(name);
  if (!entry?.proc?.stdin?.writable) throw new Error(`Bridge not running: ${name}`);
  entry.proc.stdin.write(`${JSON.stringify(jsonRpc)}\n`);
}

function isRunning(name) {
  const entry = getStore().get(name);
  return !!(entry?.proc && !entry.proc.killed && entry.proc.exitCode === null);
}

module.exports = { getOrSpawn, registerSession, unregisterSession, sendToChild, isRunning, findPlugin, killAllBridges };
