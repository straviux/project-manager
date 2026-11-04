import { getSetting, setSetting } from "./db";

/**
 * The 4-digit PIN that gates the Passwords manager. It is a viewing
 * lock, not encryption: the secrets themselves live in the OS
 * keychain, and this PIN only decides whether this dialog shows them.
 * The PIN itself is never stored — only a salted SHA-256 hash of it,
 * in the settings table. A forgotten PIN can be reset from the lock
 * screen; that removes the lock only, never any saved password.
 */

const SALT_KEY = "password_manager_pin_salt";
const HASH_KEY = "password_manager_pin_hash";

const PIN_RE = /^\d{4}$/;

export function isPinFormat(pin: string): boolean {
  return PIN_RE.test(pin);
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function newSalt(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** True when a PIN has been created (salt and hash both present). */
export async function hasPin(): Promise<boolean> {
  const [salt, hash] = await Promise.all([
    getSetting(SALT_KEY),
    getSetting(HASH_KEY),
  ]);
  return Boolean(salt && hash);
}

async function savePin(pin: string): Promise<void> {
  const salt = newSalt();
  await setSetting(SALT_KEY, salt);
  await setSetting(HASH_KEY, await sha256Hex(`${salt}:${pin}`));
}

/** Create the first PIN. Throws unless the PIN is exactly 4 digits. */
export async function createPin(pin: string): Promise<void> {
  if (!isPinFormat(pin)) throw new Error("The PIN must be exactly 4 digits.");
  await savePin(pin);
}

/** True when the entered PIN matches the stored hash. */
export async function verifyPin(pin: string): Promise<boolean> {
  const [salt, hash] = await Promise.all([
    getSetting(SALT_KEY),
    getSetting(HASH_KEY),
  ]);
  if (!salt || !hash) return false;
  return (await sha256Hex(`${salt}:${pin}`)) === hash;
}

/** Change the PIN, only when the current PIN matches. */
export async function changePin(
  currentPin: string,
  newPin: string,
): Promise<void> {
  if (!(await verifyPin(currentPin)))
    throw new Error("The current PIN is incorrect.");
  if (!isPinFormat(newPin))
    throw new Error("The new PIN must be exactly 4 digits.");
  await savePin(newPin);
}

/** Remove the PIN lock. Saved passwords are untouched. */
export async function clearPin(): Promise<void> {
  await setSetting(SALT_KEY, "");
  await setSetting(HASH_KEY, "");
}
