# Security Policy

## Reporting a vulnerability

**Please do not file public issues for security bugs.**

Report security vulnerabilities privately via GitHub:

- **Preferred:** [Report a vulnerability](https://github.com/NickCirv/engram/security/advisories/new) (GitHub Private Vulnerability Reporting)
- **Alternative:** Email the maintainer — contact address is in the repo owner's GitHub profile

Please include:

- A concise description of the issue.
- Affected version(s) and platform.
- Steps to reproduce — ideally a minimal PoC.
- Impact analysis (what an attacker can achieve).
- Suggested remediation if you have one.

We aim to:

- Acknowledge receipt within 3 business days.
- Triage and confirm within 7 business days.
- Ship a fix within 30 days for high/critical severity, 90 days otherwise.
- Credit reporters in the release notes and GitHub Security Advisory unless you request anonymity.

## Supported versions

Only the latest minor release line gets security patches.

| Version | Supported |
| ------- | --------- |
| 2.x     | ✅        |
| < 2.0   | ❌        |

## Scope

In scope:

- The `engramx` npm package (CLI, HTTP server, hook pipeline, MCP server).
- Local data exposure via the HTTP server bound to `127.0.0.1`.
- Indirect prompt injection through graph nodes that get surfaced to coding agents.
- Path traversal, SSRF, injection bugs in engram's own code.

Out of scope:

- Vulnerabilities in dependencies — report those upstream.
- Issues that require root or filesystem write access on the developer's machine to exploit (attacker is already on the box).
- Missing defense-in-depth hardening that doesn't translate to an exploit (please file as a normal issue).

## Threat model

engram is a local developer tool. The HTTP server binds to `127.0.0.1`, reads a random auth token from `~/.engram/http-server.token` (mode 0600), and requires either `Authorization: Bearer <token>` or an `HttpOnly` `engram_token` cookie on every non-public route. It rejects cross-origin browser tabs via Host + Origin validation and blocks the `text/plain` CSRF vector on mutations by requiring `application/json`.

The web dashboard at `/ui` is bootstrapped by the `engram ui` CLI, which opens `http://127.0.0.1:7337/ui?token=<t>` and exchanges the token for an `HttpOnly; SameSite=Strict` cookie via a one-shot 302 redirect. The dashboard's JavaScript never sees the raw token.

## Past advisories

- **v2.0.2 (2026-04-18)** — Fixed CORS wildcard + auth-off-by-default on the HTTP server. Reported by @gabiudrescu ([#7](https://github.com/NickCirv/engram/issues/7)).
