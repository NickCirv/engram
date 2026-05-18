/**
 * Invocation-layer integration tests for the mistake-guard hook.
 *
 * Per the v4.0 reliability audit (08-phase0-audit-2026-05-18.md MUST-FIX
 * #2): the existing mistake-guard unit tests call applyMistakeGuard()
 * DIRECTLY. They miss the dispatch.ts → applyMistakeGuard wiring layer.
 * If dispatch ever passed the wrong tool-kind string (e.g. "Edit"
 * instead of "edit-write"), the unit tests would still pass but the
 * production hook would silently no-op.
 *
 * These tests close that gap by routing real payloads through
 * dispatchHook() and verifying the guard fires for the expected
 * PreToolUse tool kinds (Edit / Write / Bash) and stays silent for
 * the rest (Read).
 *
 * v4.0 default is `permissive` mode — these tests rely on that default,
 * so no ENGRAM_MISTAKE_GUARD env var manipulation is needed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { init } from "../../src/core.js";
import { dispatchHook } from "../../src/intercept/dispatch.js";
import { GraphStore } from "../../src/graph/store.js";

type HookResult =
  | null
  | undefined
  | { hookSpecificOutput?: { additionalContext?: string; permissionDecision?: string } };

function additionalContextOf(result: HookResult): string {
  if (result && typeof result === "object" && "hookSpecificOutput" in result) {
    const ctx = result.hookSpecificOutput?.additionalContext;
    return typeof ctx === "string" ? ctx : "";
  }
  return "";
}

async function seedMistake(
  projectRoot: string,
  opts: {
    sourceFile: string;
    label: string;
    commandPattern?: string;
    biTemporal?: boolean;
  },
): Promise<void> {
  const dbPath = join(projectRoot, ".engram", "graph.db");
  const store = await GraphStore.open(dbPath);
  const baseMistake = {
    id: `test_mistake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label: opts.label,
    kind: "mistake" as const,
    sourceFile: opts.sourceFile,
    sourceLocation: null,
    confidence: "EXTRACTED" as const,
    confidenceScore: 1.0,
    lastVerified: Date.now(),
    queryCount: 0,
    metadata: opts.commandPattern ? { commandPattern: opts.commandPattern } : {},
    ...(opts.biTemporal
      ? {
          thenBelieved: "useReducer dispatch is safe in onChange handlers",
          foundFalseAt: Date.now() - 86400000,
          truthNow: "useReducer + async dispatch needs useCallback wrapping",
          appliesTo: "useReducer + async + form-event handlers",
        }
      : {}),
  };
  store.upsertNode(baseMistake);
  store.save();
  store.close();
}

describe("dispatch → applyMistakeGuard wiring (v4.0 audit MUST-FIX #2)", () => {
  let tmpProject: string;
  let preservedEnv: string | undefined;

  beforeEach(async () => {
    tmpProject = mkdtempSync(join(tmpdir(), "engram-mg-inv-"));
    writeFileSync(join(tmpProject, "src.ts"), "export const x = 1;\n");
    await init(tmpProject, {});
    // Capture and clear env var so v4.0 default (permissive) is in effect.
    preservedEnv = process.env.ENGRAM_MISTAKE_GUARD;
    delete process.env.ENGRAM_MISTAKE_GUARD;
  });

  afterEach(() => {
    if (preservedEnv === undefined) {
      delete process.env.ENGRAM_MISTAKE_GUARD;
    } else {
      process.env.ENGRAM_MISTAKE_GUARD = preservedEnv;
    }
    rmSync(tmpProject, { recursive: true, force: true });
  });

  it("Edit tool → guard fires when a matching mistake exists (legacy v3.x mistake)", async () => {
    await seedMistake(tmpProject, {
      sourceFile: "src.ts",
      label: "Known race condition in src.ts",
    });
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: join(tmpProject, "src.ts"), old_string: "x", new_string: "y" },
      cwd: tmpProject,
    });
    expect(additionalContextOf(result)).toContain("Known race condition");
    expect(additionalContextOf(result)).toContain("engramx pre-mortem");
  });

  it("Edit tool → guard renders bi-temporal layout when v9 fields are populated", async () => {
    await seedMistake(tmpProject, {
      sourceFile: "src.ts",
      label: "useReducer mistake",
      biTemporal: true,
    });
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: join(tmpProject, "src.ts"), old_string: "x", new_string: "y" },
      cwd: tmpProject,
    });
    const ctx = additionalContextOf(result);
    // Hook-format bi-temporal layout: appliesTo becomes the warning title
    // (the `⚠ <pattern>` line), then the structured then/found/truth lines.
    // This is intentionally compact vs the CLI renderer which has a separate
    // "Mistake #N — date" header and an "applies to:" continuation line.
    expect(ctx).toContain("⚠ useReducer + async + form-event handlers");
    expect(ctx).toContain("then you believed: useReducer dispatch is safe in onChange handlers");
    expect(ctx).toContain("truth now:");
    expect(ctx).toContain("useReducer + async dispatch needs useCallback wrapping");
    expect(ctx).toContain("file: src.ts");
  });

  it("Write tool → guard fires (same edit-write kind as Edit)", async () => {
    await seedMistake(tmpProject, {
      sourceFile: "src.ts",
      label: "Known auth issue",
    });
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: join(tmpProject, "src.ts"), content: "rewrite" },
      cwd: tmpProject,
    });
    expect(additionalContextOf(result)).toContain("Known auth issue");
  });

  it("Bash tool → guard fires when commandPattern substring matches the command", async () => {
    await seedMistake(tmpProject, {
      sourceFile: "deploy.sh",
      label: "Production deploy without dry-run causes data loss",
      commandPattern: "npm run deploy:prod",
    });
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm run deploy:prod --force" },
      cwd: tmpProject,
    });
    expect(additionalContextOf(result)).toContain("Production deploy without dry-run");
  });

  it("Read tool → guard NEVER fires (Read is handled by context provider, not guard)", async () => {
    await seedMistake(tmpProject, {
      sourceFile: "src.ts",
      label: "Should NOT appear in Read result",
    });
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: join(tmpProject, "src.ts") },
      cwd: tmpProject,
    });
    // Read goes through the engram:mistakes context provider during the
    // primary handler, NOT the mistake-guard wrapper. So we should never
    // see the "engramx pre-mortem" header in a Read result.
    expect(additionalContextOf(result)).not.toContain("engramx pre-mortem");
  });

  it("Edit with NO matching mistake → guard stays silent (no warning injected)", async () => {
    // Seed a mistake on a DIFFERENT file
    await seedMistake(tmpProject, {
      sourceFile: "other.ts",
      label: "Unrelated mistake on other.ts",
    });
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: join(tmpProject, "src.ts"), old_string: "x", new_string: "y" },
      cwd: tmpProject,
    });
    expect(additionalContextOf(result)).not.toContain("engramx pre-mortem");
    expect(additionalContextOf(result)).not.toContain("Unrelated mistake");
  });

  it("ENGRAM_MISTAKE_GUARD=0 explicit opt-out → guard pre-mortem silent (context provider unaffected)", async () => {
    // Two independent mistake-surfacing systems exist:
    //   1. mistake-guard.ts — wraps PreToolUse for Edit/Write/Bash;
    //      gated by ENGRAM_MISTAKE_GUARD (this test's subject).
    //   2. handleEditOrWrite → engram landmines block — always-on file-axis
    //      lookup that surfaces past mistakes for the edited file.
    // This test verifies #1 obeys the env var. #2 is a separate code path
    // and intentionally not affected — the user opted out of the pre-mortem
    // gate, not the editor-context summary.
    await seedMistake(tmpProject, {
      sourceFile: "src.ts",
      label: "Should NOT appear in pre-mortem block",
    });
    process.env.ENGRAM_MISTAKE_GUARD = "0";
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: join(tmpProject, "src.ts"), old_string: "x", new_string: "y" },
      cwd: tmpProject,
    });
    expect(additionalContextOf(result)).not.toContain("engramx pre-mortem");
    expect(additionalContextOf(result)).not.toContain("you've made this mistake before");
  });

  it("dispatch wiring passes correct kind ('edit-write' for Edit, 'bash' for Bash)", async () => {
    // This is the regression-prevention test for the audit's specific
    // concern: if dispatch.ts ever passes the wrong kind string, the
    // edit-write branch's file-path matching would not fire for an Edit
    // payload (file_path lookup would fail). We assert the file-path
    // path actually does fire by seeding a mistake keyed to a file
    // that ONLY matches via the edit-write branch's file_path normalization.
    await seedMistake(tmpProject, {
      sourceFile: "src.ts",
      label: "Path-normalized-edit-write match",
    });
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      // Use absolute path — exercises the relative() normalization in
      // findMatchingMistakesAsync that's the most fragile dispatch
      // contract.
      tool_input: { file_path: join(tmpProject, "src.ts"), old_string: "x", new_string: "y" },
      cwd: tmpProject,
    });
    expect(additionalContextOf(result)).toContain("Path-normalized-edit-write match");
  });
});
