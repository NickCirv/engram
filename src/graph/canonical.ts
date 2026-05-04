import { createHash } from "node:crypto";

// Deterministic canonical id generation for nodes.
// Inputs: label, kind, memoryScope, projectRoot (optional). We normalize
// the label (NFKC, collapse whitespace, remove punctuation) and hash a
// versioned namespace so we can change algorithm later.

function normalizeLabel(s: string): string {
  if (!s) return "";
  try {
    // Unicode normalization to NFKC
    let t = s.normalize("NFKC");
    // Replace non-letter/number/space with nothing (remove punctuation)
    t = t.replace(/[^\p{L}\p{N}\s]/gu, " ");
    // Collapse whitespace and trim
    t = t.replace(/\s+/g, " ").trim();
    return t.toLowerCase();
  } catch {
    return s.replace(/\s+/g, " ").trim().toLowerCase();
  }
}

export function computeCanonicalId(
  label: string,
  kind: string | undefined,
  memoryScope: string | undefined,
  projectRoot?: string | null
): string {
  const version = "v1"; // bump on algorithm changes
  const norm = normalizeLabel(label || "");
  const scope = memoryScope || "project";
  const kindPart = kind || "";
  const rootPart = projectRoot ? String(projectRoot) : "";
  const base = `${version}|${scope}|${kindPart}|${norm}|${rootPart}`;
  const hash = createHash("sha256").update(base).digest("hex").slice(0, 24);
  return `c_${hash}`;
}
