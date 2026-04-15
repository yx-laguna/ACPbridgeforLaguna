/**
 * ed25519 attestation over deliverables.
 * Callers verify using our public key published on the ACP agent card.
 */

import nacl from "tweetnacl";

const decodeBase64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const encodeBase64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

const PUB = process.env.ATTEST_PUBKEY_B64;
const SEC = process.env.ATTEST_SECKEY_B64;
if (!PUB || !SEC) {
  throw new Error("ATTEST_PUBKEY_B64 / ATTEST_SECKEY_B64 must be set");
}
const PUB_BYTES = decodeBase64(PUB);
const SEC_BYTES = decodeBase64(SEC);

export interface Attested<T> {
  payload: T;
  attestation: {
    issuer: "laguna-acp-provider";
    issuer_pubkey_b64: string;
    issued_at_iso: string;
    sig_b64: string;
  };
}

export function attest<T extends object>(payload: T): Attested<T> {
  const issued_at_iso = new Date().toISOString();
  const canonical = canonicalJson({ payload, issued_at_iso });
  const sig = nacl.sign.detached(new TextEncoder().encode(canonical), SEC_BYTES);
  return {
    payload,
    attestation: {
      issuer: "laguna-acp-provider",
      issuer_pubkey_b64: encodeBase64(PUB_BYTES),
      issued_at_iso,
      sig_b64: encodeBase64(sig),
    },
  };
}

export function verify<T extends object>(a: Attested<T>): boolean {
  const canonical = canonicalJson({
    payload: a.payload,
    issued_at_iso: a.attestation.issued_at_iso,
  });
  return nacl.sign.detached.verify(
    new TextEncoder().encode(canonical),
    decodeBase64(a.attestation.sig_b64),
    decodeBase64(a.attestation.issuer_pubkey_b64),
  );
}

/** Stable stringify — sorted keys, no whitespace. */
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${canonicalJson(val)}`).join(",")}}`;
}
