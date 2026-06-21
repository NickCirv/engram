/**
 * SubagentStart handler tests (ADR-0008, #83). These verify engram's SIDE — that
 * it emits a correct, tight slice for a SubagentStart event and passes through in
 * every safe case. (That a real Claude Code sub-agent actually injects the
 * additionalContext is a separate live smoke gate, per the ADR.)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { init } from "../../../src/core.js";
import { handleSubagentStart } from "../../../src/intercept/handlers/subagent-start.js";
import { dedupOrRecord } from "../../../src/intercept/served-reads.js";
import { PASSTHROUGH } from "../../../src/intercept/safety.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("handleSubagentStart", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), "engram-sa-test-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "src", "u.ts"), "export function tok(s: string): number { return s.length; }\n");
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(projectRoot, "src", `c${i}.ts`), `import { tok } from "./u";\nexport const x${i} = tok("${i}");\n`);
    }
    await init(projectRoot);
  });

  afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

  const payload = (extra: Record<string, unknown> = {}) => ({
    hook_event_name: "SubagentStart",
    cwd: projectRoot,
    ...extra,
  });

  it("injects a tight structural slice for a repo with a graph", async () => {
    const r = (await handleSubagentStart(payload())) as Record<string, unknown>;
    expect(r).not.toBe(PASSTHROUGH);
    const out = r.hookSpecificOutput as Record<string, unknown>;
    expect(out.hookEventName).toBe("SubagentStart");
    const ctx = out.additionalContext as string;
    expect(ctx).toContain("[engram] Sub-agent map");
    expect(ctx).toContain("Top entities"); // the god-node block rendered
  });

  it("passes through for a non-SubagentStart event", async () => {
    expect(await handleSubagentStart(payload({ hook_event_name: "SessionStart" }))).toBe(PASSTHROUGH);
  });

  it("passes through when ENGRAM_SUBAGENT_CONTEXT=0 (opt-out)", async () => {
    const prev = process.env.ENGRAM_SUBAGENT_CONTEXT;
    process.env.ENGRAM_SUBAGENT_CONTEXT = "0";
    try {
      expect(await handleSubagentStart(payload())).toBe(PASSTHROUGH);
    } finally {
      if (prev === undefined) delete process.env.ENGRAM_SUBAGENT_CONTEXT;
      else process.env.ENGRAM_SUBAGENT_CONTEXT = prev;
    }
  });

  it("passes through for an invalid cwd", async () => {
    expect(
      await handleSubagentStart({ hook_event_name: "SubagentStart", cwd: "/nonexistent/xyz-engram" })
    ).toBe(PASSTHROUGH);
  });

  it("passes through when the project has no graph", async () => {
    const empty = mkdtempSync(join(tmpdir(), "engram-sa-empty-"));
    try {
      expect(await handleSubagentStart({ hook_event_name: "SubagentStart", cwd: empty })).toBe(PASSTHROUGH);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  // --- #139 focal-reach block ---

  it("appends the parent's recent-focus related files when a session id resolves a read", async () => {
    const session = "sess-focus-1";
    // Parent read c0.ts this session (c0 imports u.ts → u is graph-adjacent).
    dedupOrRecord(projectRoot, session, join(projectRoot, "src", "c0.ts"));
    const r = (await handleSubagentStart(payload({ session_id: session }))) as Record<string, unknown>;
    const ctx = (r.hookSpecificOutput as Record<string, unknown>).additionalContext as string;
    expect(ctx).toContain("Related to the parent's recent focus (src/c0.ts)");
    expect(ctx).toContain("src/u.ts"); // the import-edge neighbour surfaces
  });

  it("renders NO focus block without a session id (never-worse: god-node slice unchanged)", async () => {
    const r = (await handleSubagentStart(payload())) as Record<string, unknown>;
    const ctx = (r.hookSpecificOutput as Record<string, unknown>).additionalContext as string;
    expect(ctx).toContain("Top entities");
    expect(ctx).not.toContain("recent focus");
  });

  it("renders NO focus block when the session has no recorded reads", async () => {
    const r = (await handleSubagentStart(payload({ session_id: "sess-empty" }))) as Record<string, unknown>;
    const ctx = (r.hookSpecificOutput as Record<string, unknown>).additionalContext as string;
    expect(ctx).not.toContain("recent focus");
  });

  it("renders NO focus block when the parent's last read is a non-code file (no graph nodes → no noise)", async () => {
    const session = "sess-md";
    writeFileSync(join(projectRoot, "README.md"), "# project\n");
    dedupOrRecord(projectRoot, session, join(projectRoot, "README.md"));
    const r = (await handleSubagentStart(payload({ session_id: session }))) as Record<string, unknown>;
    const ctx = (r.hookSpecificOutput as Record<string, unknown>).additionalContext as string;
    expect(ctx).not.toContain("recent focus"); // a .md focal has no graph nodes → no sibling noise
  });
});
