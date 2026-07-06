import { createHash, timingSafeEqual } from 'node:crypto';

// Hashing both sides to a fixed-length digest before comparing means
// timingSafeEqual (which requires equal-length buffers) never has to
// short-circuit on a length mismatch — so a caller can't learn the secret's
// length, let alone its content, from response timing. Kept dependency-free
// (no $env/@sveltejs/kit imports) so it can be unit tested directly.
export function secretsMatch(a: string, b: string): boolean {
	const digestA = createHash('sha256').update(a).digest();
	const digestB = createHash('sha256').update(b).digest();
	return timingSafeEqual(digestA, digestB);
}
