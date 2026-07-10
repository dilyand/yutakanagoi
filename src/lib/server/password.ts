import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/**
 * Hashes `password` with scrypt under a fresh random salt, returning
 * `salt:derivedKey` (both hex) for storage in users.password_hash. No new
 * dependency needed — scrypt is a memory-hard KDF built into node:crypto.
 */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
	return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

/**
 * Verifies `password` against a hash produced by hashPassword. Comparison is
 * constant-time (timingSafeEqual) so a caller can't learn how much of a
 * guess was correct from response timing.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [saltHex, keyHex] = stored.split(':');
	if (!saltHex || !keyHex) return false;

	const salt = Buffer.from(saltHex, 'hex');
	const storedKey = Buffer.from(keyHex, 'hex');
	const derivedKey = (await scryptAsync(password, salt, storedKey.length)) as Buffer;

	return timingSafeEqual(derivedKey, storedKey);
}
