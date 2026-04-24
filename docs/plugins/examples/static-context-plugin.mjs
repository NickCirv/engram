/**
 * engramx plugin: static-context — inject a fixed block of text into
 * every Read.
 *
 * Trivial example of the CLASSIC plugin path (plugin writes its own
 * `resolve()` and `isAvailable()` — no mcpConfig involved). Useful for:
 *   - Project-specific reminders you want on every file Read
 *   - House-rule blocks that belong in the context, not CLAUDE.md
 *   - Quick experiments before promoting to a real MCP-backed plugin
 *
 * Install: copy to `~/.engram/plugins/static-context.mjs` and edit
 * the `MESSAGE` constant.
 */

const MESSAGE = `
  ! Reminder: all DB migrations must pass on SQLite 3.35+ (the CI runner)
  ! House style: feature branches named feat/<issue-number>-<slug>
`.trim();

export default {
  name: "static-context",
  label: "PROJECT REMINDER",
  version: "0.1.0",
  description: "Always-on project reminder injected at every Read.",
  tier: 1,
  tokenBudget: 50,
  timeoutMs: 200,
  async resolve() {
    return {
      provider: "static-context",
      content: MESSAGE,
      confidence: 0.6,
      cached: false,
    };
  },
  async isAvailable() {
    return MESSAGE.length > 0;
  },
};
