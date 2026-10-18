/**
 * The engine that counted a record. Election records name it, and the verifier refuses to vouch
 * for a record counted by another version. Kept equal to package.json by a test.
 */
export const ENGINE = { name: 'ustp-tally', version: '0.1.0' } as const;

export interface EngineId {
  name: string;
  version: string;
  /** The npm tarball's integrity string (sha512-...) for the pinned version, when known. */
  integrity?: string;
}
