import { describe, expect, it } from 'vitest';
import { secretsMatch } from './secrets-match';

describe('secretsMatch', () => {
	it('returns true for identical strings', () => {
		expect(secretsMatch('correct-horse-battery-staple', 'correct-horse-battery-staple')).toBe(true);
	});

	it('returns false for different strings of the same length', () => {
		expect(secretsMatch('aaaaaaaa', 'aaaaaaab')).toBe(false);
	});

	it('returns false for different-length strings without throwing', () => {
		expect(secretsMatch('short', 'a much longer candidate secret')).toBe(false);
	});

	it('returns false when one side is empty', () => {
		expect(secretsMatch('', 'nonempty')).toBe(false);
	});
});
