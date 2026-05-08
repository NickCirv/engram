import type { Socket } from "node:net";
import { learn } from "../core.js";

/**
 * Build a server-to-client WebSocket frame (unmasked). Supports text/binary payloads.
 */
function createWsFrame(payload: Buffer, opcode = 0x1): Buffer {
  const finAndOp = 0x80 | (opcode & 0x0f);
  let header: Buffer;
  const len = payload.length;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = finAndOp;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = finAndOp;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = finAndOp;
    header[1] = 127;
    // write 64-bit length (high 32 bits = 0)
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

/**
 * Handle a WebSocket connection over the provided socket. The protocol is
 * intentionally tiny:
 *  - Client may send either plain text (string chunk) or JSON objects.
 *  - If JSON, expected shape: { content: string, scope?: string, file?: string, source?: string }
 *  - Server replies immediately with { type: 'accepted', chunkId }
 *  - When learn completes, server sends { type: 'done', chunkId, nodesAdded }
 *  - On error: { type: 'error', chunkId, error }
 *
 * Writes to the graph store happen in the background (core.learn is awaited
 * but GraphStore.save writes to disk asynchronously) so the socket/agent
 * remains responsive.
 */
export function handleWebSocket(socket: Socket, projectRoot: string): void {
  let buffer = Buffer.alloc(0);
  let nextChunkId = 1;
  let closed = false;

  function sendObj(obj: unknown): void {
    try {
      const text = JSON.stringify(obj);
      const frame = createWsFrame(Buffer.from(text, "utf8"));
      socket.write(frame);
    } catch {
      // ignore send errors
    }
  }

  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      if (buffer.length < 2) break;
      const first = buffer[0];
      const second = buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let payloadLen = second & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < offset + 2) break;
        payloadLen = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (buffer.length < offset + 8) break;
        const high = buffer.readUInt32BE(offset);
        const low = buffer.readUInt32BE(offset + 4);
        if (high !== 0) {
          socket.destroy();
          return;
        }
        payloadLen = low;
        offset += 8;
      }

      if (masked) {
        if (buffer.length < offset + 4) break;
      }

      const maskKey = masked ? buffer.slice(offset, offset + 4) : null;
      if (masked) offset += 4;

      if (buffer.length < offset + payloadLen) break;

      const payload = buffer.slice(offset, offset + payloadLen);
      if (maskKey) {
        for (let i = 0; i < payload.length; i++) payload[i] = payload[i] ^ maskKey[i % 4];
      }

      if (opcode === 0x1) {
        const text = payload.toString("utf8");
        let dataObj: any;
        try {
          dataObj = JSON.parse(text);
        } catch {
          dataObj = { content: text };
        }

        const chunkId = nextChunkId++;
        sendObj({ type: "accepted", chunkId });

        const content = typeof dataObj === "object" && dataObj !== null && typeof dataObj.content === "string"
          ? dataObj.content
          : String(dataObj);
        const scope = typeof dataObj === "object" && dataObj !== null && typeof dataObj.scope === "string"
          ? dataObj.scope
          : "project";
        const file = typeof dataObj === "object" && dataObj !== null && typeof dataObj.file === "string"
          ? dataObj.file
          : undefined;
        const sourceLabel = typeof dataObj === "object" && dataObj !== null && typeof dataObj.source === "string"
          ? dataObj.source
          : `ws`;

        // Background ingestion — fire-and-forget but report result back
        (async () => {
          try {
            const result = await learn(projectRoot, content, file ?? sourceLabel, scope);
            if (!closed) sendObj({ type: "done", chunkId, nodesAdded: result.nodesAdded });
          } catch (err) {
            if (!closed) sendObj({ type: "error", chunkId, error: String(err) });
          }
        })();
      } else if (opcode === 0x8) {
        // Close frame — echo and close
        try { socket.write(Buffer.from([0x88, 0x00])); } catch { /* ignore */ }
        closed = true;
        socket.destroy();
        return;
      } else if (opcode === 0x9) {
        // Ping -> Pong
        const pong = createWsFrame(payload, 0xA);
        socket.write(pong);
      }

      buffer = buffer.slice(offset + payloadLen);
    }
  });

  socket.on("close", () => { closed = true; });
  socket.on("error", () => { closed = true; });
}
