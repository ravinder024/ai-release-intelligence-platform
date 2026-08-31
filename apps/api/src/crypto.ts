import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

// AES-256-GCM encryption for per-user OpenRouter keys.
// The secret is provided via ENCRYPTION_KEY (must be at least 32 chars / we derive a 32-byte key).
const ALGORITHM = "aes-256-gcm";

function getSecretKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.SESSION_COOKIE_SECRET || "dev-only-insecure-default-change-me";
  // Derive a stable 32-byte key from whatever secret is configured.
  return createHash("sha256").update(secret).digest();
}

export function encryptKey(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all base64)
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptKey(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted key payload");
  const decipher = createDecipheriv(ALGORITHM, getSecretKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}
