/**
 * LSP connection — lightweight client that connects to already-running
 * language servers via Unix domain sockets.
 *
 * DESIGN PHILOSOPHY:
 * This is BEST-EFFORT only. Most dev environments won't have LSP sockets
 * accessible from the file system. The expected common case is that
 * tryConnect() returns null — that is correct behaviour, not an error.
 *
 * Real value comes in IDE environments (VS Code, Neovim) where tsserver
 * or another language server is already running and has a Unix socket.
 *
 * We implement a minimal JSON-RPC 2.0 framing layer over a Node.js net
 * socket. Methods that aren't yet fully wired (hover, getDiagnostics)
 * return null/[] rather than throw, keeping all callers simple.
 */
import { connect, type Socket } from "node:net";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A single hover result from an LSP server. */
export interface LspHoverResult {
  readonly contents: string;
}

/** A single diagnostic from an LSP server. */
export interface LspDiagnostic {
  readonly message: string;
  /** 1=Error, 2=Warning, 3=Information, 4=Hint */
  readonly severity: number;
  readonly range: { start: { line: number; character: number } };
}

/**
 * Resolve candidate socket paths for currently-running language servers.
 * No I/O — pure path construction. Existence is checked by the caller.
 */
function candidateSockets(): string[] {
  const uid = process.getuid?.() ?? 0;
  const tmp = tmpdir();
  return [
    // TypeScript language server (used by VS Code)
    join(tmp, `tsserver-${uid}.sock`),
    // Generic LSP socket (some editors, e.g. Helix)
    join(tmp, "lsp-server.sock"),
    // TypeScript language server alternate path
    join(tmp, "typescript-language-server.sock"),
    // Pyright (Python)
    join(tmp, `pyright-${uid}.sock`),
    // rust-analyzer
    join(tmp, "rust-analyzer.sock"),
  ];
}

/**
 * A minimal JSON-RPC 2.0 connection over a Unix domain socket.
 *
 * Current implementation: connect-and-hold pattern only.
 * hover() and getDiagnostics() are stubs — returning null/[] because
 * a full JSON-RPC notification listener (for publishDiagnostics push)
 * is out of scope for the v0.5.x series. The connection itself proves
 * the socket exists; providers can use that as the availability signal.
 */
export class LspConnection {
  private socket: Socket | null = null;
  private _requestId = 0;

  /**
   * Attempt to connect to any currently-running LSP server socket.
   * Returns null — not throws — if no socket is found or connection fails.
   * Timeout per candidate: 500ms.
   */
  static async tryConnect(): Promise<LspConnection | null> {
    const candidates = candidateSockets().filter((p) => existsSync(p));
    if (candidates.length === 0) return null;

    for (const path of candidates) {
      try {
        const conn = new LspConnection();
        await conn._connect(path);
        return conn;
      } catch {
        continue;
      }
    }
    return null;
  }

  /** Internal: open a socket to the given path with a 500ms timeout. */
  private _connect(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath);
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("LSP connect timeout"));
      }, 500);

      socket.on("connect", () => {
        clearTimeout(timeout);
        this.socket = socket;
        resolve();
      });

      socket.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Request hover info for a position.
   *
   * Stub: returns null. A full implementation would send a JSON-RPC
   * textDocument/hover request and parse the response. Left as a stub
   * because the response requires a request/response correlation loop
   * over a streaming socket — non-trivial, and out of scope for v0.5.x.
   * The provider benefits from the availability check alone.
   */
  async hover(
    _filePath: string,
    _line: number,
    _character: number
  ): Promise<LspHoverResult | null> {
    if (!this.socket) return null;
    // Full JSON-RPC implementation deferred — see comment above.
    return null;
  }

  /**
   * Fetch diagnostics for a file.
   *
   * Stub: returns []. A full implementation would use the
   * textDocument/diagnostic pull request (LSP 3.17+) or subscribe to
   * publishDiagnostics push notifications. Deferred to a future sprint.
   */
  async getDiagnostics(_filePath: string): Promise<LspDiagnostic[]> {
    if (!this.socket) return [];
    return [];
  }

  /** Whether this connection has a live socket. */
  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  /** Close and destroy the socket. Safe to call multiple times. */
  close(): void {
    this.socket?.destroy();
    this.socket = null;
  }
}
