/**
 * engram HTTP server public entry point.
 * Re-exports startHttpServer for use by the CLI and external callers.
 */
import { createHttpServer } from "./http.js";

const DEFAULT_PORT = 7337;

/**
 * Start the engram HTTP REST server.
 *
 * @param projectRoot - Absolute path to the project root (used for graph DB
 *   lookup and PID file placement).
 * @param port - TCP port to listen on. Defaults to 7337. Binds to
 *   127.0.0.1 only.
 * @returns A Promise that resolves once the server is listening and rejects
 *   on bind failure.
 */
export async function startHttpServer(
  projectRoot: string,
  port: number = DEFAULT_PORT
): Promise<void> {
  await createHttpServer(projectRoot, port);
  // Log after bind so port conflicts surface before the message.
  process.stdout.write(
    `engram HTTP server listening on http://127.0.0.1:${port}\n`
  );
}
