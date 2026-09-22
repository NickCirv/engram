# engram — research record

## Revision and scope

- Repository: [NickCirv/engram](https://github.com/NickCirv/engram)
- Commit: `9fa2a4b74ca8e66560d74d1255c16c43157d32bd`
- Tree: `493929bca5524ad945d86569b393a83000ef3775`
- Captured: 332 of 332 eligible text files (all eligible text files).
- Recursive tree truncated: `False`.
- Runtime verification: **unverified**; no repository code, installation or test command was executed.

The captured file inventory is broader than the semantic review. Authoring inspected package metadata, entrypoint/argument handling and implementation paths relevant to the claims below, plus test declarations. This is documentation research, not a line-by-line security audit. Generated/binary artifacts, lockfiles and file types outside the acquisition filter were not inspected.

## Claim and evidence

| Claim | Pinned evidence | Status |
| --- | --- | --- |
| Runtime requirement and executable mapping | [package.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/package.json) | verified in manifest; installation unverified |
| Build a local structural code graph and provide focused context to coding agents. | [implementation](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts) | partially verified by static implementation review |
| Operational limits and side effects | [implementation](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts) and source map in [reference](REFERENCE.md) | partially verified; runtime unverified |
| Test command definition | [package.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/package.json) | verified as a declaration only |

## Findings carried into the rewrite

Graph summaries are retrieval aids, not execution traces or complete semantic understanding. Hook output can change what an agent sees. Token estimates and fixture benchmarks are not invoice savings or proof of task accuracy; measure both quality and cost on your workload.

No runtime checks were executed for this documentation review. A declared test command is available below; its presence is not a passing result.

## Documentation inventory and disposition

| Existing document | Disposition |
| --- | --- |
| [.github/ISSUE_TEMPLATE/bug_report.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/.github/ISSUE_TEMPLATE/bug_report.md) | Preserved issue-reporting workflow template; not a product usage guide. |
| [.github/ISSUE_TEMPLATE/feature_request.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/.github/ISSUE_TEMPLATE/feature_request.md) | Preserved issue-reporting workflow template; not a product usage guide. |
| [CHANGELOG.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/CHANGELOG.md) | Preserved policy, legal/specification or historical release text; no overlay replacement. |
| [CLAUDE.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/CLAUDE.md) | Preserved executable agent/prompt contract; prose refresh does not authorize changing agent behavior. |
| [CONTEXT.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/CONTEXT.md) | Preserved executable agent/prompt contract; prose refresh does not authorize changing agent behavior. |
| [CONTRIBUTING.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/CONTRIBUTING.md) | Preserved policy, legal/specification or historical release text; no overlay replacement. |
| [README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/README.md) | Rewritten overview; historical copy remains at this pinned URL. |
| [SECURITY.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/SECURITY.md) | Preserved policy, legal/specification or historical release text; no overlay replacement. |
| [adapters/continue/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/adapters/continue/README.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [bench/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/README.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [bench/results/real-world-2026-04-24.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/results/real-world-2026-04-24.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [demo/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/demo/README.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/COMPARISON.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/COMPARISON.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/FRONTIER.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/FRONTIER.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/INTEGRATION.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/INTEGRATION.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/PLAN.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/PLAN.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/STATE.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/STATE.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/adr/0001-grep-symbol-intercept.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0001-grep-symbol-intercept.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/adr/0002-session-level-bench.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0002-session-level-bench.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/adr/0003-same-session-read-dedup.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0003-same-session-read-dedup.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/adr/0004-grep-richer-find-usages.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0004-grep-richer-find-usages.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/adr/0005-bash-grep-interception.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0005-bash-grep-interception.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/adr/0006-honest-before-after-demo.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0006-honest-before-after-demo.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/adr/0007-grep-never-worse-gate.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0007-grep-never-worse-gate.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/adr/0008-subagent-context-broker.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0008-subagent-context-broker.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/adr/0009-recall-coverage-benchmark.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0009-recall-coverage-benchmark.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/adr/0010-compaction-session-ledger.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0010-compaction-session-ledger.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/adr/0011-defer-bash-explore-interception.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0011-defer-bash-explore-interception.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/adr/0012-session-replay-measurement.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0012-session-replay-measurement.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/adr/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/README.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/demos/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/demos/README.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/demos/hf/AGENTS.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/demos/hf/AGENTS.md) | Preserved executable agent/prompt contract; prose refresh does not authorize changing agent behavior. |
| [docs/demos/hf/CLAUDE.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/demos/hf/CLAUDE.md) | Preserved executable agent/prompt contract; prose refresh does not authorize changing agent behavior. |
| [docs/demos/scene-table.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/demos/scene-table.md) | Deferred coordinated media revision: historical scene copy must change alongside HTML, captions and rendered assets; quantitative claims not revalidated. |
| [docs/design/phaseA-displacement-resolver.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/design/phaseA-displacement-resolver.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/distribution/SUBMISSIONS.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/distribution/SUBMISSIONS.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/integrations/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/README.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/integrations/aider.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/aider.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/integrations/ccs.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/ccs.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/integrations/claude-code.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/claude-code.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/integrations/cline.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/cline.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/integrations/continue.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/continue.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/integrations/cursor-mcp.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/cursor-mcp.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/integrations/emacs.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/emacs.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/integrations/neovim.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/neovim.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/integrations/zed.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/zed.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/plugins/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/plugins/README.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [docs/release-notes-4.3.0.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/release-notes-4.3.0.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/release-notes-4.3.1.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/release-notes-4.3.1.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/release-notes-4.3.2.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/release-notes-4.3.2.md) | Preserved historical design, ADR, plan, release or measurement artifact; not asserted as current implementation guidance. |
| [docs/specs/2026-04-13-context-spine-design.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/specs/2026-04-13-context-spine-design.md) | Preserved policy, legal/specification or historical release text; no overlay replacement. |
| [docs/specs/ecp-v0.1.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/specs/ecp-v0.1.md) | Preserved policy, legal/specification or historical release text; no overlay replacement. |
| [docs/specs/engram-v2-roadmap.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/specs/engram-v2-roadmap.md) | Preserved policy, legal/specification or historical release text; no overlay replacement. |
| [docs/superpowers/specs/2026-04-24-v3.0-spine-implementation.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/superpowers/specs/2026-04-24-v3.0-spine-implementation.md) | Preserved policy, legal/specification or historical release text; no overlay replacement. |
| [extensions/vscode/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/extensions/vscode/README.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [llms-install.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/llms-install.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [plugins/anthropic-marketplace/engram/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/plugins/anthropic-marketplace/engram/README.md) | Rewritten from pinned source; examples and integrations unexecuted. |
| [plugins/anthropic-marketplace/engram/skills/cost/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/plugins/anthropic-marketplace/engram/skills/cost/SKILL.md) | Preserved executable agent/prompt contract; prose refresh does not authorize changing agent behavior. |
| [plugins/anthropic-marketplace/engram/skills/mistakes/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/plugins/anthropic-marketplace/engram/skills/mistakes/SKILL.md) | Preserved executable agent/prompt contract; prose refresh does not authorize changing agent behavior. |
| [plugins/anthropic-marketplace/engram/skills/query/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/plugins/anthropic-marketplace/engram/skills/query/SKILL.md) | Preserved executable agent/prompt contract; prose refresh does not authorize changing agent behavior. |
| [tests/fixtures/hook-payloads/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/hook-payloads/README.md) | Preserved executable test fixture or fixture contract; changing it could alter test coverage. No runtime result inferred. |
| [tests/fixtures/memory-md/sample-index.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/memory-md/sample-index.md) | Preserved executable test fixture or fixture contract; changing it could alter test coverage. No runtime result inferred. |
| [tests/fixtures/mistake-corpus-readme.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/mistake-corpus-readme.md) | Preserved executable test fixture or fixture contract; changing it could alter test coverage. No runtime result inferred. |
| [tests/fixtures/skills/anomaly/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/skills/anomaly/SKILL.md) | Preserved executable test fixture or fixture contract; changing it could alter test coverage. No runtime result inferred. |
| [tests/fixtures/skills/corrupted/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/skills/corrupted/SKILL.md) | Preserved executable test fixture or fixture contract; changing it could alter test coverage. No runtime result inferred. |
| [tests/fixtures/skills/empty-body/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/skills/empty-body/SKILL.md) | Preserved executable test fixture or fixture contract; changing it could alter test coverage. No runtime result inferred. |
| [tests/fixtures/skills/multiline/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/skills/multiline/SKILL.md) | Preserved executable test fixture or fixture contract; changing it could alter test coverage. No runtime result inferred. |
| [tests/fixtures/skills/normal/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/skills/normal/SKILL.md) | Preserved executable test fixture or fixture contract; changing it could alter test coverage. No runtime result inferred. |
| [tests/fixtures/skills/unicode/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/skills/unicode/SKILL.md) | Preserved executable test fixture or fixture contract; changing it could alter test coverage. No runtime result inferred. |

New supporting documents: `docs/REFERENCE.md` and `docs/RESEARCH.md`. No original source or protected legal/security file was changed.

## Protected-file evidence

- `LICENSE` SHA-256 `1d16686a13cf73b91280e909e1459e0d1aa43231000ac5d8cf72b3d18ef0b63a`.
- `SECURITY.md` SHA-256 `1287e0547f8c4ca298fda25d977da4b1bcf21946723c14502bbab1455bd94c08`.
- `CHANGELOG.md` SHA-256 `771f49e8f8225b5dd0c6033f5400ace08edb78df865e2c24dd6c91fae734c94c`.
- `extensions/vscode/LICENSE` SHA-256 `1d16686a13cf73b91280e909e1459e0d1aa43231000ac5d8cf72b3d18ef0b63a`.

## Remaining verification

Clean installation, useful-command execution, malformed input, side-effect boundaries, platform compatibility and end-to-end tests remain unverified. Package-registry availability and live API destinations were not checked. No performance, customer-adoption, compliance or production-readiness claim is made.

## Captured evidence index

- [CONTRIBUTING.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/CONTRIBUTING.md) · blob `070f71bec5448e8fda75c5588c278c16c0cdb4b5`.
- [LICENSE](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/LICENSE) · blob `53c9ba0330ad1c62f9d9ba9a0b3895a54dd0d6f4`.
- [README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/README.md) · blob `48b7c22a70e6bbbbe86abbb96ebf734e6410eb8c`.
- [SECURITY.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/SECURITY.md) · blob `441649d3e9abeeb70176da01e256919a4eb47a20`.
- [package.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/package.json) · blob `f7bf4239e87892948748feec4632cadedcc53e7f`.
- [.github/workflows/ci.yml](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/.github/workflows/ci.yml) · blob `fa8af0aeb41ee06b0874398ea17dd594026c9bb8`.
- [.gitleaks.toml](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/.gitleaks.toml) · blob `9251eb8446689ca1b5371c7fed3c301ddeebacd1`.
- [CHANGELOG.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/CHANGELOG.md) · blob `609465e118f61ec82cbc1598bac38241b7aa1513`.
- [CLAUDE.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/CLAUDE.md) · blob `5d6617a9964885a7fddef2176a6197948855dbdf`.
- [CONTEXT.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/CONTEXT.md) · blob `6daf8c86d9c89b67dc6aa51a5987c574c4c50785`.
- [llms-install.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/llms-install.md) · blob `6972ebd830e78b017fabeb09e53ed57f577dae12`.
- [server.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/server.json) · blob `026c81dafb641d97899146a50d1a977b3a6ff117`.
- [src/cli-guards.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli-guards.ts) · blob `2889ded17a9ebecf061bb2b1578e96f1d870f0c6`.
- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts) · blob `b45fed2f74bd4e9d303eb06df24101d5992ff686`.
- [src/cli/format-mistake.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli/format-mistake.ts) · blob `d195c191d9d9f346eb563778787b729a0f233762`.
- [tsconfig.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tsconfig.json) · blob `b6c31a06b940b1d6bfed0692ae808979aac0e40f`.
- [tsup.config.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tsup.config.ts) · blob `9148156dd3c33ee1678ed56369d8949279e631e8`.
- [vitest.config.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/vitest.config.ts) · blob `98223aaf643030d836a98b2013a305d834a9a7ec`.
- [.github/ISSUE_TEMPLATE/bug_report.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/.github/ISSUE_TEMPLATE/bug_report.md) · blob `e6bff9d241838a349c1509cfa312a76c0a00087b`.
- [.github/ISSUE_TEMPLATE/feature_request.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/.github/ISSUE_TEMPLATE/feature_request.md) · blob `b0c6b15e6fa2c5d60c569545584fabbbbc072e4e`.
- [adapters/continue/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/adapters/continue/README.md) · blob `74f754b8b728352726c724f15babdd7b554277ee`.
- [bench/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/README.md) · blob `a0aca436ed06ed5267958426a216751f8acd2ef7`.
- [bench/results/real-world-2026-04-24.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/results/real-world-2026-04-24.md) · blob `c7f2dce4c0e735205f1768a470b5742bd2865886`.
- [demo/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/demo/README.md) · blob `cf25542f48fef59dcef6f34c82ccc22e3284be33`.
- [docs/COMPARISON.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/COMPARISON.md) · blob `939c647da25eeab81a102b0a5bc8e43378e1e685`.
- [docs/FRONTIER.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/FRONTIER.md) · blob `29e233a7fc11bb5dff86d756899ac75ba72fef51`.
- [docs/INTEGRATION.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/INTEGRATION.md) · blob `d6f338786e84a16c7999b89a530d9246438e1853`.
- [docs/PLAN.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/PLAN.md) · blob `0b631b5386d39d055d33766b45a367310e7b9874`.
- [docs/STATE.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/STATE.md) · blob `bd1fa409f92103c7da7067c20755f28552fa3cc0`.
- [docs/adr/0001-grep-symbol-intercept.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0001-grep-symbol-intercept.md) · blob `a353522ab226a82bcedc41e47a86c4abc85aba97`.
- [docs/adr/0002-session-level-bench.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0002-session-level-bench.md) · blob `340b9e4814b8e6a690c638329f06c359ac85d495`.
- [docs/adr/0003-same-session-read-dedup.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0003-same-session-read-dedup.md) · blob `7289f0e436af07cefc322635b598d27d859592fc`.
- [docs/adr/0004-grep-richer-find-usages.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0004-grep-richer-find-usages.md) · blob `da71f5e38886da7e975a3e800fe2e02c39c3b64e`.
- [docs/adr/0005-bash-grep-interception.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0005-bash-grep-interception.md) · blob `b10364595989aabce321e8e5e574d1f48a2f6737`.
- [docs/adr/0006-honest-before-after-demo.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0006-honest-before-after-demo.md) · blob `f2f8ab85bb3414af827eda058bb24d936d5d87f4`.
- [docs/adr/0007-grep-never-worse-gate.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0007-grep-never-worse-gate.md) · blob `62728952b33dfe66ef5b4d0becd91fd7b69f9305`.
- [docs/adr/0008-subagent-context-broker.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0008-subagent-context-broker.md) · blob `b8d65757996b889f28b9bf146f04b8a542ebc57d`.
- [docs/adr/0009-recall-coverage-benchmark.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0009-recall-coverage-benchmark.md) · blob `b2b97cdf64e55474c904a7e34007d57a8e93f21e`.
- [docs/adr/0010-compaction-session-ledger.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0010-compaction-session-ledger.md) · blob `239d68d9089d4e27b3ac44576e3dfd369b4115f9`.
- [docs/adr/0011-defer-bash-explore-interception.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0011-defer-bash-explore-interception.md) · blob `9ea9d83c12a7d4179fc27c7a387b920161819045`.
- [docs/adr/0012-session-replay-measurement.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/0012-session-replay-measurement.md) · blob `be2099899db5c1f13b04628c76026fc016c9594a`.
- [docs/adr/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/adr/README.md) · blob `ff7d168a8609891dfbb482aad3a6b66ef9b9e9b3`.
- [docs/demos/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/demos/README.md) · blob `eee9a046f54474cec60c85407e500de77c3cd7fd`.
- [docs/demos/hf/AGENTS.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/demos/hf/AGENTS.md) · blob `506ecf394b55f5dd01acd08ce3fafa9014c3d14a`.
- [docs/demos/hf/CLAUDE.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/demos/hf/CLAUDE.md) · blob `8863c999c2af7403a5e00a5b92a8d06abd789289`.
- [docs/demos/scene-table.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/demos/scene-table.md) · blob `531881b2440b5a15b06b1310dc33273c0ffd587d`.
- [docs/design/phaseA-displacement-resolver.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/design/phaseA-displacement-resolver.md) · blob `4173e3be23ba4c515bff2798e88b59a8d3a002c1`.
- [docs/distribution/SUBMISSIONS.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/distribution/SUBMISSIONS.md) · blob `4552ceedd71e2a2a6938a899101021260f5513c4`.
- [docs/integrations/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/README.md) · blob `29a0180fbb696c2ed374aad8ec169c4973488e45`.
- [docs/integrations/aider.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/aider.md) · blob `ce8850c7cef124265dd3e83505eda0339a36e11f`.
- [docs/integrations/ccs.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/ccs.md) · blob `cb6a5d09b7202aa21d3ddd036e83bf06f869af7a`.
- [docs/integrations/claude-code.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/claude-code.md) · blob `2bc95207c09c84a58f58622d703a72214adef98a`.
- [docs/integrations/cline.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/cline.md) · blob `5552289c0bafe69ea6ea5867075f78055995fce5`.
- [docs/integrations/continue.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/continue.md) · blob `44742e75fc70d41e7aa70337c8d40654cf4b31f8`.
- [docs/integrations/cursor-mcp.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/cursor-mcp.md) · blob `bc1ae5e8dfe0e6f8759acd6208035cd1c16ccece`.
- [docs/integrations/emacs.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/emacs.md) · blob `93935d24c7dd9d8e4e81bd101869a567230bec7b`.
- [docs/integrations/neovim.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/neovim.md) · blob `5460fb3f256ae2e061058e8810316accd916f346`.
- [docs/integrations/zed.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/integrations/zed.md) · blob `a3509d9d9d94ff73709bd69e5bf3af5ac9484eb9`.
- [docs/plugins/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/plugins/README.md) · blob `75fdd6e292611029afea6831346ee9d6951897d5`.
- [docs/release-notes-4.3.0.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/release-notes-4.3.0.md) · blob `989cb12f52f0545aba5aa9556112a55fd4ca1920`.
- [docs/release-notes-4.3.1.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/release-notes-4.3.1.md) · blob `cb161ae2a119be3c62f98f3baab6ee68756560c7`.
- [docs/release-notes-4.3.2.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/release-notes-4.3.2.md) · blob `49ba9b4ac4227bf602b2d22173b5562461d9b777`.
- [docs/specs/2026-04-13-context-spine-design.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/specs/2026-04-13-context-spine-design.md) · blob `867acabf83a48857b1f2c8f34ab7321792b91c24`.
- [docs/specs/ecp-v0.1.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/specs/ecp-v0.1.md) · blob `d97ea84130408e786b41b0542879b0412fac20db`.
- [docs/specs/engram-v2-roadmap.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/specs/engram-v2-roadmap.md) · blob `f684f9f91511bb374d3513acb2c8e914c22c1488`.
- [docs/superpowers/specs/2026-04-24-v3.0-spine-implementation.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/superpowers/specs/2026-04-24-v3.0-spine-implementation.md) · blob `9d82299f3dfd9e4e49dfa75d06d9f8a6983f7c08`.
- [extensions/vscode/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/extensions/vscode/README.md) · blob `9339a2131d6ab231d3afa7b8edee9a7b98246ce5`.
- [plugins/anthropic-marketplace/engram/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/plugins/anthropic-marketplace/engram/README.md) · blob `f11883e5093122cf5d22707820469ed621eb72c6`.
- [plugins/anthropic-marketplace/engram/skills/cost/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/plugins/anthropic-marketplace/engram/skills/cost/SKILL.md) · blob `4b96fea07e0382976a9582343c12a3d7c5a8ed78`.
- [plugins/anthropic-marketplace/engram/skills/mistakes/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/plugins/anthropic-marketplace/engram/skills/mistakes/SKILL.md) · blob `8adfd650501c2c70cbba7d216e12698a64993c71`.
- [plugins/anthropic-marketplace/engram/skills/query/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/plugins/anthropic-marketplace/engram/skills/query/SKILL.md) · blob `f12ba1a8f1e640dffb7e806c739f3f5a96ab9159`.
- [tests/fixtures/hook-payloads/README.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/hook-payloads/README.md) · blob `d460375dbe1979a957db72cbb4cd13d8f99ed1de`.
- [tests/fixtures/memory-md/sample-index.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/memory-md/sample-index.md) · blob `90593f92e690edf02ea226868dedefecf78e854e`.
- [tests/fixtures/mistake-corpus-readme.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/mistake-corpus-readme.md) · blob `52553583510ef6b8f513df35c9cb6bd11113a26e`.
- [tests/fixtures/skills/anomaly/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/skills/anomaly/SKILL.md) · blob `8c9c20aced46f034bcd773527ecd9d08417e6a43`.
- [tests/fixtures/skills/corrupted/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/skills/corrupted/SKILL.md) · blob `3e69398e94501bdc97e90d1b284e90e566804fb4`.
- [tests/fixtures/skills/empty-body/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/skills/empty-body/SKILL.md) · blob `65e1ffbf0a30e76016000ed64c3cf2fe2d4469b1`.
- [tests/fixtures/skills/multiline/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/skills/multiline/SKILL.md) · blob `cddca2b740404920043151c07691df3b38ca4d7e`.
- [tests/fixtures/skills/normal/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/skills/normal/SKILL.md) · blob `dc075283affd3313f23a04b5ceb1b193996ea22a`.
- [tests/fixtures/skills/unicode/SKILL.md](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/skills/unicode/SKILL.md) · blob `7743209466a6e7e04db6ce103783ea5b5c08b97c`.
- [adapters/continue/package.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/adapters/continue/package.json) · blob `458b4f1fa3dc3ffd46af9f41840ec7b7b8011ead`.
- [adapters/continue/src/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/adapters/continue/src/index.ts) · blob `f168171b182a4b1f2e17b518fd23efdc6fe21d1d`.
- [adapters/continue/tsconfig.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/adapters/continue/tsconfig.json) · blob `0117ec8fdacf954d778748ffd9b8233794351f49`.
- [adapters/zed/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/adapters/zed/index.ts) · blob `f629dd53cc51468bcf5ef4f669e4316f16e8d144`.
- [bench/cochange-holdout.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/cochange-holdout.ts) · blob `c7d3aad2104ba168f1c079f4460cb6723f52ccec`.
- [bench/real-world.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/real-world.ts) · blob `84d09a23fa13a4852f77872ac2ea2cb682e6ce26`.
- [bench/recall-coverage.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/recall-coverage.ts) · blob `f5ead780c8e5122f010126d1b75b6acd8b2f6f68`.
- [bench/run.sh](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/run.sh) · blob `284fc628c829739965d71ba9380c93fc87840805`.
- [bench/runner.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/runner.ts) · blob `0aad70dc6c9084605f2ba82e0bfa3323bb7e081b`.
- [bench/session-level.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/session-level.ts) · blob `88c94205212198de2e91b5a5466d4f2f5e7ced31`.
- [bench/stats.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/stats.ts) · blob `3bf1616f06b9939a22541b36d05972962c9b4174`.
- [bench/tasks/task-01-find-caller.yaml](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/tasks/task-01-find-caller.yaml) · blob `1a9f7af0f99cdc71d68e8a8569ae0179b61c3d42`.
- [bench/tasks/task-02-parent-class.yaml](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/tasks/task-02-parent-class.yaml) · blob `c59ba747a29b8936f51200b55f0bb41b705c6a35`.
- [bench/tasks/task-03-file-for-class.yaml](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/tasks/task-03-file-for-class.yaml) · blob `97f2c60627ab87d7203eb4c2b1b821eaff13bcb8`.
- [bench/tasks/task-04-import-graph.yaml](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/tasks/task-04-import-graph.yaml) · blob `f76ebec4607ad633059b0096c0d82a7023b2cab0`.
- [bench/tasks/task-05-exported-api.yaml](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/tasks/task-05-exported-api.yaml) · blob `01bb758b495a8c6e95a1ab51ba2ff173744de600`.
- [bench/tasks/task-06-landmine-check.yaml](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/tasks/task-06-landmine-check.yaml) · blob `67f02eeeb696caf94e8df64612d5143986889006`.
- [bench/tasks/task-07-architecture-sketch.yaml](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/tasks/task-07-architecture-sketch.yaml) · blob `d31bc6c90c9786aa06c4859521cf857dbf27eee7`.
- [bench/tasks/task-08-refactor-scope.yaml](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/tasks/task-08-refactor-scope.yaml) · blob `bb5485863d976206bcb6f2ffafeec988cb148649`.
- [bench/tasks/task-09-hot-files.yaml](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/tasks/task-09-hot-files.yaml) · blob `e069e65f85be2b7d7fdf7219b1e41b8e9752f54c`.
- [bench/tasks/task-10-cross-file-flow.yaml](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/tasks/task-10-cross-file-flow.yaml) · blob `43c748a5fbb7eed60a9969b0d46493e3829b8bc8`.
- [demo/run.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/demo/run.ts) · blob `e662bbebed9ea5d1170d83e32c3117dce5ef3cea`.
- [docs/demos/hf/hyperframes.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/demos/hf/hyperframes.json) · blob `5fb1d6d872f5ecb406008695d86ae69f4216b465`.
- [docs/demos/hf/meta.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/demos/hf/meta.json) · blob `16d24ed8756752e1313717dd3ca79488885b79e1`.
- [docs/demos/v4-skill-pack-demo.sh](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/demos/v4-skill-pack-demo.sh) · blob `c0d35224dc06d0100921932682b89b6c1e89b30a`.
- [docs/plugins/examples/serena-plugin.mjs](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/plugins/examples/serena-plugin.mjs) · blob `2d9d499f3113a3593c34599bff7dd878b1e29372`.
- [docs/plugins/examples/static-context-plugin.mjs](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/plugins/examples/static-context-plugin.mjs) · blob `fa57285f08048d7e2c0da1871375561e90f7f739`.
- [extensions/vscode/LICENSE](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/extensions/vscode/LICENSE) · blob `53c9ba0330ad1c62f9d9ba9a0b3895a54dd0d6f4`.
- [extensions/vscode/package.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/extensions/vscode/package.json) · blob `772c8757829ab5fbab37c6b10de830e23c9af912`.
- [extensions/vscode/src/extension.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/extensions/vscode/src/extension.ts) · blob `e8a39fca9eec69ef10ed701f73f483ba50d0e51c`.
- [extensions/vscode/tsconfig.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/extensions/vscode/tsconfig.json) · blob `0e83ffd30957d3297f3d0b4a4f0fd5b6e4014c69`.
- [plugins/anthropic-marketplace/.claude-plugin/marketplace.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/plugins/anthropic-marketplace/.claude-plugin/marketplace.json) · blob `13bdcdea74337fde006fd4bb9bbf82a43921c8ea`.
- [plugins/anthropic-marketplace/engram/.claude-plugin/plugin.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/plugins/anthropic-marketplace/engram/.claude-plugin/plugin.json) · blob `4107e4700bf3bd215c760e0feb77092b35bf085f`.
- [plugins/anthropic-marketplace/engram/.mcp.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/plugins/anthropic-marketplace/engram/.mcp.json) · blob `c9e8af00ff77edd9b33d722e2d4fe4cca1034c6c`.
- [scripts/bundle-grammars.mjs](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/scripts/bundle-grammars.mjs) · blob `bc2d182ed7643a38055aeaf291e5e8e364ae78e5`.
- [scripts/postinstall.mjs](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/scripts/postinstall.mjs) · blob `1d5a2eb6d83f825afdc298df8df9164edf11a03e`.
- [scripts/preuninstall.mjs](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/scripts/preuninstall.mjs) · blob `4a93cea314ca1208961a2c7fee1da972973c6cea`.
- [scripts/release.sh](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/scripts/release.sh) · blob `15049dcc50bca49d89fd814bf0daf716a4f2cf83`.
- [src/autogen.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/autogen.ts) · blob `8fd6d32d9e249c70fae3e68cb1e120a62b7e4d31`.
- [src/ccs/exporter.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/ccs/exporter.ts) · blob `6020ad8a6f069acd01fc691ec06574796cd81b75`.
- [src/ccs/importer.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/ccs/importer.ts) · blob `dfaa5e66ed2f361e091ca59f7159e0a3f43f3b1a`.
- [src/commands/measure-session.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/commands/measure-session.ts) · blob `576a13b0602c5beae43d13f32c1451b266308ffa`.
- [src/commands/measure.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/commands/measure.ts) · blob `106f7ae846b2044845bde1cbcb30928ff3535513`.
- [src/core.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/core.ts) · blob `364d64a2a7be5fbe5d8ffd9d6d9ae8ec9cbbf630`.
- [src/cost/aggregator.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cost/aggregator.ts) · blob `3335b0cf8b2e75e78f029762a9831108a2d30e7a`.
- [src/cost/digest.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cost/digest.ts) · blob `808a31bad6cdaf762f93edf5d88653746369fca7`.
- [src/cost/formatter.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cost/formatter.ts) · blob `5ad2dde2f4d1f667522e37b58820427001a6dc26`.
- [src/cost/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cost/index.ts) · blob `b1866db40532ac7092e086a5c83e5733af77e004`.
- [src/cost/instrument.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cost/instrument.ts) · blob `6313ee93b2681b1c4898e0d37828f68360f35cff`.
- [src/cost/types.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cost/types.ts) · blob `2f4185f5a06ed26b62d2602924022ee7d5444a1d`.
- [src/dashboard.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/dashboard.ts) · blob `b94f1e1d9c80ef98c9a2ac65ec57a60f5ae8140b`.
- [src/db/migrate.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/db/migrate.ts) · blob `74fd11daf5f352990838b86dde013a7600748041`.
- [src/doctor/report.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/doctor/report.ts) · blob `e05749bf92c0185bf7904afa137398c8533da5ea`.
- [src/generators/aider-context.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/generators/aider-context.ts) · blob `d0caea6683d20e0070749c4a180a641c4a781181`.
- [src/generators/cursor-mdc.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/generators/cursor-mdc.ts) · blob `6ac7f29a88374a106c865086dcb2ca0e3a3ef60f`.
- [src/generators/windsurf-rules.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/generators/windsurf-rules.ts) · blob `3f16b30c01758e741be73e05707f9baa248288e1`.
- [src/graph/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/graph/index.ts) · blob `7ea8b7e054e3ce88e8051760ae4ebc48d97c09f0`.
- [src/graph/pagerank.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/graph/pagerank.ts) · blob `75052e3c457d0939e278cd65f018de1e624f7a14`.
- [src/graph/path-utils.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/graph/path-utils.ts) · blob `e454438babb132093766770a64e8701ef18c5b10`.
- [src/graph/query.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/graph/query.ts) · blob `86fd4a24953c7c103531bc4ea44ba278282ee1bc`.
- [src/graph/reach.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/graph/reach.ts) · blob `b0b7cd392f6ed7ca62d4d706f07b488e173c8d9d`.
- [src/graph/related-files.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/graph/related-files.ts) · blob `8eb17eefe93d3e829615ba7eb0516de8b139f5cd`.
- [src/graph/render-utils.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/graph/render-utils.ts) · blob `1747dc1a9f7a060e8085654829f499e2d3a8dab6`.
- [src/graph/schema.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/graph/schema.ts) · blob `9196e4ba4045d33568a0dac25bcddbf1d2f60949`.
- [src/graph/store.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/graph/store.ts) · blob `9d6d46e9235c6b1b43e8a28ad8b02acc345d77ae`.
- [src/graph/traversal.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/graph/traversal.ts) · blob `8c2995cab37aa4884ac3c2cd9498517f5d6062e7`.
- [src/hooks.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/hooks.ts) · blob `43eb968704f7ff239e036a5a78d19d923307808c`.
- [src/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/index.ts) · blob `63966128420c6eb18fd5d4c86492fecf93cc1f74`.
- [src/intelligence/cache.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intelligence/cache.ts) · blob `144a197da6d5e089085d89b1f6398a859a8dc9eb`.
- [src/intelligence/hook-log.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intelligence/hook-log.ts) · blob `1ae4e9792d52291ce936c4308772c9e637d44063`.
- [src/intelligence/token-tracker.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intelligence/token-tracker.ts) · blob `de1ce3938e3fab5a66f7de2b5673c238bd22cc17`.
- [src/intercept/component-status.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/component-status.ts) · blob `26cb80a836f7984f5474dd015dc36d38284d121a`.
- [src/intercept/context.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/context.ts) · blob `4bdfdd1a2d08f97c48ace2c411123f206561623e`.
- [src/intercept/cursor-adapter.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/cursor-adapter.ts) · blob `43c911527312658146b3715247a4bdd02ceb371b`.
- [src/intercept/dispatch.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/dispatch.ts) · blob `afed96b583c144f951a5b0709a344de2539681f0`.
- [src/intercept/formatter.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/formatter.ts) · blob `14ffa4a909e8a7832b8572872332b8a194677999`.
- [src/intercept/handlers/bash-postool.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/bash-postool.ts) · blob `5e7ea36ff04dac2a0b17b1eb99f45d9b956b79bf`.
- [src/intercept/handlers/bash.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/bash.ts) · blob `2ca13be9a61feecc2a562c1557d2df524797d791`.
- [src/intercept/handlers/cwd-changed.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/cwd-changed.ts) · blob `398ab4ae8d3e9b2387acee0e2d1dab173ee79abf`.
- [src/intercept/handlers/edit-write.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/edit-write.ts) · blob `6381ecdb59f2ce2117aac474e141f3832810dff4`.
- [src/intercept/handlers/grep.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/grep.ts) · blob `30f846851a47da180f24b6f64faf944741b0ca84`.
- [src/intercept/handlers/lsp-capture.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/lsp-capture.ts) · blob `5ca7a6de90e212649bc5ab6528cb45c23d4a2029`.
- [src/intercept/handlers/mistake-guard.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/mistake-guard.ts) · blob `b262f240ce54a1b511705c0115d9746aa6a765b2`.
- [src/intercept/handlers/post-tool.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/post-tool.ts) · blob `418294b3d7bebbf5af8240efe99aa67696f035ba`.
- [src/intercept/handlers/pre-compact.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/pre-compact.ts) · blob `458533f0bd05d8141c7e8ecae525114ac83553d2`.
- [src/intercept/handlers/read.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/read.ts) · blob `1b568a9a2960990fcda6ab146aac7c0b15f3fe07`.
- [src/intercept/handlers/session-start.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/session-start.ts) · blob `66a195b71a71ba7d10928639c69b83272dad43a2`.
- [src/intercept/handlers/stop.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/stop.ts) · blob `2a73aced8b62bbadefb66cdadf35219947fc15c0`.
- [src/intercept/handlers/subagent-start.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/subagent-start.ts) · blob `83cc74d356da876d0394b1d4b4ddecef76d7b4b6`.
- [src/intercept/handlers/user-prompt.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/handlers/user-prompt.ts) · blob `6107a14bf12f4469cfd3effab5965be90778a292`.
- [src/intercept/installer.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/installer.ts) · blob `3e43cf4efb44bb24d89eadfc71d785567716ea91`.
- [src/intercept/memory-md.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/memory-md.ts) · blob `2f54db18b607f8500f7de491fa02949e4838a4df`.
- [src/intercept/never-worse.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/never-worse.ts) · blob `570dddf44a5f8dbab9910746bfc96eb63bc3ef4b`.
- [src/intercept/safety.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/safety.ts) · blob `4492d67142de5b1c05fa5d36714afa8da97c6268`.
- [src/intercept/served-reads.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/served-reads.ts) · blob `c3c837b7aa7f99b221f7f3a718b52fcec8f3e091`.
- [src/intercept/stats.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/stats.ts) · blob `6170eabe6e96c3c3306f28fbe716edba236c8bed`.
- [src/mesh/audit.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/mesh/audit.ts) · blob `fe90434c65145777f4042e678f70e274ecee4129`.
- [src/mesh/identity.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/mesh/identity.ts) · blob `2a7e6c713c8a4d8706a12b68e24e4427d9c95b73`.
- [src/mesh/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/mesh/index.ts) · blob `91ef94a7fd524360f1f7f504c4ac2811d495999f`.
- [src/mesh/jcs.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/mesh/jcs.ts) · blob `4f2af7fb0f66fd839188d49000fe3bed330a57db`.
- [src/mesh/pii-gate.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/mesh/pii-gate.ts) · blob `4b46bfafd6ae098b2f0317a1c191172f100bf16d`.
- [src/mesh/types.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/mesh/types.ts) · blob `0a8b1b469b6539b32cdf46a2a4dc5514dcf1fc19`.
- [src/miners/ast-miner.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/miners/ast-miner.ts) · blob `485b8c36dbe9a996a8708c1c2886b6d011c66bfd`.
- [src/miners/git-bugfix-miner.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/miners/git-bugfix-miner.ts) · blob `3fa8ed6762204acb16af6096d21b65c93b39e92a`.
- [src/miners/git-miner.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/miners/git-miner.ts) · blob `0cfd6d4fdae8c819ba545167ad39ba8c05be281b`.
- [src/miners/git-revert-miner.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/miners/git-revert-miner.ts) · blob `0e5fce03fa956bd2d82d6c00b1524736172184a6`.
- [src/miners/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/miners/index.ts) · blob `5faf636c3fc817fc8f0720d6d97ee013fccd922f`.
- [src/miners/reference-miner.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/miners/reference-miner.ts) · blob `4d81cca9d46a024fde422830d62c67e499135bd0`.
- [src/miners/session-miner.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/miners/session-miner.ts) · blob `72b8fc26c72e8ab7bc469d18669c3c87f6c59271`.
- [src/miners/skills-miner.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/miners/skills-miner.ts) · blob `86d795a91e4432ed6dd4a3720ea367f8f08684c4`.
- [src/providers/anthropic-memory.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/anthropic-memory.ts) · blob `4b94d2167cb62a1c2b30ae69ab4232233f6f53ae`.
- [src/providers/ast.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/ast.ts) · blob `c130020975855bc34805609c3063560586fabcde`.
- [src/providers/context7.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/context7.ts) · blob `aee6c6831b5a8154776509998bcf954924d66f2c`.
- [src/providers/dedup.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/dedup.ts) · blob `e73574e3ec9893661776c1f5d190e94e61ce194d`.
- [src/providers/engram-git.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/engram-git.ts) · blob `a27bf4f5e34d4022e5477a921558b563159a2861`.
- [src/providers/engram-mistakes.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/engram-mistakes.ts) · blob `c1363c6c093a489795cc2e68853edfd57e3f41be`.
- [src/providers/engram-structure.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/engram-structure.ts) · blob `675e7b051ae5cabdd7537e59730226de7757580d`.
- [src/providers/grammar-loader.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/grammar-loader.ts) · blob `82f720e292b5a78f9caa830541c513161e61f072`.
- [src/providers/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/index.ts) · blob `d8b888815792dd7176e4516ff38d498e65a21ea8`.
- [src/providers/lsp-connection.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/lsp-connection.ts) · blob `85e1448dbdfc7079a6c776cac7f5fabcb90ccb28`.
- [src/providers/lsp.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/lsp.ts) · blob `50d50c95b7ced0c84fe3cbd211b81e726491a230`.
- [src/providers/mcp-client.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/mcp-client.ts) · blob `2c1c45c59c0967e03faaeafddce939d0011cd491`.
- [src/providers/mcp-config.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/mcp-config.ts) · blob `011712b59e81933e277142595e9958203667c57b`.
- [src/providers/mempalace.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/mempalace.ts) · blob `53dd71261bc2e4f34eb657805305f847f5940835`.
- [src/providers/obsidian.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/obsidian.ts) · blob `316aef3f3df18f8f3ce276ba5fd32d7658c0be75`.
- [src/providers/plugin-loader.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/plugin-loader.ts) · blob `08ec6aae0a379703a8a49a601a66d31c74f44b32`.
- [src/providers/ranking.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/ranking.ts) · blob `4c59d2c3b3b0c88720e85661e93e99589e27315c`.
- [src/providers/resolver.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/resolver.ts) · blob `f848e274e1d7edf10abd1d16331536881d95b09f`.
- [src/providers/types.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/types.ts) · blob `0847e760ad4d126297d9edecaac63793b1a20180`.
- [src/serve.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/serve.ts) · blob `7a3073b8859839282ee6fb396562ea64449f446e`.
- [src/server/auth.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/server/auth.ts) · blob `058d3ffae4b8bc71f03f1e50942d8372d3f2d419`.
- [src/server/http.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/server/http.ts) · blob `d029c7cab9c50b7a16060cb58f37208e9f2ed92f`.
- [src/server/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/server/index.ts) · blob `dd3830096cdc55cb90198abfd90cd08c3be5f147`.
- [src/server/ui-components.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/server/ui-components.ts) · blob `eb33c63290d6efef6fd6d9eba3997c6d0240f9ed`.
- [src/server/ui-graph.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/server/ui-graph.ts) · blob `250780ea74eb58363dd5fd3ab9f3d4a6694dd430`.
- [src/server/ui.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/server/ui.ts) · blob `959ec5805d999ec8cca40bc55e650300a379ad7e`.
- [src/setup/detect.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/setup/detect.ts) · blob `6329fee6576c1ad3fdae4dbebec71e7c4b230aa4`.
- [src/setup/wizard.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/setup/wizard.ts) · blob `4f51d097ff969454ea94a2ff273eda974ee147e4`.
- [src/tuner/config.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/tuner/config.ts) · blob `cc24831acc67df7d116d076da2808f6b014cc958`.
- [src/tuner/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/tuner/index.ts) · blob `8e2d1980df1a5cd8c7b20d288ee48b424236ab7a`.
- [src/types/sql.js.d.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/types/sql.js.d.ts) · blob `2ca157d2f1eba8922e7bb2c011bf5fa192324072`.
- [src/update/check.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/update/check.ts) · blob `e66bd5c479a1b418cbc881afe1ede78b55d7f492`.
- [src/update/install.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/update/install.ts) · blob `6f3840cd8f84f4bd29c57cec5b7391802b3bf38f`.
- [src/update/notify.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/update/notify.ts) · blob `409c5a0ee2be77e429d00e0e3e73a03cfa8da592`.
- [src/watcher.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/watcher.ts) · blob `60e674b26e34cec7defcd0e42dd2e7309b2bdc5d`.
- [bench/stress-test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/stress-test.ts) · blob `2d81ea72a6821b876dcc9ff95421530ff36298cd`.
- [tests/ast-miner.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/ast-miner.test.ts) · blob `04bdb3094a52d7cf1c7ef1d233e3a8757544bae9`.
- [tests/autogen.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/autogen.test.ts) · blob `51d462ad4031e474ec9e991b95f51e226fbbd7c0`.
- [tests/bench-stats.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/bench-stats.test.ts) · blob `d500b3acd818a577613b67475a8ff7854124773d`.
- [tests/cache.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/cache.test.ts) · blob `d7a5477f760d0e35d6d39d7bcb80336edd61024b`.
- [tests/ccs/ccs.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/ccs/ccs.test.ts) · blob `31a1f991d1fc569bde0a52db1983082f2401d954`.
- [tests/cli-guards.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/cli-guards.test.ts) · blob `ca75ebf957bd40f677272e136aa756cec59e5780`.
- [tests/commands/measure-session.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/commands/measure-session.test.ts) · blob `dba1c8be24e3b9e071594cde32f3896b79ecf72b`.
- [tests/commands/measure.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/commands/measure.test.ts) · blob `26fec3ef0a9608246a69d8fb2ddba3a61e02295a`.
- [tests/core-cochange.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/core-cochange.test.ts) · blob `112dff71a69f4eb8e49375088d089f9cd847935e`.
- [tests/core-packet-ratio.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/core-packet-ratio.test.ts) · blob `40fb37882023ae8a5a6d93d1676db1475d6104e1`.
- [tests/core.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/core.test.ts) · blob `1c40ea52c65d26da452b70c86cb52522dd67d271`.
- [tests/cost-instrument.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/cost-instrument.test.ts) · blob `5d18163b9e8c33f12fec3e5d83044e0728113dea`.
- [tests/cost.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/cost.test.ts) · blob `fac7735aba36806f55ad423bac539c4ab25db4f8`.
- [tests/db/migrate.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/db/migrate.test.ts) · blob `984065bcbde606dd3f94062be88abef91cef16ea`.
- [tests/db/rollback.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/db/rollback.test.ts) · blob `0280da5ff5c2e1fcaaf356b9f3d9fc5648df17f8`.
- [tests/doctor/report.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/doctor/report.test.ts) · blob `1eed6939aa31e90a79a4cdfe6d8c78f360de250a`.
- [tests/fixtures/hook-payloads/pretooluse-edit.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/hook-payloads/pretooluse-edit.json) · blob `a88dda1f91ef5b678e8965a51e6df47a63fc6acc`.
- [tests/fixtures/hook-payloads/pretooluse-read.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/hook-payloads/pretooluse-read.json) · blob `15ddff9789533c274e62eb2b94d6c50d5a880c85`.
- [tests/fixtures/hook-payloads/session-start.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/hook-payloads/session-start.json) · blob `dabfa7d402daea5311440a9576f3a5286cc51d3e`.
- [tests/fixtures/hook-payloads/user-prompt-submit.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/hook-payloads/user-prompt-submit.json) · blob `5b2f390cd4fdb4113de1cfce741dab0dade9faf9`.
- [tests/fixtures/pii-zoo.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/pii-zoo.json) · blob `ca918e9eab6d430918f291cff1dd4db957f47b7c`.
- [tests/fixtures/sample.py](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/sample.py) · blob `db699bf272158db05a34db87e3d8307cf24cd800`.
- [tests/fixtures/sample.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/fixtures/sample.ts) · blob `78d329754fb4018f4ddd64ff3763f15063757a54`.
- [tests/generators/cursor-mdc.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/generators/cursor-mdc.test.ts) · blob `8c601fb21492e16dee3a073641b23d68001adab5`.
- [tests/generators/windsurf-rules.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/generators/windsurf-rules.test.ts) · blob `cad91aa32852817d4f4b6597ced0e491eca894e4`.
- [tests/graph-reach.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/graph-reach.test.ts) · blob `45c4a74b65cc37e4c52c93b0fa0cadf375cab43d`.
- [tests/graph-related-files.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/graph-related-files.test.ts) · blob `8794b2c6b900eb8b41d71e55d9c0858cc4955e23`.
- [tests/graph/pagerank.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/graph/pagerank.test.ts) · blob `530e06347be699e6d4b5d68f64554aa94fec7ce3`.
- [tests/graph/traversal.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/graph/traversal.test.ts) · blob `0bc5d34c829ce759332576a297e6c378ae0f38fd`.
- [tests/honesty-claims.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/honesty-claims.test.ts) · blob `29f6249a885cd93eba9a820373374e00051ba3d9`.
- [tests/incremental-references.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/incremental-references.test.ts) · blob `f07024dfa17b3454b8ac822d95e72412f0f00692`.
- [tests/incremental.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/incremental.test.ts) · blob `08988763bba4764bf20d17d7c0779e33fbba2326`.
- [tests/intercept/cli-intercept.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/cli-intercept.test.ts) · blob `3ed38cdb9341474b4f3e2273f4d5f8f0dacae849`.
- [tests/intercept/component-status-11.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/component-status-11.test.ts) · blob `3895c5a7cffde9b3577c17411386d6f763b1ba88`.
- [tests/intercept/context.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/context.test.ts) · blob `c688b541029cb4faa8c86c26fed70ad34d7696dc`.
- [tests/intercept/cursor-adapter.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/cursor-adapter.test.ts) · blob `d494eb665a1bdb96194116bf5170adcbe19322c9`.
- [tests/intercept/dispatch-new-events.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/dispatch-new-events.test.ts) · blob `55e9f6c260425088ddf46bedc92ed8374ab23658`.
- [tests/intercept/dispatch.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/dispatch.test.ts) · blob `5de409fb1acb370c8bb707257da7bad48d805ca5`.
- [tests/intercept/formatter.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/formatter.test.ts) · blob `2f3d7d94371f6fba8923f0b5ba6c810e2cf46345`.
- [tests/intercept/get-file-context.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/get-file-context.test.ts) · blob `5ab0dfdf909ea1977e0110228800f92712e85325`.
- [tests/intercept/handlers/bash-postool.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/handlers/bash-postool.test.ts) · blob `f5403c392fab7e34e13d8f201c68139a3d92f1e8`.
- [tests/intercept/handlers/bash.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/handlers/bash.test.ts) · blob `7cd04bd3aad9ffb9d599ef4ac7b81bf6407fa463`.
- [tests/intercept/handlers/cwd-changed.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/handlers/cwd-changed.test.ts) · blob `af5132edbf23e81395792a8cfcd82aa35fa7b728`.
- [tests/intercept/handlers/edit-write.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/handlers/edit-write.test.ts) · blob `05991ceffb37ab11623f6f219ff0afa85dd3443a`.
- [tests/intercept/handlers/grep.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/handlers/grep.test.ts) · blob `6cd8bbae26d90dd12fe8fa023b29ae954e75e2c8`.
- [tests/intercept/handlers/mistake-guard.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/handlers/mistake-guard.test.ts) · blob `7f50cf69a4f45cb15e31f6b408d742e2e77a67e1`.
- [tests/intercept/handlers/post-tool.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/handlers/post-tool.test.ts) · blob `1438d0287672dbc006fd7913ab6b4e5483d16280`.
- [tests/intercept/handlers/pre-compact.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/handlers/pre-compact.test.ts) · blob `2b2c0232df66f6eaea2ac0fb0db8bc9c2cf06c7b`.
- [tests/intercept/handlers/read.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/handlers/read.test.ts) · blob `c3371d45d32dd82a7b1e9e6d6811b3850253fe1d`.
- [tests/intercept/handlers/session-start.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/handlers/session-start.test.ts) · blob `b997407b0d2a8a945ee811179f10589d62002e18`.
- [tests/intercept/handlers/subagent-start.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/handlers/subagent-start.test.ts) · blob `5541f42b08c2ccd3510f6de07a426e7ef40674e3`.
- [tests/intercept/handlers/user-prompt.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/handlers/user-prompt.test.ts) · blob `913945608cfe306278ebff56280ee947a25a4108`.
- [tests/intercept/hook-log.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/hook-log.test.ts) · blob `a981701915bd298ad99d68b54109ccc783bc43e3`.
- [tests/intercept/installer-missing-events.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/installer-missing-events.test.ts) · blob `1f9ebca475ad69fad530f7e1e042f604884cfede`.
- [tests/intercept/installer.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/installer.test.ts) · blob `32b73cb73c1bd8d0d09f7ff39a6a7a5d32653401`.
- [tests/intercept/memory-md.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/memory-md.test.ts) · blob `c6fdea713de8e02fc937d29b66664e35d9bcc914`.
- [tests/intercept/mistake-guard-invocation.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/mistake-guard-invocation.test.ts) · blob `5fc5b12ae35356a8a29a4d0fd09987f04a9775b9`.
- [tests/intercept/mistakes-filter.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/mistakes-filter.test.ts) · blob `3b4ce7618a8d0eae6262be1c5f2b7c1eca6f85b5`.
- [tests/intercept/never-worse.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/never-worse.test.ts) · blob `a528a66f3f815a15e147ec044f1c50ba3f2a639c`.
- [tests/intercept/render-file-structure.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/render-file-structure.test.ts) · blob `75de01ba0aa6ba57ef49105dd11367a3636aef15`.
- [tests/intercept/safety.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/safety.test.ts) · blob `74b95872b9c897600f211d6a460b4889f2fa54ed`.
- [tests/intercept/served-reads.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/served-reads.test.ts) · blob `9d6c10b98b6d494b69537d3b4d5e1ee8c9221a64`.
- [tests/intercept/spike-regression.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/spike-regression.test.ts) · blob `fb0a662b689eb0d4643fb37d6ecf0eee880e0440`.
- [tests/intercept/stats.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/stats.test.ts) · blob `f47b5db29995f1ecff806b35eb6fdae4b39bb65b`.
- [tests/intercept/stop.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/intercept/stop.test.ts) · blob `65369e173b6be9f132ce5f61827321290f21f473`.
- [tests/mesh/audit.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/mesh/audit.test.ts) · blob `aa80a400051c68d5d4280aa828834c12fe98c948`.
- [tests/mesh/identity.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/mesh/identity.test.ts) · blob `5b8081ce041240ff96d6734342d295134c97cd28`.
- [tests/mesh/jcs.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/mesh/jcs.test.ts) · blob `a1534e9967e40cdce80be0c2ca24509cf938ab76`.
- [tests/mesh/pii-gate.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/mesh/pii-gate.test.ts) · blob `4abf9e4c0442a58fc5abadcff9f3dc0c80787b46`.
- [tests/mesh/types.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/mesh/types.test.ts) · blob `5a7bfddea4d905330ff2e589b1f4552624faa33c`.
- [tests/miners/git-bugfix-miner.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/miners/git-bugfix-miner.test.ts) · blob `224690e7eb47bc1db796af2e6992a769f8f5ade2`.
- [tests/miners/git-miner.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/miners/git-miner.test.ts) · blob `e87bc2ac3607f1a1e767c36d1ee004ef307e9eaa`.
- [tests/miners/git-revert-miner.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/miners/git-revert-miner.test.ts) · blob `41b071deb131c4ea1a130a8d35be439261582b25`.
- [tests/miners/reference-miner.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/miners/reference-miner.test.ts) · blob `6b3264816a97545904c887435fde91e55f8e6804`.
- [tests/mistake-memory.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/mistake-memory.test.ts) · blob `f27519fee172f84ce399a6e0799b9b56e24a9640`.
- [tests/provider-cache.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/provider-cache.test.ts) · blob `bed5042fd54eae7a4b0dd5628d4fe760e706e665`.
- [tests/providers/anthropic-memory.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/providers/anthropic-memory.test.ts) · blob `f0e4ce3ae76b753464adb2933b36791a375d457a`.
- [tests/providers/ast.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/providers/ast.test.ts) · blob `1933b1b6ba1b7b95bce60ab2a63ebcfd32d3bada`.
- [tests/providers/dedup.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/providers/dedup.test.ts) · blob `aafe07df72eb618a511df6e654633d73e7f4f8f9`.
- [tests/providers/engram-mistakes.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/providers/engram-mistakes.test.ts) · blob `4b6dac3d213f8f57e556b8a93788ee8c26be8124`.
- [tests/providers/lsp.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/providers/lsp.test.ts) · blob `6a6d30a359decc2482dd96eb3c41d81fb73bd00e`.
- [tests/providers/mcp-config.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/providers/mcp-config.test.ts) · blob `837bf121bae60aecda7186610408f802bfb93113`.
- [tests/providers/plugin-loader.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/providers/plugin-loader.test.ts) · blob `0e3cf6b2f9f1df2b7180fa2e49177729b857af82`.
- [tests/providers/ranking.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/providers/ranking.test.ts) · blob `1438f144da49a5d03623570b2a50471d5914f564`.
- [tests/providers/resolver.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/providers/resolver.test.ts) · blob `0fd469622c665f9306259398349ccf5869463cfb`.
- [tests/refs-cache-equivalence.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/refs-cache-equivalence.test.ts) · blob `876d0b93c0e43b381b0a5e339eb0871143fec28b`.
- [tests/render-utils.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/render-utils.test.ts) · blob `fdaff8ef0e01e149318183ffcc46e032c12acac7`.
- [tests/server/api-endpoints.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/server/api-endpoints.test.ts) · blob `9cfac7893bcf2a4ce7329f6a90e7a1bc611ab5ee`.
- [tests/server/http.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/server/http.test.ts) · blob `cbe9e12e79f76687a7aea587cd5677d4ff899c28`.
- [tests/server/security.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/server/security.test.ts) · blob `7656d0ba0d2aeb1a9c511f6f93009a8ab59ed0db`.
- [tests/setup/detect.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/setup/detect.test.ts) · blob `98ab01b8455eb7e537753d0b3a405e6632c334f8`.
- [tests/skills-miner.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/skills-miner.test.ts) · blob `5c6489d4926ec8db4482649252fd1ecd543e4c29`.
- [tests/store.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/store.test.ts) · blob `f8962eb93b5d1c4ca35985776553889610cf87ba`.
- [tests/stress.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/stress.test.ts) · blob `63aff3707bfe418506d432f007b10e9b9ed23338`.
- [tests/tuner/tuner.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/tuner/tuner.test.ts) · blob `3aaa8824450be159f5c0f5e34b7b7c4aabfa64b4`.
- [tests/update/check.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/update/check.test.ts) · blob `bd4132a314e76c2485c11bf27b6ba8632ce347da`.
- [tests/update/install.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/update/install.test.ts) · blob `09e907d8bb60a4d3a4584e7a76ecab7fe011297d`.
- [tests/update/notify.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/update/notify.test.ts) · blob `3330b14d7e1f6bc0ecb0db934db8d4c653c09d9b`.
- [tests/watcher.test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/tests/watcher.test.ts) · blob `fc39ba4e5cb633907b0c11057412d3f67eeb1fa2`.

## Additional authored documents

- `docs/PORTFOLIO-GUIDE.md` — current source-backed guide/entrypoint.

## Tree files outside the captured text set

These paths were mapped but their contents were not acquired in this research pass:

- `.cursorrules`
- `.gitignore`
- `adapters/continue/.npmignore`
- `adapters/continue/package-lock.json`
- `assets/banner-v3.png`
- `assets/banner.png`
- `assets/screenshots/01-overview.png`
- `assets/screenshots/02-sessions.png`
- `assets/screenshots/03-activity.png`
- `assets/screenshots/04-files.png`
- `assets/screenshots/05-graph.png`
- `assets/screenshots/06-providers.png`
- `bench/results/TEMPLATE.csv`
- `docs/demos/before-after.cast`
- `docs/demos/captions.vtt`
- `docs/demos/chapters.vtt`
- `docs/demos/poster.svg`
- `docs/demos/v4-skill-pack.cast`
- `docs/engram-sentinel-ecosystem.pdf`
- `extensions/vscode/.gitignore`
- `extensions/vscode/.vscodeignore`
- `extensions/vscode/assets/icon.png`
- `package-lock.json`
- `scripts/mcp-engram`

## Additional integration review

The active installation, integration, editor, provider, benchmark, demonstration and comparison guides were rewritten. The Continue adapter's HTTP fallback omits authentication; the VS Code dashboard command invokes `dashboard` while the engine declares `ui`. The benchmark runner derives comparisons from fixture `expected_tokens`. These are source findings, not executed failures. See the rewritten guides for pinned implementation citations. Historical media scene copy remains explicitly deferred pending a coordinated asset revision.

## Expanded HTML review

The acquisition now includes 332 of 332 eligible text files. Six HTML documentation/media pages were inspected; the seventh HTML file, `assets/banner.html`, is a decorative banner source retained without a runtime/UI change. Four active guides are mapped to rewritten Markdown for the root renderer; generation and visual verification are separate delivery steps.

| Existing HTML | Disposition | Markdown authority |
| --- | --- | --- |
| [docs/install.html](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/install.html) | Replace active guide through branded HTML rendering | `llms-install.md` |
| [docs/engram-user-manual.html](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/engram-user-manual.html) | Replace active guide through branded HTML rendering | `docs/USER-MANUAL.md` |
| [docs/engram-integration-guide.html](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/engram-integration-guide.html) | Replace active guide through branded HTML rendering | `docs/INTEGRATION.md` |
| [docs/engram-sentinel-ecosystem.html](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/engram-sentinel-ecosystem.html) | Replace active guide through branded HTML rendering | `docs/SENTINEL.md` |
| `docs/demos/hf/index.html` | Historical v2.0.2 animated scene composition; preserve with scene-table/captions pending coordinated media revision. Quantitative claims are not validated. | `docs/demos/README.md` records historical status |
| `docs/demos/showcase.html` | Historical v2.0.2 player/storyboard and render source; preserve with captions/video pending coordinated media revision. Quantitative claims are not validated. | `docs/demos/README.md` records historical status |

Additional knowledge retained: skills indexing, generated-instruction targets, MEMORY.md synchronization, Git hook behavior/limitations, troubleshooting, scoped uninstall, supported library exports, hook coexistence, current lifecycle events, read gates and guard defaults. Old `getStore`/`getFileContext` package-root imports, `gen --memory-md`, fixed savings figures and universal no-network claims were not carried forward.

The Git-hook template calls `init --quiet`, which is absent from the inspected parser, and its fallback global package path uses `engram` rather than `engramx`. The mistake-guard implementation defaults to permissive, contrary to stale comments; `0` disables it and `2` selects strict mode. These findings are static, not executed failures.

### Newly captured HTML evidence

- [assets/banner.html](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/assets/banner.html) · blob `52cd0a50324e2ed17855ac9ab25ebf3a9f6689f4`.
- [docs/demos/hf/index.html](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/demos/hf/index.html) · blob `314bce071f1d22d748b0dacfa3ba908d0e9a957f`.
- [docs/demos/showcase.html](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/demos/showcase.html) · blob `e61ac5fc8ab1634737280287423f3a26a0a7fc48`.
- [docs/engram-integration-guide.html](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/engram-integration-guide.html) · blob `0a3a1a40749271d33c25bbda23c8b45141edeccd`.
- [docs/engram-sentinel-ecosystem.html](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/engram-sentinel-ecosystem.html) · blob `ef01944b8d25680b109a122c259c16328c21b794`.
- [docs/engram-user-manual.html](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/engram-user-manual.html) · blob `c0676f3dfd1ee74c63bdb74815079ace9c0c0109`.
- [docs/install.html](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/install.html) · blob `2149acb0bbb123067ca5e0893872c224b3d59ccb`.
