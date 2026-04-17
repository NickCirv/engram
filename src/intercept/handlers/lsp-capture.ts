/**
 * LSP diagnostic capture — PostToolUse handler that stores LSP diagnostics
 * as mistake nodes after Edit/Write operations.
 *
 * BEST-EFFORT: silent failure on any error. If no LSP socket is available
 * (the common case) this function returns immediately with no side-effects.
 *
 * Called from the PostToolUse handler after Edit or Write tool completions.
 */
import { LspConnection } from "../../providers/lsp-connection.js";

/**
 * Attempt to capture LSP diagnostics for the edited file and store them
 * as mistake nodes in the engram graph.
 *
 * @param filePath  - Absolute or relative path to the edited file
 * @param projectRoot - Absolute path to the project root
 */
export async function captureLspDiagnostics(
  filePath: string,
  projectRoot: string
): Promise<void> {
  try {
    const conn = await LspConnection.tryConnect();
    if (!conn) return;

    const diagnostics = await conn.getDiagnostics(filePath);

    if (diagnostics.length === 0) {
      conn.close();
      return;
    }

    const { getStore } = await import("../../core.js");
    const store = await getStore(projectRoot);
    try {
      for (const diag of diagnostics) {
        // Build a stable ID from file + line + truncated message
        const msgKey = diag.message.slice(0, 50).replace(/\s+/g, "-");
        const id = `lsp:${filePath}:${diag.range.start.line}:${msgKey}`;

        store.upsertNode({
          id,
          label: diag.message,
          kind: "mistake",
          sourceFile: filePath,
          sourceLocation: `L${diag.range.start.line + 1}`,
          confidence: "EXTRACTED",
          confidenceScore: 0.9,
          lastVerified: Date.now(),
          queryCount: 0,
          metadata: {
            source: "lsp",
            severity: diag.severity,
          },
        });
      }
      store.save();
    } finally {
      store.close();
    }

    conn.close();
  } catch {
    // Silent failure — LSP capture is best-effort
  }
}
