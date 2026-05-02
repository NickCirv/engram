/**
 * v4.0 Mesh — barrel export. Public surface for the rest of engram.
 */
export * from "./types.js";
export {
  canonicalize,
  canonicalizeToString,
  canonicalizeEnvelopeForSigning,
} from "./jcs.js";
export {
  initIdentity,
  loadIdentity,
  signBytes,
  verifyBytes,
  computeFingerprint,
  exportPublicKey,
  meshDir,
  type MeshIdentity,
} from "./identity.js";
export {
  containsPii,
  stripPii,
  stripPiiDeep,
} from "./pii-gate.js";
export {
  logAudit,
  rotateIfNeeded,
  readAudit,
  MESH_AUDIT_MAX_BYTES,
} from "./audit.js";
