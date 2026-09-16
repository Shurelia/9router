import { describe, it, expect, vi, beforeEach } from "vitest";
import { isWebSearchPlugin, handleWebSearchSse, handleWebSearchMessage } from "../../src/lib/mcp/webSearchMcp.js";
import { dedupeTools } from "../../open-sse/utils/toolDeduper.js";

describe("Web Search & Fetch MCP server and tool deduplication", () => {
  it("identifies web-search and 9router-web plugin names", () => {
    expect(isWebSearchPlugin("web-search")).toBe(true);
    expect(isWebSearchPlugin("9router-web")).toBe(true);
    expect(isWebSearchPlugin("browsermcp")).toBe(false);
  });

  it("handles SSE connection and sends endpoint event", async () => {
    const req = new Request("http://localhost:20127/api/mcp/web-search/sse?provider=ag");
    const res = handleWebSearchSse(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);

    expect(text).toContain("event: endpoint");
    expect(text).toContain("/api/mcp/web-search/message?sessionId=");
    await reader.cancel();
  });

  it("handles MCP JSON-RPC initialize and tools/list", async () => {
    const reqSse = new Request("http://localhost:20127/api/mcp/web-search/sse?provider=ag");
    const resSse = handleWebSearchSse(reqSse);
    const reader = resSse.body.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);
    const match = text.match(/sessionId=([a-zA-Z0-9-]+)/);
    const sid = match[1];

    // Initialize
    const initReq = new Request(`http://localhost:20127/api/mcp/web-search/message?sessionId=${sid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    const initRes = await handleWebSearchMessage(initReq);
    expect(initRes.status).toBe(202);

    const initChunk = await reader.read();
    const initText = decoder.decode(initChunk.value);
    expect(initText).toContain('"name":"9router-web"');

    // tools/list
    const listReq = new Request(`http://localhost:20127/api/mcp/web-search/message?sessionId=${sid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    const listRes = await handleWebSearchMessage(listReq);
    expect(listRes.status).toBe(202);

    const listChunk = await reader.read();
    const listText = decoder.decode(listChunk.value);
    expect(listText).toContain('"name":"web_search"');
    expect(listText).toContain('"name":"web_fetch"');

    await reader.cancel();
  });

  it("dedupes built-in WebSearch and WebFetch when 9router web search MCP is present", () => {
    const tools = [
      { name: "mcp__9router_web__web_search" },
      { name: "WebSearch" },
      { name: "WebFetch" },
      { name: "Bash" },
    ];
    const { tools: deduped, stripped } = dedupeTools(tools);
    expect(stripped).toContain("WebSearch");
    expect(stripped).toContain("WebFetch");
    expect(deduped.map((t) => t.name)).toEqual(["mcp__9router_web__web_search", "Bash"]);
  });
});
