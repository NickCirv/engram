# ADR-0005: Intercept Bash `rg`/`grep` via the Grep handler

**Status:** Accepted · **Date:** 2026-06-04 · **Author:** Nicholas

## Context

ADR-0001/0004 intercept the structured **Grep tool**. But an agent can also search by running
`rg`/`grep` through the **Bash tool** — and that path gets none of engram's help. Two facts make this
worth closing:

- **Bash dominates.** In real hook-logs Bash is **45.7%** of all tool events (7,834/17,128); the
  structured Grep tool is **1.16%** (199) — a 39:1 ratio. (The hook-log doesn't store the Bash command
  string, so the exact shell-grep share isn't directly measurable yet — see "Follow-up".)
- **Multi-IDE coverage is the real case.** engram targets 8 IDEs. Aider, Codex CLI, and Cline (and
  often Continue/Windsurf) have **no first-class Grep tool** — they search by running `rg`/`grep` in a
  shell. For those, the Bash path is the *only* grep path, so engram's symbol-search packet is currently
  **invisible** to roughly a third-to-half of supported IDEs. This is net-new coverage, not incremental.

`handleBash` already proves the pattern for reads: strict-parse a `cat`/`head`/`tail` command and
delegate to `handleRead`. We mirror it for grep.

## Decision

Add `parseGrepBashCommand` to `bash.ts`: detect a **content-mode symbol grep** — `rg`/`grep`/`egrep`/
`fgrep` with a bare-identifier pattern, **no** files/count mode flags (`-l`/`--files-with-matches`/`-c`/
`--count`/`-o`/`-L`), and **no** shell control characters (pipes, redirects, command substitution,
chains). Strip surrounding quotes from the pattern, then delegate to **`handleGrep`** with a synthesized
`{ tool_name: "Grep", cwd, tool_input: { pattern, output_mode: "content" } }`.

This **reuses `handleGrep` wholesale** — every v4.2 gate re-runs (the `ENGRAM_GREP_INTERCEPT=0` opt-out,
`SYMBOL_RE` + stopwords, content-mode, kill switch, `MIN_CALLER_FILES ≥ 4`, the call-site scan from
ADR-0004) and the `rg -n` escalation is included. No new graph, gate, or recall-safety logic.

## The trade-off

The parser is **conservative**: any shell control char (`| & ; < > $ \` \ ( ) \n`), a files/count-mode
flag, or a non-grep command → passthrough (the real shell command runs). So we miss piped/complex greps
(`rg foo | head`, `grep -rl`) — the safe direction, identical to the read parser's philosophy: a false
negative costs tokens, a false positive costs correctness, and we optimise for correctness. Quotes are
**allowed** here (unlike the read parser) because a grep pattern is commonly quoted (`rg "handleAuth"`);
the pattern is unquoted before `handleGrep`'s `SYMBOL_RE` gate decides. Any path/scope argument is
ignored (engram answers from the resolved caller files repo-wide; the escalation re-runs the exact
command if the agent wanted the scope) — same behaviour as the Grep tool. On Claude Code this is
incremental; the justification is coverage for the shell-only IDEs.

## Follow-up

The Bash hook-log line records no command string, so the true content-grep frequency is estimated, not
measured. Add `command` to the Bash hook-log entry (a cheap one-field change) so Token-loop C can
measure shell-grep frequency directly instead of inferring it from the 39:1 Bash:Grep ratio.
