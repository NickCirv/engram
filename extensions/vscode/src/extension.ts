/**
 * engram VS Code / Cursor extension.
 *
 * Thin wrapper around the engramx CLI. The extension does not duplicate
 * engram's logic — it only surfaces commands inside the editor and runs
 * the CLI in a terminal. That keeps the extension small, the CLI as the
 * single source of truth, and updates frictionless (npm install -g
 * engramx@latest works regardless of extension version).
 *
 * Compatible with both VS Code (Microsoft Marketplace) and Cursor /
 * other VS Code forks (OpenVSX) — uses only the `vscode` API surface.
 */
import * as vscode from "vscode";

interface EngramConfig {
  readonly cliPath: string;
  readonly regenerateOnSave: boolean;
}

function readConfig(): EngramConfig {
  const cfg = vscode.workspace.getConfiguration("engram");
  return {
    cliPath: cfg.get<string>("cliPath") ?? "engram",
    regenerateOnSave: cfg.get<boolean>("regenerateOnSave") ?? false,
  };
}

function activeWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  return folders[0].uri.fsPath;
}

function runInTerminal(name: string, command: string): void {
  let term = vscode.window.terminals.find((t) => t.name === name);
  if (!term) {
    term = vscode.window.createTerminal(name);
  }
  term.show();
  term.sendText(command);
}

async function ensureWorkspace(): Promise<string | undefined> {
  const root = activeWorkspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage(
      "engram: open a folder first — engram operates on a workspace root."
    );
    return undefined;
  }
  return root;
}

export function activate(context: vscode.ExtensionContext): void {
  const cfg = readConfig();

  const cmdInit = vscode.commands.registerCommand("engram.init", async () => {
    const root = await ensureWorkspace();
    if (!root) return;
    runInTerminal("engram", `${cfg.cliPath} init "${root}"`);
  });

  const cmdGenMdc = vscode.commands.registerCommand(
    "engram.genMdc",
    async () => {
      const root = await ensureWorkspace();
      if (!root) return;
      runInTerminal("engram", `${cfg.cliPath} gen-mdc -p "${root}"`);
    }
  );

  const cmdGenAgents = vscode.commands.registerCommand(
    "engram.genAgentsMd",
    async () => {
      const root = await ensureWorkspace();
      if (!root) return;
      runInTerminal("engram", `${cfg.cliPath} gen -p "${root}"`);
    }
  );

  const cmdCost = vscode.commands.registerCommand("engram.cost", async () => {
    const root = await ensureWorkspace();
    if (!root) return;
    runInTerminal("engram", `${cfg.cliPath} cost -p "${root}"`);
  });

  const cmdDashboard = vscode.commands.registerCommand(
    "engram.dashboard",
    async () => {
      const root = await ensureWorkspace();
      if (!root) return;
      runInTerminal("engram", `${cfg.cliPath} dashboard "${root}"`);
    }
  );

  const cmdDoctor = vscode.commands.registerCommand(
    "engram.doctor",
    async () => {
      runInTerminal("engram", `${cfg.cliPath} doctor`);
    }
  );

  context.subscriptions.push(
    cmdInit,
    cmdGenMdc,
    cmdGenAgents,
    cmdCost,
    cmdDashboard,
    cmdDoctor
  );

  // Optional save-driven regeneration. Off by default — users opt in via
  // the engram.regenerateOnSave setting, because the CLI invocation is
  // synchronous and we don't want to surprise people on every save.
  if (cfg.regenerateOnSave) {
    const sub = vscode.workspace.onDidSaveTextDocument(() => {
      const root = activeWorkspaceRoot();
      if (!root) return;
      // Fire and forget — terminal handles its own output.
      runInTerminal("engram", `${cfg.cliPath} gen-mdc -p "${root}"`);
    });
    context.subscriptions.push(sub);
  }

  // Status bar entry — quick access to cost telemetry.
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  status.text = "$(database) engram";
  status.tooltip = "Show engram token-savings telemetry";
  status.command = "engram.cost";
  status.show();
  context.subscriptions.push(status);
}

export function deactivate(): void {
  // Terminal cleanup happens via context.subscriptions.dispose().
}
