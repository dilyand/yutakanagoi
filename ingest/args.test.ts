import { describe, expect, it, vi, afterEach } from 'vitest';
import { requireSafePathComponent } from './args.ts';

// requireSafePathComponent is what stands between --user/--slug (and the
// slug deriveListName produces from an audio filename) and a real
// path.join call in every ingest/cli/*.ts entry point — a path-traversal
// regression here reopens all three at once, so it gets its own direct
// unit tests rather than only being exercised indirectly through the CLI
// scripts.

describe('requireSafePathComponent (code review regression)', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns the value unchanged when it is a safe single path segment', () => {
		expect(requireSafePathComponent('hello-talk', 'slug')).toBe('hello-talk');
	});

	it.each(['', '.', '..', '../other', 'a/b', 'a\\b', '..\\other'])(
		'rejects %j instead of letting it reach path.join',
		(value) => {
			const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			requireSafePathComponent(value, 'slug');
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(errorSpy).toHaveBeenCalled();
		}
	);
});
