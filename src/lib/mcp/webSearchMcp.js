import crypto from "crypto";
import { getApiKeys } from "@/lib/localDb";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const CLI_TOKEN_SALT = "9r-cli-auth";
const DEFAULT_SEARCH_PROVIDER = "ag";
const DEFAULT_FETCH_PROVIDER = "jina-reader";
const G_KEY = "__9routerWebSearchMcpSessions";

const getSessionStore = () => {
  if (!globalThis[G_KEY]) globalThis[G_KEY] = new Map();
  return globalThis[G_KEY];
};

export function isWebSearchPlugin(name) {
  return name === "web-search" || name === "9router-web";
}

async function getInternalHeaders() {
  let apiKey = null;
  try {
    const keys = await getApiKeys();
    apiKey = keys.find((k) => k.isActive !== false)?.key || null;
  } catch {}

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  headers["x-9r-cli-token"] = await getConsistentMachineId(CLI_TOKEN_SALT);
  return headers;
}

function getBaseUrl() {
  const port = process.env.PORT || UPDATER_CONFIG.appPort || 20127;
  return `http://127.0.0.1:${port}`;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

async function executeWebSearch({ query, maxResults = 5, provider = DEFAULT_SEARCH_PROVIDER, origin = null }) {
  const headers = await getInternalHeaders();
  const targetUrl = origin ? `${origin}/v1/search` : `${getBaseUrl()}/v1/search`;
  const res = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider,
      query,
      search_type: "web",
      max_results: maxResults,
    }),
    signal: AbortSignal.timeout(20000),
  });

  const rawText = await res.text().catch(() => "");
  let data = null;
  try { data = rawText ? JSON.parse(rawText) : null; } catch {}

  if (!res.ok) {
    const msg = data?.error?.message || data?.error || rawText || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  let text = "";
  if (data?.answer?.text) {
    text += data.answer.text + "\n\n";
  }
  if (Array.isArray(data?.results) && data.results.length > 0) {
    text += "Search Results:\n" + data.results.map((r, i) => {
      const title = r.title || "Untitled";
      const url = r.url || "";
      const snippet = r.snippet || r.content || "";
      return `${i + 1}. [${title}](${url})\n${snippet}`;
    }).join("\n\n");
  } else if (!text) {
    text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  }

  return text.trim() || "No search results found.";
}

async function executeWebFetch({ url, provider = DEFAULT_FETCH_PROVIDER, origin = null }) {
  const headers = await getInternalHeaders();
  const targetUrl = origin ? `${origin}/v1/web/fetch` : `${getBaseUrl()}/v1/web/fetch`;
  const res = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider,
      url,
    }),
    signal: AbortSignal.timeout(20000),
  });

  const rawText = await res.text().catch(() => "");
  let data = null;
  try { data = rawText ? JSON.parse(rawText) : null; } catch {}

  if (!res.ok) {
    const msg = data?.error?.message || data?.error || rawText || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data?.content || data?.text || rawText || "No content extracted.";
}

export function handleWebSearchSse(request) {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const searchProvider = searchParams.get("provider") || searchParams.get("searchProvider") || DEFAULT_SEARCH_PROVIDER;
  const fetchProvider = searchParams.get("fetchProvider") || searchProvider || DEFAULT_FETCH_PROVIDER;
  const sid = crypto.randomUUID();
  const origin = url.origin;

  const store = getSessionStore();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj) => {
        try {
          controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(obj)}\n\n`));
        } catch { /* connection dropped */ }
      };

      store.set(sid, { send, searchProvider, fetchProvider, origin });
      controller.enqueue(encoder.encode(`event: endpoint\ndata: /api/mcp/web-search/message?sessionId=${sid}\n\n`));
    },
    cancel() {
      store.delete(sid);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...CORS_HEADERS,
    },
  });
}

export async function handleWebSearchMessage(request) {
  const { searchParams } = new URL(request.url);
  const sid = searchParams.get("sessionId");
  const store = getSessionStore();
  const session = sid ? store.get(sid) : null;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const { id, method, params } = body;

  if (method === "notifications/initialized") {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  if (method === "initialize") {
    const result = {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "9router-web", version: "1.0.0" },
    };
    session?.send({ jsonrpc: "2.0", id, result });
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  if (method === "ping") {
    session?.send({ jsonrpc: "2.0", id, result: {} });
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  if (method === "tools/list") {
    const tools = [
      {
        name: "web_search",
        description: "Search the web for real-time information, news, documentation, and current events.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query" },
            max_results: { type: "number", description: "Maximum number of search results (1-10, default: 5)" },
          },
          required: ["query"],
        },
      },
      {
        name: "web_fetch",
        description: "Fetch and extract text content from a web page URL.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL of the webpage to fetch" },
          },
          required: ["url"],
        },
      },
    ];
    session?.send({ jsonrpc: "2.0", id, result: { tools } });
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  if (method === "tools/call") {
    const toolName = params?.name || "";
    const args = params?.arguments || {};
    const searchProvider = session?.searchProvider || DEFAULT_SEARCH_PROVIDER;
    const fetchProvider = session?.fetchProvider || DEFAULT_FETCH_PROVIDER;
    const origin = session?.origin || null;

    try {
      if (toolName === "web_search" || toolName === "local_web_search" || toolName.includes("search")) {
        const text = await executeWebSearch({
          query: args.query || "",
          maxResults: args.max_results || 5,
          provider: searchProvider,
          origin,
        });
        session?.send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
      } else if (toolName === "web_fetch" || toolName.includes("fetch")) {
        const text = await executeWebFetch({
          url: args.url || "",
          provider: fetchProvider,
          origin,
        });
        session?.send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
      } else {
        session?.send({
          jsonrpc: "2.0",
          id,
          result: { isError: true, content: [{ type: "text", text: `Unknown tool: ${toolName}` }] },
        });
      }
    } catch (err) {
      session?.send({
        jsonrpc: "2.0",
        id,
        result: { isError: true, content: [{ type: "text", text: `Error: ${err.message}` }] },
      });
    }

    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  session?.send({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
  return new Response(null, { status: 202, headers: CORS_HEADERS });
}
