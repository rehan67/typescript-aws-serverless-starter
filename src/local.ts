import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MemoryStore } from "./memory.js";
import { makeHandlers } from "./handlers.js";
export function createLocalServer() {
  const store = new MemoryStore(),
    handlers = makeHandlers(
      store,
      { publish: async (record) => store.consume(record) },
      store,
    );
  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const send = (status: number, data: unknown) => {
        res.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        res.end(JSON.stringify(data));
      };
      if (req.method === "GET" && req.url === "/health")
        return send(200, { status: "ok", mode: "local-memory" });
      if (req.method === "GET" && req.url?.startsWith("/notifications/")) {
        const id = req.url.slice("/notifications/".length);
        return send(200, { effects: store.mailbox.has(id) ? 1 : 0 });
      }
      if (req.method !== "POST" || req.url !== "/enrollments")
        return send(404, { error: "Not found." });
      if (req.headers["content-type"]?.split(";")[0] !== "application/json")
        return send(415, { error: "JSON is required." });
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of req) {
          const bytes = Buffer.from(chunk as Uint8Array);
          size += bytes.length;
          if (size > 4096) {
            send(413, { error: "Request too large." });
            return;
          }
          chunks.push(bytes);
        }
        const reply = await handlers.api({
          body: Buffer.concat(chunks).toString("utf8"),
        });
        if (reply.statusCode < 300) await store.drain();
        res.writeHead(reply.statusCode, reply.headers);
        res.end(reply.body);
      } catch {
        if (!res.headersSent)
          send(503, { error: "Request could not be completed." });
        else res.end();
      }
    },
  );
  return { server, store };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { server } = createLocalServer();
  server.listen(5081, "127.0.0.1", () =>
    console.log("Local reference API: http://127.0.0.1:5081"),
  );
}
