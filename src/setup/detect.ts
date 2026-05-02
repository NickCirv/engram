/**
 * IDE adapter detection — which AI coding tools are on this machine?
 *
 * Used by `engram setup` to decide which adapters to offer. Pure
 * file-existence probes — no network, no shell calls.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface IdeDetection {
  readonly name: string;
  /** True iff the IDE is installed / has a config dir. */
  readonly installed: boolean;
  /** True iff engram is already configured for this IDE. */
  readonly configured: boolean;
  /** One-line status for the setup wizard. */
  readonly status: string;
}

/** Detect Claude Code presence and whether the Sentinel hook is wired. */
export function detectClaudeCode(projectRoot: string): IdeDetection {
  const settingsCandidates = [
    join(projectRoot, ".claude", "settings.local.json"),
    join(projectRoot, ".claude", "settings.json"),
    join(homedir(), ".claude", "settings.json"),
  ];

  const settingsPresent = settingsCandidates.some(existsSync);
  const claudeCliPresent =
    existsSync(join(homedir(), ".claude")) ||
    existsSync("/usr/local/bin/claude") ||
    existsSync(join(homedir(), ".local/bin/claude"));

  const installed = settingsPresent || claudeCliPresent;

  let configured = false;
  try {
    configured = settingsCandidates
      .filter(existsSync)
      .some((p) => readFileSync(p, "utf-8").includes("engram intercept"));
  } catch {
    configured = false;
  }

  return {
    name: "Claude Code",
    installed,
    configured,
    status: !installed
      ? "not detected"
      : configured
        ? "Sentinel hook installed"
        : "detected — hook not yet installed",
  };
}

/** Detect Cursor IDE and whether engram's MDC adapter is written. */
export function detectCursor(projectRoot: string): IdeDetection {
  const cursorConfigs = [
    join(homedir(), "Library/Application Support/Cursor"),
    join(homedir(), ".config/Cursor"),
    join(homedir(), "AppData/Roaming/Cursor"),
  ];
  const installed = cursorConfigs.some(existsSync);
  const configured = existsSync(
    join(projectRoot, ".cursor", "rules", "engram-context.mdc")
  );
  return {
    name: "Cursor",
    installed,
    configured,
    status: !installed
      ? "not detected"
      : configured
        ? "MDC adapter present"
        : "detected — run `engram gen-mdc`",
  };
}

/** Detect Windsurf (Codeium) via .windsurfrules presence. */
export function detectWindsurf(projectRoot: string): IdeDetection {
  const configured = existsSync(join(projectRoot, ".windsurfrules"));
  return {
    name: "Windsurf",
    installed: configured,
    configured,
    status: configured
      ? ".windsurfrules present"
      : "run `engram gen-windsurfrules` to add",
  };
}

/** Detect Continue.dev via ~/.continue/config.json. */
export function detectContinue(): IdeDetection {
  const path = join(homedir(), ".continue", "config.json");
  const installed = existsSync(path);
  let configured = false;
  if (installed) {
    try {
      configured = readFileSync(path, "utf-8").includes("engram");
    } catch {
      configured = false;
    }
  }
  return {
    name: "Continue.dev",
    installed,
    configured,
    status: !installed
      ? "not detected"
      : configured
        ? "engram configured"
        : "detected — add engram MCP server to config",
  };
}

/** Detect Aider via .aider-context.md presence or ~/.aider. */
export function detectAider(projectRoot: string): IdeDetection {
  const configured = existsSync(join(projectRoot, ".aider-context.md"));
  const installed = configured || existsSync(join(homedir(), ".aider"));
  return {
    name: "Aider",
    installed,
    configured,
    status: !installed
      ? "not detected"
      : configured
        ? ".aider-context.md present"
        : "detected — run `engram gen-aider`",
  };
}

/** Detect Cline (VS Code AI agent) via its config dir. */
export function detectCline(): IdeDetection {
  const candidates = [
    join(homedir(), "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev"),
    join(homedir(), ".config/Code/User/globalStorage/saoudrizwan.claude-dev"),
    join(homedir(), "AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev"),
  ];
  const installed = candidates.some(existsSync);
  let configured = false;
  if (installed) {
    try {
      configured = candidates
        .filter(existsSync)
        .some((p) => {
          const settings = join(p, "settings", "cline_mcp_settings.json");
          return existsSync(settings) && readFileSync(settings, "utf-8").includes("engram");
        });
    } catch {
      configured = false;
    }
  }
  return {
    name: "Cline",
    installed,
    configured,
    status: !installed
      ? "not detected"
      : configured
        ? "engram MCP server registered"
        : "detected — add engram-serve to cline_mcp_settings.json",
  };
}

/** Detect Zed via ~/.config/zed (Linux/macOS) or %APPDATA%/Zed (Windows). */
export function detectZed(projectRoot: string): IdeDetection {
  const candidates = [
    join(homedir(), ".config/zed"),
    join(homedir(), "Library/Application Support/Zed"),
    join(homedir(), "AppData/Roaming/Zed"),
  ];
  const installed = candidates.some(existsSync);
  const configured = existsSync(join(projectRoot, ".zed", "settings.json"));
  return {
    name: "Zed",
    installed,
    configured,
    status: !installed
      ? "not detected"
      : configured
        ? "Zed project settings present"
        : "detected — add engram context server",
  };
}

/** Detect OpenAI Codex CLI via ~/.codex or AGENTS.md presence. */
export function detectCodex(projectRoot: string): IdeDetection {
  const installed = existsSync(join(homedir(), ".codex"));
  const configured = existsSync(join(projectRoot, "AGENTS.md"));
  return {
    name: "Codex CLI",
    installed,
    configured,
    status: !installed
      ? "not detected"
      : configured
        ? "AGENTS.md present"
        : "detected — run `engram gen` to create AGENTS.md",
  };
}

/** Run all detections. */
export function detectAllIdes(projectRoot: string): readonly IdeDetection[] {
  return [
    detectClaudeCode(projectRoot),
    detectCursor(projectRoot),
    detectCline(),
    detectContinue(),
    detectWindsurf(projectRoot),
    detectAider(projectRoot),
    detectZed(projectRoot),
    detectCodex(projectRoot),
  ];
}
