import { getSetting, setSetting } from "./db";

/**
 * The app-local vault for Passwords-manager secrets.
 *
 * Secrets are encrypted with a random 256-bit vault key (AES-GCM) and
 * stored in the password_entries table's `secret` column — never in
 * the OS keychain, never in plaintext. The vault key itself never
 * sits on disk: it is stored wrapped (AES-GCM encrypted) with a key
 * derived from the user's 4-digit PIN (PBKDF2, 210k iterations), and
 * unwrapped into memory only while the Passwords dialog is unlocked.
 * Closing the dialog drops it.
 *
 * Consequences, stated plainly:
 * - Changing the PIN only re-wraps the one vault key — entries are
 *   never re-encrypted, so a PIN change cannot strand them.
 * - A forgotten PIN cannot be recovered: resetting it destroys the
 *   wrapped key, so every vault secret becomes undecryptable. The
 *   reset path therefore also clears the stored secrets (entry
 *   names, usernames and notes are kept — only the secrets go).
 * - A 4-digit PIN is a weak key-encryption key against offline brute
 *   force by someone holding the database file. This vault stops
 *   casual viewing and keeps secrets out of the OS credential store;
 *   it is not a substitute for a strong master password.
 */

const SALT_KEY = "vault_salt";
const WRAPPED_KEY = "vault_wrapped_key";
const PBKDF2_ITERATIONS = 210_000;

export class VaultNotInitialized extends Error {
  constructor() {
    super("Vault is not initialized yet.");
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64ToBytes(text: string): Uint8Array {
  const s = atob(text);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Stored form: "<base64 iv>.<base64 ciphertext>". */
function pack(iv: Uint8Array, data: Uint8Array): string {
  return `${bytesToBase64(iv)}.${bytesToBase64(data)}`;
}

function unpack(packed: string): { iv: Uint8Array; data: Uint8Array } {
  const [iv, data] = packed.split(".");
  if (!iv || !data) throw new Error("Stored secret is malformed.");
  return { iv: base64ToBytes(iv), data: base64ToBytes(data) };
}

async function deriveKek(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function getSalt(): Promise<Uint8Array | null> {
  const raw = await getSetting(SALT_KEY);
  return raw ? base64ToBytes(raw) : null;
}

/** True when a wrapped vault key is stored. */
export async function vaultExists(): Promise<boolean> {
  return (await getSetting(WRAPPED_KEY)) !== null;
}

/**
 * First-time setup: generate the vault key and wrap it with a key
 * derived from the PIN. Called right after the PIN is created, and
 * again on first unlock when a PIN predates the vault (upgrade path).
 */
export async function vaultInit(pin: string): Promise<CryptoKey> {
  const salt = randomBytes(16);
  const kek = await deriveKek(pin, salt);
  const vaultKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", vaultKey));
  const iv = randomBytes(12);
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, kek, rawKey as BufferSource),
  );
  await setSetting(SALT_KEY, bytesToBase64(salt));
  await setSetting(WRAPPED_KEY, pack(iv, wrapped));
  return vaultKey;
}

/**
 * Unlock: derive the key-encryption key from the entered PIN and
 * unwrap the vault key. Throws VaultNotInitialized when no vault
 * exists yet, and a decryption error when the PIN is wrong (callers
 * check the PIN hash first, so a wrong PIN normally never reaches
 * here).
 */
export async function vaultUnlock(pin: string): Promise<CryptoKey> {
  const [salt, wrapped] = await Promise.all([
    getSalt(),
    getSetting(WRAPPED_KEY),
  ]);
  if (!salt || !wrapped) throw new VaultNotInitialized();
  const kek = await deriveKek(pin, salt);
  const { iv, data } = unpack(wrapped);
  const rawKey = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, kek, data as BufferSource),
  );
  return crypto.subtle.importKey("raw", rawKey as BufferSource, "AES-GCM", true, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Change the PIN's wrapping: unwrap with the current PIN, re-wrap
 * with the new PIN (fresh salt), and return the vault key. Only the
 * wrapped key changes — entries are untouched. On any failure the
 * old salt and wrapped key are restored, so a half-done change
 * cannot strand the vault.
 */
export async function vaultChangePin(
  currentPin: string,
  newPin: string,
): Promise<CryptoKey> {
  const vaultKey = await vaultUnlock(currentPin);
  const oldSalt = await getSetting(SALT_KEY);
  const oldWrapped = await getSetting(WRAPPED_KEY);
  try {
    const salt = randomBytes(16);
    const kek = await deriveKek(newPin, salt);
    const rawKey = new Uint8Array(
      await crypto.subtle.exportKey("raw", vaultKey),
    );
    const iv = randomBytes(12);
    const wrapped = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, kek, rawKey as BufferSource),
    );
    await setSetting(SALT_KEY, bytesToBase64(salt));
    await setSetting(WRAPPED_KEY, pack(iv, wrapped));
    return vaultKey;
  } catch (e) {
    // Restore the old wrapping so the old PIN still opens the vault.
    if (oldSalt !== null) await setSetting(SALT_KEY, oldSalt).catch(() => {});
    if (oldWrapped !== null)
      await setSetting(WRAPPED_KEY, oldWrapped).catch(() => {});
    throw e;
  }
}

/**
 * Forget-PIN reset: destroys the wrapped key, so every vault secret
 * becomes undecryptable. Callers clear the stored secrets alongside
 * (see db.clearAllPasswordSecrets) and keep only metadata.
 */
export async function vaultReset(): Promise<void> {
  await setSetting(SALT_KEY, "");
  await setSetting(WRAPPED_KEY, "");
}

/** Encrypt one password with the unlocked vault key. */
export async function vaultEncrypt(
  vaultKey: CryptoKey,
  plaintext: string,
): Promise<string> {
  const iv = randomBytes(12);
  const data = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      vaultKey,
      new TextEncoder().encode(plaintext),
    ),
  );
  return pack(iv, data);
}

/** Decrypt one stored secret with the unlocked vault key. */
export async function vaultDecrypt(
  vaultKey: CryptoKey,
  stored: string,
): Promise<string> {
  const { iv, data } = unpack(stored);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    vaultKey,
    data as BufferSource,
  );
  return new TextDecoder().decode(plain);
}
