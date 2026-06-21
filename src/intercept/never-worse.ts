/**
 * never-worse.ts — the structural guarantee that an intercepted Read NEVER
 * injects more tokens than the raw file it replaces.
 *
 * read.ts already proves the graph SUMMARY is smaller than the file before
 * intercepting. But it then enriches the summary with provider sections
 * (mistakes, git, mempalace, …) and emits `summary + enrichment`. That combined
 * packet can exceed the raw file even though the summary alone did not — which
 * would make the Read a net COST, not a saving. This module is the gate that
 * keeps the promise honest: if the enriched packet isn't strictly smaller than
 * the file, the caller drops the enrichment and serves the graph-only summary
 * (already proven < file). Pure + dependency-free so it's unit-testable.
 *
 * Honest framing (W1.9): this is a STRUCTURAL never-worse guarantee on the
 * injected packet — not a dollar/bill claim.
 */

/** Rough token estimate — ~4 chars per token (matches read.ts / resolver.ts). */
export function estimatePacketTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * True iff `packetText` is STRICTLY smaller than the raw file it would replace.
 * Equal-or-larger ⇒ false (serve the lighter fallback / passthrough instead).
 * `fileTokens` is the caller's already-computed raw-file token estimate.
 */
export function packetBeatsRawFile(packetText: string, fileTokens: number): boolean {
  if (!Number.isFinite(fileTokens) || fileTokens <= 0) return false;
  return estimatePacketTokens(packetText) < fileTokens;
}
