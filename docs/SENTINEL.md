# Sentinel interception and recovery

Sentinel is Engram's optional agent-hook layer. It can replace some full reads with graph context, add warnings to edits, and track session events. Whether an interception is useful depends on graph coverage, freshness and the information the task requires.

## Hook lifecycle

The installer declares eight event families in this revision: `PreToolUse`, `PostToolUse`, `SessionStart`, `SubagentStart`, `UserPromptSubmit`, `PreCompact`, `CwdChanged`, and `Stop`. The dispatcher routes PreToolUse events for Read, Edit, Write, Bash and Grep. Older diagrams with four or six events describe earlier revisions.

| Surface | Behavior to inspect |
| --- | --- |
| Read | Select structural context or pass through; repeated unchanged full reads can use a same-session pointer |
| Edit / Write | Add relevant context and apply the configured mistake guard |
| Bash | Inspect supported command forms; the mistake guard can also warn or deny |
| Grep | A dedicated handler can answer selected structural searches; it is not universally untouched |
| Session and compaction events | Compose context and manage session-related state |
| PostToolUse and Stop | Observe outcomes and perform the declared session bookkeeping |

Client event semantics and ordering must be verified against the installed client. Multiple hooks can overlap; no conflict-free guarantee follows from using different event names.

## Read decision path

The handler validates the tool and file path, passes explicit positive offset/limit reads through, rejects unsafe content paths, resolves project context, and checks the project kill switch. It then considers same-session read deduplication before graph coverage, freshness and confidence checks.

When the graph has no useful code nodes, is stale for the file, or is below the confidence threshold, the structural-summary path passes through. The handler also compares estimated packet size with the raw-file estimate; both the structural and enriched packets have size gates. These checks reduce avoidable substitutions but do not prove semantic completeness.

A deny response can carry the structural summary in `permissionDecisionReason`; it is deliberately replacing the original raw read. The original HTML's statement that nothing blocks a tool call is therefore inaccurate. Request explicit source ranges when the full implementation is needed and verify the original file before changing it.

Same-session deduplication uses a separate unchanged-file guard and resets around context lifecycle events. A pointer is meaningful only if the earlier contents remain available in the client context; validate this behavior in the client rather than assuming all compaction modes are equivalent.

## Mistake guard modes

The executable `currentGuardMode()` implementation controls `ENGRAM_MISTAKE_GUARD`:

| Value | Behavior |
| --- | --- |
| Unset, `1`, or other values | Permissive warning mode |
| `0` or empty string | Off |
| `2` | Strict mode, which can deny a matching tool call |

Older comments and HTML say the guard is off unless enabled; the implementation in this revision defaults to permissive. Matching uses recorded file or command information and validity filtering. A warning is a prompt to inspect evidence, not proof that the proposed operation repeats a bug.

## State and external effects

Engram writes more than the graph database: installer settings, graph-related state, hook logs, generated context, caches and token/configuration files can also be involved. Optional providers may execute processes or make network requests. The graph is local, but a connected agent can send returned context to its model provider.

Review the selected scope with `engram install-hook --dry-run --scope local -p PROJECT`. Keep a copy of existing client configuration before enabling overlapping integrations. The installer manages Engram-owned entries; coexistence and preservation still need runtime checks in the target configuration.

## Diagnose and recover

```bash
engram hook-preview /absolute/path/to/project/src/example.ts -p /absolute/path/to/project
engram hook-stats -p /absolute/path/to/project --json
engram hook-disable -p /absolute/path/to/project
engram uninstall-hook --scope local -p /absolute/path/to/project
```

Preview the actual file, inspect logs after a real session, and compare outcomes with direct source reads. `hook-disable` activates the project kill switch; `hook-enable` reverses it. Uninstall each scope that was intentionally configured. Stop any watcher/server separately and retain graph backups before attempting database recovery.

## Measurement

Hook event counts and estimated context reductions describe observed interception decisions. They do not establish task accuracy, avoided regressions, subscription headroom, or invoice savings. A fair evaluation records the original task, source revision, fallback reads, output correctness and actual usage. Historical showcase percentages remain historical presentation material.

## Source and verification

Pinned revision: `9fa2a4b74ca8e66560d74d1255c16c43157d32bd`. These commands and behaviors were source-inspected, not executed. Client compatibility, clean installation and measured outcomes remain unverified.

- [src/intercept/installer.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/installer.ts)
- [src/intercept/dispatch.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/dispatch.ts)
- [src/intercept/handlers/read.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/read.ts)
- [src/intercept/handlers/mistake-guard.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/mistake-guard.ts)
- [src/intercept/served-reads.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/served-reads.ts)
- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
