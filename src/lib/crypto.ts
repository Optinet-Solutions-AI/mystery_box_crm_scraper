import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function key(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  // 64 hex chars → 32 bytes; anything else is hashed down to 32 bytes.
  return /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : createHash("sha256").update(raw).digest();
}

/** Encrypts a secret for storage (AES-256-GCM). Stores plaintext only if ENCRYPTION_KEY is unset. */
export function seal(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return null;
  const k = key();
  if (!k) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

/** Decrypts a stored secret. Values saved before encryption was enabled pass through unchanged. */
export function unseal(stored: string | null | undefined): string | null {
  if (stored == null || stored === "") return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const k = key();
  if (!k) throw new Error("ENCRYPTION_KEY is not set, so stored Google credentials can't be decrypted.");
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", k, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}
