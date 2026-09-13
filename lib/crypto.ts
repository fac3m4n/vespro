/**
 * Dataset encryption.
 *
 * AES-256-GCM via WebCrypto. GCM because it is authenticated (AEAD), so a tampered
 * ciphertext fails to decrypt instead of yielding plausible garbage, and 256-bit
 * because it keeps a comfortable margin against Grover-style quantum search. Not CBC
 * and not ECB: neither authenticates, and a marketplace whose blobs sit on a public
 * network needs to detect tampering, not just resist reading.
 *
 * The owner's key never leaves the owner's browser. Buyers do not receive it — that
 * is the point of Vespro, and it is why training runs on the owner's side.
 */

const KEY_ALG = { name: "AES-GCM", length: 256 } as const;
const IV_BYTES = 12; // 96 bits, the size GCM is specified for

export type EncryptedBlob = {
  ciphertext: Uint8Array;
  /** Base64. Public: an IV is not a secret, it only has to be unique per key. */
  iv: string;
};

export async function generateDatasetKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(KEY_ALG, true, ["encrypt", "decrypt"]);
}

/**
 * A fresh IV per call, from the CSPRNG. Reusing one with the same key is the single
 * catastrophic misuse of GCM — it leaks the XOR of the plaintexts and lets an
 * attacker forge tags — so it is generated here and never accepted as a parameter.
 */
export async function encryptDataset(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext as BufferSource,
  );
  return { ciphertext: new Uint8Array(ciphertext), iv: toBase64(iv) };
}

export async function decryptDataset(
  key: CryptoKey,
  blob: EncryptedBlob,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(blob.iv) as BufferSource },
    key,
    blob.ciphertext as BufferSource,
  );
  return new Uint8Array(plaintext);
}

/**
 * Persisted so a seller's listings survive a page reload. localStorage is the right
 * scope for a testnet demo on synthetic data and the wrong scope for real health
 * records — a production build wants a passkey-derived or KMS-held key, which is
 * called out in the README rather than glossed over.
 */
export async function exportKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export async function importKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromBase64(raw) as BufferSource, KEY_ALG, true, [
    "encrypt",
    "decrypt",
  ]);
}

/** Commits to column names and order without revealing a single measurement. */
export async function schemaHash(columns: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(columns.join("\u0000"));
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
