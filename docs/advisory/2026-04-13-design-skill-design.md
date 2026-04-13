# Design Skill — Spec
**Date:** 2026-04-13
**Status:** Approved → Building
**Replaces:** frontend-design, ui-ux-pro-max, motion-designer, canvas-design, theme-factory, brand-guidelines, web-artifacts-builder, algorithmic-art, tailwind-css-patterns, remotion-best-practices (10 skills → 1)

---

## Problem Statement

11 design skills existed in the ecosystem with four systemic failures:
1. **Duplication** — frontend-design existed twice (local + official plugin cache)
2. **Contradiction** — tailwind-css-patterns used Inter + blue/indigo defaults; frontend-design explicitly banned both
3. **External dependency rot** — 5 skills degraded to zero without supporting files (search.py, themes/, canvas-fonts/, templates/, shell scripts)
4. **Philosophy gap** — skills covered aesthetics but collectively skipped accessibility, behavioral states, systems thinking, and information hierarchy — the foundations that the reference design systems (IBM Carbon, Shopify Polaris, GitHub Primer) treat as non-negotiable

## Reference Quality Bar

Three repositories defined the target standard:
- **Awesome-AI-Design-Tools** (OrrisTech) — used as a counter-example; showed what generic AI design looks like
- **Awesome-UX** (batoreh) — established that usability, research, mental models, and accessibility precede aesthetics
- **Awesome-Styleguides** (streamich) — established that production design systems (Carbon, Polaris, Primer, Pajamas, Gestalt) encode behavior, state, accessibility, and semantic meaning — not just visual style

## Seven Principles Derived from Reference Analysis

1. **Usability is the foundation; aesthetics is the finish coat** — start with what the user needs to accomplish, not how it should look
2. **Systems over artifacts** — every design decision should be expressible as a rule that generalizes
3. **Accessibility is a correctness criterion** — not a quality layer added at the end
4. **Behavior and state are part of the design** — every interactive element has a behavioral contract
5. **Typography and information hierarchy are load-bearing** — hierarchy must hold independently of color
6. **Research and patterns precede invention** — earn novelty by knowing established patterns deeply enough to know when to deviate
7. **Craft is in the details users feel but cannot name** — optical alignment, icon weight, spacing rhythm, negative space as element

## Architecture Decision

**Chosen approach:** System-First, Audit-Enforced

Every invocation starts by building or loading a design system. The audit phase produces the system as its artifact. Execution is always an expression of the system, never a standalone decision.

Three alternatives were considered:
- Two-Phase Manifesto: clean separation but adds friction for simple requests
- Constraint Stack: fast but doesn't prevent cross-artifact inconsistency
- **System-First, Audit-Enforced (chosen):** solves both the generic-AI problem and the consistency problem simultaneously; the lightweight-system shortcut handles quick requests

## Anti-Generic Mechanism

**Primary:** Audit-before-output — mandatory Design Brief (5 questions) before any output

The five questions force:
1. Aesthetic Position — named, defensible, not "modern" or "clean"
2. Reference Anchors — 2 real production systems cited by name
3. Forbidden List — minimum 3 explicit constraints ruling out generic defaults
4. Functional Intent — what the viewer needs to accomplish
5. Accessibility Contract — WCAG level + audience stated, not assumed

## Skill Location

`/Users/nicashka/Desktop/AI_New/.claude/skills/design/SKILL.md`

## Output Formats Covered

Web/UI, PPTX, PDF, Canvas/Art, Motion — all reading from the same design system
