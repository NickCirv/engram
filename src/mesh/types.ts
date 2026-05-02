/**
 * v4.0 Mesh — shared types for the federation protocol.
 *
 * Wire format: JSON over WebSocket per RFC-0001. One envelope per WS frame.
 * All envelopes are signed with ed25519 over a JCS-canonical serialization
 * of the envelope minus the `sig` field. Replay protection via ULID + 24h
 * cache + ±5min clock window.
 *
 * Local-first stays the default. Federation is opt-in only — the wire types
 * here are inert until `engram mesh init` runs.
 *
 * RFC-0001: ~/Desktop/Projects/Engram/02-architecture/rfcs/RFC-0001-mesh-wire-format.md
 */

/** Current protocol version on the wire. Bump only on breaking changes. */
export const MESH_PROTOCOL_VERSION = 1;

/** Maximum size of a single mesh envelope. Larger payloads must chunk. */
export const MESH_MAX_ENVELOPE_BYTES = 64 * 1024;

/** Replay-window tolerance — envelopes more than this far from local clock are rejected. */
export const MESH_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

/** ULID cache TTL — duplicate IDs from the same peer within this window are rejected. */
export const MESH_REPLAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Identity fingerprint — base64url-encoded SHA-256 of the ed25519 public key.
 * Stable across sessions, serves as the peer's persistent identifier.
 */
export type PeerFingerprint = string;

/**
 * Message type. New types must be added here AND to the discriminated union
 * below. Receivers reject unknown types with `peer.audit.unknown_type`.
 */
export type MessageType =
  | "peer.hello"
  | "peer.audit"
  | "mistake.shared"
  | "pattern.shared"
  | "decision.shared";

/**
 * Wire envelope. Required fields are signed. The `sig` field is computed
 * over the JCS-canonical serialization of the envelope with `sig` removed.
 */
export interface Envelope<P = unknown> {
  /** Protocol version. Currently 1. */
  readonly v: number;
  /** ULID. Used for replay protection and audit correlation. */
  readonly id: string;
  /** RFC3339 UTC timestamp. */
  readonly ts: string;
  /** Sender's ed25519 fingerprint. */
  readonly from: PeerFingerprint;
  /** Message type discriminator. */
  readonly type: MessageType;
  /** Type-specific payload. Must be JSON-serializable. */
  readonly payload: P;
  /** Base64 ed25519 signature over JCS-canonical envelope minus this field. */
  readonly sig: string;
}

/** Capabilities a peer advertises during handshake. */
export interface PeerCapabilities {
  /** Supported message types. */
  readonly accepts: readonly MessageType[];
  /** Engram version on this peer. */
  readonly engramVersion: string;
  /** Max envelope bytes this peer accepts. */
  readonly maxBytes: number;
}

/** Payload for `peer.hello`. */
export interface PeerHelloPayload {
  readonly capabilities: PeerCapabilities;
  /** Display name (project, team, anything). PII-stripped. */
  readonly displayName?: string;
}

/** Payload for `peer.audit`. */
export interface PeerAuditPayload {
  /** Last known good envelope ID from the other side. */
  readonly lastSeen?: string;
  /** Optional health signal. */
  readonly health?: "ok" | "degraded" | "rejecting";
}

/** Payload for `mistake.shared` — a regret pattern broadcast to peers. */
export interface MistakeSharedPayload {
  /** Stable hash of the original mistake (so duplicates dedupe). */
  readonly fingerprint: string;
  /** Short, PII-stripped description. */
  readonly description: string;
  /** Optional category (e.g., "race-condition", "auth-bypass"). */
  readonly category?: string;
  /** Confidence in the pattern, 0..1. */
  readonly confidence: number;
  /** Bi-temporal: when this mistake was first observed. */
  readonly observedAt: string;
  /** Bi-temporal: when this mistake stops being valid (commit fixed it). */
  readonly validUntil?: string;
}

/** Payload for `decision.shared` — a captured ADR broadcast to peers. */
export interface DecisionSharedPayload {
  readonly fingerprint: string;
  readonly title: string;
  readonly status: "proposed" | "accepted" | "deprecated" | "superseded";
  readonly consequence: string;
  readonly date: string;
}

/** Payload for `pattern.shared` — reserved for v4.1+. */
export interface PatternSharedPayload {
  readonly fingerprint: string;
  readonly description: string;
}

/** Type guard for Envelope. */
export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.v === "number" &&
    typeof e.id === "string" &&
    typeof e.ts === "string" &&
    typeof e.from === "string" &&
    typeof e.type === "string" &&
    e.payload !== undefined &&
    typeof e.sig === "string"
  );
}

/**
 * Trust score components. The aggregate trust value is:
 *   trust = 0.4*success + 0.2*uptime + 0.2*threat + 0.2*integrity
 * Each component is 0..1. The aggregate is clamped to [0, 1].
 */
export interface TrustScore {
  readonly peer: PeerFingerprint;
  readonly success: number;
  readonly uptime: number;
  readonly threat: number;
  readonly integrity: number;
  readonly aggregate: number;
  readonly updatedAt: string;
}

/**
 * Compute the aggregate trust score from its components.
 * Pure function, no I/O. Clamped to [0, 1].
 */
export function computeTrust(
  components: Pick<TrustScore, "success" | "uptime" | "threat" | "integrity">
): number {
  const raw =
    0.4 * components.success +
    0.2 * components.uptime +
    0.2 * components.threat +
    0.2 * components.integrity;
  return Math.max(0, Math.min(1, raw));
}

/** Audit log entry — append-only JSONL at ~/.engram/mesh/audit.jsonl. */
export interface AuditEntry {
  readonly ts: string;
  readonly action:
    | "send"
    | "receive"
    | "reject"
    | "trust_update"
    | "key_rotate"
    | "peer_revoked";
  readonly peer?: PeerFingerprint;
  readonly envelopeId?: string;
  readonly type?: MessageType;
  readonly reason?: string;
  readonly bytes?: number;
}
