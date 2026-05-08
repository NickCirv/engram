/**
 * Git hooks — auto-rebuild engram graph on commit and branch switch.
 * Install: engram hooks install
 * Uninstall: engram hooks uninstall
 */
import { existsSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const HOOK_START = "# engram-hook-start";
const HOOK_END = "# engram-hook-end";

const POST_COMMIT_SCRIPT = `
${HOOK_START}
# Auto-rebuild engram graph after commit (AST only, no LLM needed)
ENGRAM_BIN=$(command -v engram 2>/dev/null)
if [ -z "$ENGRAM_BIN" ]; then
  ENGRAM_BIN=$(npm root -g 2>/dev/null)/engram/dist/cli.js
fi

if [ -d ".engram" ] && [ -f "$ENGRAM_BIN" ]; then
  node "$ENGRAM_BIN" init . --quiet 2>/dev/null &
fi
${HOOK_END}
`;

const POST_CHECKOUT_SCRIPT = `
${HOOK_START}
# Auto-rebuild engram graph on branch switch
PREV_HEAD=$1
NEW_HEAD=$2
BRANCH_SWITCH=$3

if [ "$BRANCH_SWITCH" != "1" ]; then
  exit 0
fi

ENGRAM_BIN=$(command -v engram 2>/dev/null)
if [ -z "$ENGRAM_BIN" ]; then
  ENGRAM_BIN=$(npm root -g 2>/dev/null)/engram/dist/cli.js
fi

if [ -d ".engram" ] && [ -f "$ENGRAM_BIN" ]; then
  echo "[engramx] Branch switched — rebuilding graph..."
  node "$ENGRAM_BIN" init . --quiet 2>/dev/null &
fi
${HOOK_END}
`;

function findGitRoot(from: string): string | null {
  let current = from;
  while (current !== "/") {
    if (existsSync(join(current, ".git"))) return current;
    current = join(current, "..");
  }
  return null;
}

function installHook(hooksDir: string, name: string, script: string): string {
  const hookPath = join(hooksDir, name);

  if (existsSync(hookPath)) {
    const content = readFileSync(hookPath, "utf-8");
    if (content.includes(HOOK_START)) {
      return `${name}: already installed`;
    }
    writeFileSync(hookPath, content.trimEnd() + "\n\n" + script);
    return `${name}: appended to existing hook`;
  }

  writeFileSync(hookPath, "#!/bin/bash\n" + script);
  chmodSync(hookPath, 0o755);
  return `${name}: installed`;
}

function uninstallHook(hooksDir: string, name: string): string {
  const hookPath = join(hooksDir, name);
  if (!existsSync(hookPath)) return `${name}: not installed`;

  const content = readFileSync(hookPath, "utf-8");
  if (!content.includes(HOOK_START)) return `${name}: engram hook not found`;

  const cleaned = content
    .replace(new RegExp(`\\n?${HOOK_START}[\\s\\S]*?${HOOK_END}\\n?`, "g"), "")
    .trim();

  if (!cleaned || cleaned === "#!/bin/bash") {
    unlinkSync(hookPath);
    return `${name}: removed`;
  }

  writeFileSync(hookPath, cleaned + "\n");
  return `${name}: engram section removed (other hooks preserved)`;
}

export function install(projectRoot: string): string {
  const gitRoot = findGitRoot(projectRoot);
  if (!gitRoot) return "Error: not a git repository";

  const hooksDir = join(gitRoot, ".git", "hooks");
  const results = [
    installHook(hooksDir, "post-commit", POST_COMMIT_SCRIPT),
    installHook(hooksDir, "post-checkout", POST_CHECKOUT_SCRIPT),
  ];
  return results.join("\n");
}

export function uninstall(projectRoot: string): string {
  const gitRoot = findGitRoot(projectRoot);
  if (!gitRoot) return "Error: not a git repository";

  const hooksDir = join(gitRoot, ".git", "hooks");
  const results = [
    uninstallHook(hooksDir, "post-commit"),
    uninstallHook(hooksDir, "post-checkout"),
  ];
  return results.join("\n");
}

export function status(projectRoot: string): string {
  const gitRoot = findGitRoot(projectRoot);
  if (!gitRoot) return "Not a git repository";

  const hooksDir = join(gitRoot, ".git", "hooks");
  const check = (name: string): string => {
    const p = join(hooksDir, name);
    if (!existsSync(p)) return "not installed";
    return readFileSync(p, "utf-8").includes(HOOK_START) ? "installed" : "not installed";
  };

  return `post-commit: ${check("post-commit")}\npost-checkout: ${check("post-checkout")}`;
}
