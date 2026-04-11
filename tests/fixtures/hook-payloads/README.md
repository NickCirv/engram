# Hook Payload Fixtures

These are real `stdin` payloads captured from Claude Code during the
2026-04-11 empirical spike that proved the v0.3 "Sentinel" architecture is
viable.

They serve as frozen regression fixtures: any change to the intercept
handlers must still produce valid responses for these exact inputs.

## Files

| File | Source | What it proves |
|------|--------|----------------|
| `pretooluse-read.json` | Claude Code PreToolUse hook, Read of target-v2.txt | The shape of a Read hook payload (tool_name, tool_input, etc.) |

## Verified response shapes

The spike confirmed TWO response mechanisms work for PreToolUse:Read:

1. **Deny with reason** — blocks the Read, reason arrives at the agent
   as a system-reminder containing the engram summary.
   ```json
   {
     "hookSpecificOutput": {
       "hookEventName": "PreToolUse",
       "permissionDecision": "deny",
       "permissionDecisionReason": "[engram] <summary>"
     }
   }
   ```

2. **Allow with additionalContext** — lets the Read run AND injects
   context alongside the file contents.
   ```json
   {
     "hookSpecificOutput": {
       "hookEventName": "PreToolUse",
       "permissionDecision": "allow",
       "additionalContext": "[engram] <warning>"
     }
   }
   ```

## Verified NOT working

`updatedInput.file_path` for Read is silently ignored. Do not attempt.
See `reference_claude_code_hook_protocol_empirical.md` in Nick's memory
system for details.
