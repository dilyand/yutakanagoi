import { describe, expect, it } from 'vitest';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { TARGET_TYPES } from '$lib/target-practice/types';
import type { Card, Item } from '$lib/target-practice/types';
import { skeletonFor } from '$lib/target-practice/skeleton';
import { validateItems } from '$lib/target-practice/validate-items';
import {
	allFixtures,
	contrastKimeruKimaru,
	grammarKakadouka,
	kanjiKai,
	setPhraseOtsukaresama,
	wordKibishii
} from '$lib/target-practice/fixtures';
import {
	CARD_RESULT_SCHEMAS,
	CandidatesResult,
	GENERIC_TRANSLATION_HINT,
	Stage1Result,
	Stage2Result,
	shuffleTiles,
	toModelCardResult,
	toRawItems
} from './schemas';
import { toWire } from './wire-test-support';

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

describe('generation schemas', () => {
	it('stage 1 is a plain object: no unions, no optionals, nothing lost', () => {
		const s = stats(Stage1Result);
		expect(s.sent.type).toBe('object');
		expect(s.unions).toBe(0);
		expect(s.optionals).toBe(0);
		expect(s.lostConstraints).toEqual([]);
	});

	it('stage 2 has one kind union (shared by items and spares) and no optionals', () => {
		const s = stats(Stage2Result);
		expect(s.sent.type).toBe('object');
		// zod emits the union once as a $def that both arrays reference; even if the
		// API counted each use, 2 is well under the 16 limit.
		expect(s.unions).toBeLessThanOrEqual(2);
		expect(s.optionals).toBe(0);
		expect(s.lostConstraints).toEqual([]);
	});

	it('keeps every field description (a shared z.string() instance would drop them all)', () => {
		const count = (schema: z.ZodType, needle: string) =>
			JSON.stringify(zodOutputFormat(schema as never).schema).split(needle).length - 1;
		// One `phase` per union member: 1 in stage 1, 4 in stage 2.
		expect(count(Stage1Result, 'the phase id this item belongs to')).toBe(1);
		expect(count(Stage2Result, 'the phase id this item belongs to')).toBe(4);
		expect(count(Stage2Result, 'the distractor tag for a wrong option')).toBe(1);
	});

	it('spells out enum-like values in descriptions instead of z.enum', () => {
		const sent = JSON.stringify(zodOutputFormat(Stage2Result as never).schema);
		expect(sent).toContain('\\"cloze\\" (one blank in the sentence) or \\"free\\"');
	});
});

describe('shuffleTiles', () => {
	const tiles = ['この機械が', '役に立つ', 'かどうか', '私は', '知らない'];
	const accepted = ['この機械が役に立つかどうか私は知らない'];

	it('never returns an accepted order, keeps every tile, and is deterministic per seed', () => {
		for (let n = 0; n < 40; n++) {
			const shuffled = shuffleTiles(tiles, accepted, `item-${n}`);
			expect([...shuffled].sort()).toEqual([...tiles].sort());
			expect(shuffled.join('')).not.toBe(accepted[0]);
			expect(shuffleTiles(tiles, accepted, `item-${n}`)).toEqual(shuffled);
		}
		const differing = new Set(
			Array.from({ length: 20 }, (_, n) => shuffleTiles(tiles, accepted, `s${n}`).join('|'))
		);
		expect(differing.size).toBeGreaterThan(5);
	});

	it('avoids every accepted order, not only the first', () => {
		const three = ['先に', '失礼します', 'お疲れ様でした'];
		const both = ['先に失礼しますお疲れ様でした', 'お疲れ様でした先に失礼します'];
		for (let n = 0; n < 40; n++) {
			expect(both).not.toContain(shuffleTiles(three, both, `x${n}`).join(''));
		}
	});

	it('gives up gracefully when every order is "correct" (identical tiles)', () => {
		expect(shuffleTiles(['あ', 'あ', 'あ'], ['あああ'], 'z')).toEqual(['あ', 'あ', 'あ']);
	});

	it('leaves fewer than three tiles for the validator to reject', () => {
		expect(shuffleTiles(['a', 'b'], ['ab'], 'z')).toEqual(['a', 'b']);
	});

	it('toRawItems shuffles a tile item written in answer order', () => {
		const [item] = toRawItems(2, 1, {
			items: [
				{
					phase: 'produce',
					instruction: 'Arrange: I do not know whether it is useful.',
					targetSpan: 'かどうか',
					rationale: 'x',
					tiles,
					accepted
				}
			],
			spares: []
		});
		expect(item.tiles).not.toEqual(tiles);
		const { dropped } = validateItems(grammarKakadouka.card, [item]);
		expect(dropped.some((d) => /tiles_not_shuffled/.test(d.reason))).toBe(false);
	});
});

describe('punctuation-only tiles', () => {
	it('are dropped, and the item still validates', () => {
		const [item] = toRawItems(2, 1, {
			items: [
				{
					phase: 'produce',
					instruction: 'Arrange the tiles to mean: I want to check whether this medicine works.',
					targetSpan: 'かどうか',
					rationale: 'x',
					tiles: ['この薬が', '効く', 'かどうか', '、', '確かめたいです'],
					accepted: ['この薬が効くかどうか、確かめたいです']
				}
			],
			spares: []
		});
		expect([...(item.tiles as string[])].sort()).toEqual(
			['この薬が', '効く', 'かどうか', '確かめたいです'].sort()
		);
		expect(validateItems(grammarKakadouka.card, [item], { stage: 2 }).dropped).toEqual([]);
	});
});

describe('salvaging an empty tile item', () => {
	const translation = {
		phase: 'produce',
		instruction: 'Translate into Japanese: I will ask whether it is safe.',
		targetSpan: 'かどうか',
		rationale: '安全かどうか is the embedded question.',
		tiles: [],
		accepted: ['安全かどうか聞きます', '安全かどうか聞いてみます']
	};

	it('becomes a free typed item with the first accepted answer as canonical', () => {
		const [item] = toRawItems(2, 1, { items: [translation], spares: [] });
		expect(item).toMatchObject({
			kind: 'typed',
			form: 'free',
			answer: '安全かどうか聞きます',
			accepted: translation.accepted,
			hint: GENERIC_TRANSLATION_HINT
		});
		expect(item).not.toHaveProperty('tiles');
		expect(validateItems(grammarKakadouka.card, [item], { stage: 2 }).dropped).toEqual([]);
	});

	it('leaves a tile item that has no tiles and no answers for the validator to drop', () => {
		const [item] = toRawItems(2, 1, { items: [{ ...translation, accepted: [] }], spares: [] });
		expect(item.kind).toBe('tiles');
		expect(validateItems(grammarKakadouka.card, [item]).dropped[0].reason).toMatch(
			/^shape|tiles_too_few/
		);
	});
});

describe('toRawItems', () => {
	// Every fixture, split by stage the way the model would be asked to, must
	// survive wire -> parse -> toRawItems -> validateItems with nothing dropped.
	describe.each(allFixtures)('$name', ({ card, items }) => {
		it.each([1, 2] as const)('round-trips stage %i through the wire format', (stage) => {
			const spec = skeletonFor(card);
			const mine = items.filter((i) => spec.find((p) => p.id === i.phase)?.stage === stage);
			const schema = stage === 1 ? Stage1Result : Stage2Result;
			const parsed = schema.parse({
				items: mine.filter((i) => !i.spare).map(toWire),
				spares: mine.filter((i) => i.spare).map(toWire)
			});

			const raw = toRawItems(stage, 1, parsed);
			const { valid, dropped } = validateItems(card, raw, { stage });
			expect(dropped).toEqual([]);
			expect(valid).toHaveLength(mine.length);
			// Same content as the hand-written fixture, modulo the server-assigned id.
			// Tiles are shuffled by the server, so compare them as a bag.
			const withoutId = (items: Item[]) =>
				items.map((item) => {
					const { id: _id, ...rest } = item; // eslint-disable-line @typescript-eslint/no-unused-vars
					return rest.kind === 'tiles' ? { ...rest, tiles: [...rest.tiles].sort() } : rest;
				});
			expect(withoutId(valid)).toEqual(
				withoutId([...mine.filter((i) => !i.spare), ...mine.filter((i) => i.spare)])
			);
		});
	});

	it('assigns ids from stage, attempt and position, and marks spares', () => {
		const mc = {
			phase: 'understand',
			instruction: 'x',
			sentence: '',
			kana: '',
			focus: '',
			targetSpan: 'y',
			coverage: '',
			rationale: 'z',
			options: []
		};
		const raw = toRawItems(2, 2, { items: [mc, mc], spares: [mc] });
		expect(raw.map((r) => r.id)).toEqual(['s2a2-p0', 's2a2-p1', 's2a2-x0']);
		expect(raw.map((r) => r.spare)).toEqual([undefined, undefined, true]);
	});

	it('turns empty strings into absent fields but keeps required ones for the validator', () => {
		const [item] = toRawItems(1, 1, {
			items: [
				{
					phase: 'understand',
					instruction: '',
					sentence: '',
					kana: '',
					focus: '',
					targetSpan: '',
					coverage: '',
					rationale: '',
					options: [{ text: 'a', correct: true, tag: '' }]
				}
			],
			spares: []
		});
		expect(item).not.toHaveProperty('instruction');
		expect(item).not.toHaveProperty('kana');
		expect(item).not.toHaveProperty('coverage');
		expect(item.options).toEqual([{ text: 'a', correct: true }]);
		expect(item.rationale).toBe('');
		const { dropped } = validateItems(contrastKimeruKimaru.card, [item]);
		expect(dropped[0].reason).toMatch(/^shape: rationale is missing/);
	});

	it('repairs a mask written as one or three 〇 but leaves everything else alone', () => {
		const wire = (kana: string) => ({
			phase: 'understand',
			instruction: 'x',
			sentence: 'a',
			kana,
			focus: '',
			targetSpan: 'y',
			coverage: '',
			rationale: 'z',
			options: []
		});
		const raw = toRawItems(1, 1, {
			items: [
				wire('かれは〇〇〇だ'),
				wire('かれは〇だ'),
				wire('かれは〇〇だ'),
				wire('かれは＿＿だ')
			],
			spares: []
		});
		expect(raw.map((r) => r.kana)).toEqual([
			'かれは〇〇だ',
			'かれは〇〇だ',
			'かれは〇〇だ',
			'かれは＿＿だ'
		]);
	});

	it('a sentence without a kana line is dropped by the validator, not hidden', () => {
		const good = wordKibishii.items.find((i) => i.kind === 'mc' && i.sentence)!;
		const wire = { ...toWire(good), kana: '' };
		const parsed = Stage1Result.parse({ items: [wire], spares: [] });
		const { dropped } = validateItems(wordKibishii.card, toRawItems(1, 1, parsed), { stage: 1 });
		expect(dropped[0].reason).toMatch(/^kana: sentence has no kana line/);
	});
});
