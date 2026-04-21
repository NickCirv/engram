/**
 * Version check against the npm registry.
 *
 * Zero telemetry: the ONLY network call is an anonymous GET to
 * `https://registry.npmjs.org/engramx/latest`. Nothing about the user's
 * install is sent — no machine ID, no repo info, no install count.
 *
 * Throttled: results cached at `~/.engram/last-update-check` for 7 days
 * so passive-notify does not hammer the registry on every CLI invocation.
 *
 * Opt-out: respects ENGRAM_NO_UPDATE_CHECK=1 and $CI — both cause
 * checkForUpdate() to resolve to { skipped: true } without touching
 * the network.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const REGISTRY_URL = "https://registry.npmjs.org/engramx/latest";
const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FETCH_TIMEOUT_MS = 1500;

export interface UpdateCheckResult {
  readonly skipped: boolean;
  readonly current: string;
  readonly latest: string | null;
  readonly updateAvailable: boolean;
  readonly checkedAt: number | null;
  readonly fromCache: boolean;
}

interface CachedCheck {
  readonly latest: string;
  readonly checkedAt: number;
}

export function cachePath(): string {
  return join(homedir(), ".engram", "last-update-check");
}

function readCache(): CachedCheck | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as CachedCheck;
    if (
      typeof parsed?.latest === "string" &&
      typeof parsed?.checkedAt === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCache(entry: CachedCheck): void {
  try {
    const path = cachePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(entry), "utf-8");
  } catch {
    /* ignore */
  }
}

/** True iff `a` is strictly greater than `b` by strict semver comparison. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim());
    if (!m) return null;
    return {
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      pre: m[4] ?? null,
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return false;
  if (pa.major !== pb.major) return pa.major > pb.major;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch;
  // No-pre > has-pre. Keeps 2.1.0 > 2.1.0-beta.1.
  if (pa.pre === null && pb.pre !== null) return true;
  if (pa.pre !== null && pb.pre === null) return false;
  if (pa.pre === null && pb.pre === null) return false;
  return (pa.pre ?? "") > (pb.pre ?? "");
}

export function optedOut(): boolean {
  if (process.env.ENGRAM_NO_UPDATE_CHECK === "1") return true;
  if (process.env.CI) return true;
  return false;
}

async function fetchLatestFromRegistry(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    if (typeof body?.version !== "string") return null;
    return body.version;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkForUpdate(
  currentVersion: string,
  opts: { force?: boolean } = {}
): Promise<UpdateCheckResult> {
  const base: UpdateCheckResult = {
    skipped: false,
    current: currentVersion,
    latest: null,
    updateAvailable: false,
    checkedAt: null,
    fromCache: false,
  };

  if (!opts.force && optedOut()) {
    return { ...base, skipped: true };
  }

  if (!opts.force) {
    const cached = readCache();
    if (cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) {
      return {
        ...base,
        latest: cached.latest,
        updateAvailable: isNewer(cached.latest, currentVersion),
        checkedAt: cached.checkedAt,
        fromCache: true,
      };
    }
  }

  const latest = await fetchLatestFromRegistry();
  if (!latest) {
    return { ...base, skipped: !opts.force };
  }

  const now = Date.now();
  writeCache({ latest, checkedAt: now });

  return {
    ...base,
    latest,
    updateAvailable: isNewer(latest, currentVersion),
    checkedAt: now,
    fromCache: false,
  };
}
