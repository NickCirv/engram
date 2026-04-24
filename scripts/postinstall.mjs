#!/usr/bin/env node
/**
 * postinstall — one-time info banner on `npm install -g engramx`.
 * Prints the 'what to do next' hint + the clean-uninstall flow so users
 * don't end up with orphaned hooks (see CHANGELOG v3.0.1 context).
 *
 * Contract:
 *   - Never fails the install. Always exit 0.
 *   - Respects $CI (quiet in CI environments).
 *   - Respects $ENGRAM_NO_POSTINSTALL=1 (ops lever for automated rollouts).
 */
if (process.env.CI || process.env.ENGRAM_NO_POSTINSTALL === "1") {
  process.exit(0);
}

const lines = [
  "",
  "  ✅ engramx installed.",
  "",
  "  Get started:",
  "     cd <your-project> && engram setup",
  "",
  "  To remove cleanly later (avoids orphaned Claude Code hooks):",
  "     engram uninstall-hook && npm uninstall -g engramx",
  "     (npm uninstall -g engramx by itself also works now — preuninstall",
  "      hook-cleanup is automatic in 3.0.1+)",
  "",
  "  Docs: https://github.com/NickCirv/engram",
  "",
];
process.stdout.write(lines.join("\n"));
process.exit(0);
