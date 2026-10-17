import { describe, expect, it } from 'vitest';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { TARGET_TYPES } from '$lib/target-practice/types';
import type { Card } from '$lib/target-practice/types';
import {
	contrastKimeruKimaru,
	grammarKakadouka,
	kanjiKai,
	setPhraseOtsukaresama,
	wordKibishii
} from '$lib/target-practice/fixtures';
import { CARD_RESULT_SCHEMAS, CandidatesResult, toModelCardResult } from './schemas';

// Anthropic's structured outputs accept a subset of JSON Schema (limits as of
// writing: 16 union-typed parameters, 24 optional parameters). These tests
// look at what zodOutputFormat actually sends, so a schema change that would
// silently lose its constraints — or blow the limits — fails here, offline.
// They can't prove the API accepts the schema; the smoke test against the
// real API does that.

type Json = Record<string, unknown>;

function walk(node: unknown, visit: (n: Json) => void) {
	if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
	if (typeof node !== 'object' || node === null) return;
	visit(node as Json);
	Object.values(node).forEach((n) => walk(n, visit));
}

function stats(schema: z.ZodType) {
	const sent = zodOutputFormat(schema as never).schema as Json;
	let unions = 0;
	let optionals = 0;
	const lostConstraints: string[] = [];
	walk(sent, (n) => {
		if ('anyOf' in n || 'oneOf' in n) unions++;
		if ('prefixItems' in n) lostConstraints.push('prefixItems');
		if (n.properties && typeof n.properties === 'object') {
			const required = new Set((n.required as string[] | undefined) ?? []);
			optionals += Object.keys(n.properties).filter((k) => !required.has(k)).length;
		}
		// The transform demotes constraints it can't express into `description`.
		if (
			typeof n.description === 'string' &&
			/\{(const|enum|minimum|maximum|prefixItems)/.test(n.description)
		) {
			lostConstraints.push(n.description);
		}
	});
	return { sent, unions, optionals, lostConstraints };
}

describe('structured-output schemas', () => {
	it('candidates: a plain object, no unions or optionals', () => {
		const s = stats(CandidatesResult);
		expect(s.sent.type).toBe('object');
		expect(s.unions).toBe(0);
		expect(s.optionals).toBe(0);
		expect(s.lostConstraints).toEqual([]);
	});

	it.each(TARGET_TYPES)('%s card: object root, one union, constraints survive', (type) => {
		const s = stats(CARD_RESULT_SCHEMAS[type]);
		expect(s.sent.type).toBe('object');
		expect(s.unions).toBe(1);
		expect(s.optionals).toBeLessThanOrEqual(1); // kanji okurigana
		expect(s.lostConstraints).toEqual([]);
	});

	it('spells out enum-like values in descriptions instead of z.enum', () => {
		const kanji = JSON.stringify(zodOutputFormat(CARD_RESULT_SCHEMAS.kanji as never).schema);
		expect(kanji).toContain('\\"on\\" or \\"kun\\"');
		const contrast = JSON.stringify(zodOutputFormat(CARD_RESULT_SCHEMAS.contrast as never).schema);
		expect(contrast).toContain('similar_kanji');
		expect(contrast).toContain('none');
	});
});

function body(card: Card): Record<string, unknown> {
	const { ok: _ok, type: _type, target: _target, ...rest } = card; // eslint-disable-line @typescript-eslint/no-unused-vars
	return rest;
}

describe('card schemas vs the Appendix A fixtures', () => {
	// z.object strips unknown keys, so a field missing from the schema shows up
	// as a difference after the round trip.
	it.each([grammarKakadouka, contrastKimeruKimaru, wordKibishii, kanjiKai, setPhraseOtsukaresama])(
		'parse the $name card body unchanged',
		({ card }) => {
			const parsed = CARD_RESULT_SCHEMAS[card.type].parse({ result: { card: body(card) } });
			expect(toModelCardResult(parsed)).toEqual({ ok: true, card: body(card) });
		}
	);

	it('parses a rejection and flattens it', () => {
		const parsed = CARD_RESULT_SCHEMAS.word.parse({
			result: { reason: 'This is a set phrase.', suggestedType: 'set_phrase' }
		});
		expect(toModelCardResult(parsed)).toEqual({
			ok: false,
			reason: 'This is a set phrase.',
			suggestedType: 'set_phrase'
		});
	});

	it('refuses output that is neither a card nor a rejection', () => {
		expect(CARD_RESULT_SCHEMAS.word.safeParse({ result: { reason: 'x' } }).success).toBe(false);
		expect(CARD_RESULT_SCHEMAS.word.safeParse({ result: { card: {} } }).success).toBe(false);
	});
});
