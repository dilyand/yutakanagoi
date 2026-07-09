import { describe, expect, it } from 'vitest';
import { deriveListName } from './list-naming';

describe('deriveListName', () => {
	it('kebab-cases a camelCase filename and strips the extension', () => {
		expect(deriveListName('HelloTalk.xml')).toBe('hello-talk');
	});

	it('replaces spaces with hyphens and lowercases', () => {
		expect(deriveListName('My List.txt')).toBe('my-list');
	});

	it('leaves an already-kebab-case name unchanged', () => {
		expect(deriveListName('already-kebab.md')).toBe('already-kebab');
	});

	it('replaces underscores with hyphens', () => {
		expect(deriveListName('with_underscores.txt')).toBe('with-underscores');
	});

	it('collapses repeated separators into a single hyphen', () => {
		expect(deriveListName('double  space--dash.txt')).toBe('double-space-dash');
	});

	it('handles a filename with no extension', () => {
		expect(deriveListName('NoExtension')).toBe('no-extension');
	});
});
