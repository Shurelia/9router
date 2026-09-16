import { registerSession, unregisterSession, findPlugin } from "@/lib/mcp/stdioSseBridge";
import { isWebSearchPlugin, handleWebSearchSse } from "@/lib/mcp/webSearchMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { plugin } = await params;
  if (isWebSearchPlugin(plugin)) {
    return handleWebSearchSse(request);
  }

  if (!findPlugin(plugin)) {
    return new Response(`Unknown plugin: ${plugin}`, { status: 404 });
  }

  const encoder = new TextEncoder();
  let sid;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch { /* stream closed */ }
      };
      try {
        sid = registerSession(plugin, send);
        if (!sid) {
          controller.close();
          return;
        }
        // MCP SSE handshake: tell client where to POST messages.
        send(`event: endpoint\ndata: /api/mcp/${plugin}/message?sessionId=${sid}\n\n`);
      } catch (err) {
        console.error(`[mcp:${plugin}] failed to start session:`, err.message);
        controller.close();
      }
    },
    cancel() {
      if (sid) unregisterSession(plugin, sid);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
