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
  const tokenInfo = await createHttpServer(projectRoot, port);
  const url = `http://127.0.0.1:${port}`;
  process.stdout.write(`engram HTTP server listening on ${url}\n`);

  // Auth banner — tell the user where their token lives so external callers
  // (curl, scripts) can find it. Browser dashboard auths automatically via
  // HttpOnly cookie set on GET /ui.
  if (tokenInfo.source === "env") {
    process.stderr.write(
      "engram: auth token from ENGRAM_API_TOKEN env var\n"
    );
  } else if (tokenInfo.source === "file") {
    process.stderr.write(
      `engram: auth token at ${tokenInfo.path}\n`
    );
  } else {
    process.stderr.write(
      `engram: auth token generated at ${tokenInfo.path} (0600)\n` +
      `        curl -H "Authorization: Bearer $(cat ${tokenInfo.path})" ${url}/stats\n`
    );
  }
}
