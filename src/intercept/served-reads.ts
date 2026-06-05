/**
 * Same-session read dedup store (ADR-0003).
 *
 * Records which files an agent has already read in a session so a repeat read
 * of an UNCHANGED, non-trivial file (within the same compaction epoch) can be
 * answered with a tiny pointer instead of re-serving the packet / re-reading
 * the raw file. State lives at `<projectRoot>/.engram/served-reads-<session>.json`
 * (gitignored; relative paths only, no absolute/home paths). The set is cleared
 * on PreCompact (`clearServedReads`) so dedup never points at content that
 * context compaction evicted.
 *
 * Every function is best-effort and NEVER throws — a dedup-store failure must
 * never break a Read. On any error we simply don't dedup.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  mkdirSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join, relative } from "node:path";

/** Below this, re-reading the raw file is cheaper than the dedup pointer + the
 *  "scroll up" friction — so we don't dedup tiny files. ~100 tokens. */
const DEDUP_MIN_BYTES = 400;

/** Served-read sets from sessions older than this are pruned (best-effort). */
const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * A recorded read is only dedup-eligible for this long. Recall-safety backstop
 * for the case where context content is evicted WITHOUT a PreCompact/SessionStart
 * reset firing (silent overflow, micro-compaction): an old recorded read is more
 * likely to have left the window. Expiry causes a re-serve (a false negative —
 * the safe direction), never a false "you already have this".
 */
const DEDUP_TTL_MS = 30 * 60 * 1000;

/**
 * Cap on entries per session set. Bounds the blast radius of volume-based
 * eviction (a very long, read-heavy session that overflows the window before any
 * compaction event) to the most-recently-read files — the ones genuinely still
 * in context — and keeps the on-disk set small. Oldest entries are evicted.
 */
const MAX_ENTRIES = 256;

/** Sanitise the session id into a safe filename fragment (no path traversal). */
function safeSession(sessionId: string): string | null {
  const s = sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return s.length > 0 ? s : null;
}

function storePath(projectRoot: string, session: string): string {
  return join(projectRoot, ".engram", `served-reads-${session}.json`);
}

type ServedMap = Record<string, { mtimeMs: number; size: number; at: number }>;

function load(path: string): ServedMap {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as ServedMap) : {};
  } catch {
    return {};
  }
}

/** Evict the oldest entries (by `at`) so a session set never exceeds the cap. */
function capEntries(map: ServedMap): void {
  const keys = Object.keys(map);
  if (keys.length <= MAX_ENTRIES) return;
  keys
    .sort((a, b) => map[a].at - map[b].at)
    .slice(0, keys.length - MAX_ENTRIES)
    .forEach((k) => delete map[k]);
}

/** Best-effort prune of served-read sets left behind by old sessions. */
function pruneStale(dir: string): void {
  try {
    const now = Date.now();
    for (const name of readdirSync(dir)) {
      if (!name.startsWith("served-reads-") || !name.endsWith(".json")) continue;
      const p = join(dir, name);
      try {
        if (now - statSync(p).mtimeMs > STALE_MS) rmSync(p, { force: true });
      } catch {
        /* ignore one bad file */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * The relative paths this session has read, most-recent first (by `at`), capped
 * to `limit`. Used by the PreCompact ledger (#84) to remind the post-compaction
 * agent what it already explored — MUST be read BEFORE `clearServedReads` wipes
 * the set. Never throws; empty on any error or unknown session.
 */
export function exploredFiles(
  projectRoot: string,
  sessionId: string,
  limit: number
): string[] {
  const session = safeSession(sessionId);
  if (!session) return [];
  const map = load(storePath(projectRoot, session));
  return Object.keys(map)
    .sort((a, b) => map[b].at - map[a].at)
    .slice(0, Math.max(0, limit));
}

/**
 * Record a full read; return `true` iff this is a repeat read of an unchanged,
 * non-trivial file already seen this session (the caller should dedup). On a
 * first read (or a changed/tiny file) it records and returns `false`.
 */
export function dedupOrRecord(
  projectRoot: string,
  sessionId: string,
  absPath: string
): boolean {
  try {
    const session = safeSession(sessionId);
    if (!session) return false;

    let st: { mtimeMs: number; size: number };
    try {
      const s = statSync(absPath);
      st = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return false; // can't verify the file → never dedup
    }

    const now = Date.now();
    const key = relative(projectRoot, absPath).split(/[\\/]/).join("/");
    const path = storePath(projectRoot, session);
    const firstOfSession = !existsSync(path);
    const map = load(path);
    const prev = map[key];

    if (
      prev &&
      prev.mtimeMs === st.mtimeMs &&
      prev.size === st.size &&
      st.size >= DEDUP_MIN_BYTES &&
      now - prev.at < DEDUP_TTL_MS // recall-safety: stale records re-serve
    ) {
      return true; // unchanged, recent repeat of a non-trivial file → dedup
    }

    // First read (or changed, or tiny, or stale): record and continue. `at` is
    // set here, on a record — never on a dedup hit (which returns above without
    // touching it) — so dedup-eligibility ages from when this version of the
    // content last entered context, not from the last pointer.
    map[key] = { mtimeMs: st.mtimeMs, size: st.size, at: now };
    capEntries(map);
    try {
      const engramDir = join(projectRoot, ".engram");
      if (!existsSync(engramDir)) mkdirSync(engramDir, { recursive: true });
      writeFileSync(path, JSON.stringify(map));
      if (firstOfSession) pruneStale(engramDir);
    } catch {
      /* recording is best-effort; failure just means no dedup next time */
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Clear a session's served-read set — called on PreCompact, the eviction
 * boundary, so a post-compaction re-read always re-serves the content.
 */
export function clearServedReads(projectRoot: string, sessionId: string): void {
  try {
    const session = safeSession(sessionId);
    if (!session) return;
    rmSync(storePath(projectRoot, session), { force: true });
  } catch {
    /* ignore */
  }
}
