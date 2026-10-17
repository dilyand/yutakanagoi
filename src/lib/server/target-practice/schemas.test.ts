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
	generationSchemaFor,
	shuffleTiles,
	toModelCardResult,
	toRawItems
} from './schemas';
import { toWire, wirePayload } from './wire-test-support';
import { spareQuota } from '$lib/target-practice/generation';

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
	const stagePhases = (card: Card, stage: 1 | 2) =>
		skeletonFor(card)
			.filter((p) => p.stage === stage)
			.map((p) => p.id);
	const jsonOf = (
		card: Card,
		stage: 1 | 2,
		regenerate?: Parameters<typeof generationSchemaFor>[2]
	) => zodOutputFormat(generationSchemaFor(card, stage, regenerate) as never).schema as Json;
	const defs = (sent: Json) => (sent.$defs ?? {}) as Record<string, Json>;
	/** Resolves the object that `items` / `spares` point at (zod may $ref it). */
	const section = (sent: Json, key: 'items' | 'spares') => {
		const prop = (sent.properties as Record<string, Json>)[key];
		return (prop.$ref ? defs(sent)[String(prop.$ref).split('/').pop()!] : prop) as Json;
	};

	describe.each(allFixtures)('$name', ({ card }) => {
		it('stage 1: a required array per phase, plain objects, no unions or optionals', () => {
			const schema = generationSchemaFor(card, 1);
			const s = stats(schema);
			expect(s.sent.type).toBe('object');
			expect(s.unions).toBe(0); // comprehension phases are all multiple choice
			expect(s.optionals).toBe(0);
			expect(s.lostConstraints).toEqual([]);
			expect(section(s.sent, 'items').required).toEqual(stagePhases(card, 1));
			expect(section(s.sent, 'spares').required).toEqual(spareQuota(card, 1).map((q) => q.phase));
		});

		it('stage 2: a required array per phase, few unions, no optionals', () => {
			const s = stats(generationSchemaFor(card, 2));
			expect(s.sent.type).toBe('object');
			// Produce (typed | tiles) and, for Grammar, Contrast (mc | typed); zod emits
			// each once as a $def that items and spares both reference. 4 is the
			// worst case if the API counted every use — far under the 16 limit.
			expect(s.unions).toBeLessThanOrEqual(4);
			expect(s.optionals).toBe(0);
			expect(s.lostConstraints).toEqual([]);
			expect(section(s.sent, 'items').required).toEqual(stagePhases(card, 2));
			expect(section(s.sent, 'spares').required).toEqual(spareQuota(card, 2).map((q) => q.phase));
		});
	});

	it('a regeneration schema has only the requested phases and no spares', () => {
		const sent = jsonOf(grammarKakadouka.card, 2, [
			{ phase: 'produce', need: 2, coverage: [], reasons: [] }
		]);
		expect(section(sent, 'items').required).toEqual(['produce']);
		expect(sent.required).toEqual(['items']);
	});

	it('each phase takes only the item shapes PHASE_KINDS allows', () => {
		const sent = jsonOf(grammarKakadouka.card, 2);
		/** Every property name reachable from a schema node, following $refs. */
		const fields = (node: unknown, seen = new Set<string>()): Set<string> => {
			const out = new Set<string>();
			const visit = (n: unknown) => {
				if (Array.isArray(n)) return n.forEach(visit);
				if (typeof n !== 'object' || n === null) return;
				const o = n as Json;
				if (typeof o.$ref === 'string' && !seen.has(o.$ref)) {
					seen.add(o.$ref);
					visit(defs(sent)[o.$ref.split('/').pop()!]);
				}
				if (o.properties) {
					Object.keys(o.properties as object).forEach((k) => out.add(k));
				}
				Object.values(o).forEach(visit);
			};
			visit(node);
			return out;
		};
		const phases = section(sent, 'items').properties as Record<string, Json>;
		// use = writing items only; produce = typed | tiles; contrast = mc | typed.
		expect(fields(phases.use)).toContain('expected');
		for (const f of ['options', 'tiles', 'answer']) expect(fields(phases.use)).not.toContain(f);
		expect(fields(phases.produce)).toContain('answer');
		expect(fields(phases.produce)).toContain('tiles');
		for (const f of ['options', 'expected']) expect(fields(phases.produce)).not.toContain(f);
		expect(fields(phases.contrast)).toContain('options');
		expect(fields(phases.contrast)).toContain('answer');
		for (const f of ['tiles', 'expected']) expect(fields(phases.contrast)).not.toContain(f);
		// Stage 1 (all multiple choice) has none of the other shapes anywhere.
		const stage1 = JSON.stringify(jsonOf(wordKibishii.card, 1));
		for (const field of ['"tiles"', '"answer"', '"expected"']) expect(stage1).not.toContain(field);
	});

	it('keeps every field description (a shared z.string() instance would drop them all)', () => {
		const count = (schema: z.ZodType, needle: string) =>
			JSON.stringify(zodOutputFormat(schema as never).schema).split(needle).length - 1;
		const s1 = generationSchemaFor(wordKibishii.card, 1);
		const s2 = generationSchemaFor(grammarKakadouka.card, 2);
		expect(count(s1, 'English task wording')).toBeGreaterThanOrEqual(1);
		expect(count(s2, 'the distractor tag for a wrong option')).toBe(1);
		// The per-phase descriptions carry the counts.
		expect(count(s1, 'the \\"understand\\" items: 4 of them')).toBe(1);
		expect(count(s1, '1 reserve \\"sense\\" items')).toBe(1);
	});

	it('spells out enum-like values in descriptions instead of z.enum', () => {
		const sent = JSON.stringify(
			zodOutputFormat(generationSchemaFor(grammarKakadouka.card, 2) as never).schema
		);
		expect(sent).toContain('\\"cloze\\" (one blank in the sentence) or \\"free\\"');
	});

	it('refuses a payload that leaves a phase out (the failure this shape exists to prevent)', () => {
		const schema = generationSchemaFor(wordKibishii.card, 1);
		const full = wirePayload(
			wordKibishii.card,
			1,
			wordKibishii.items.filter((i) => i.phase === 'understand' || i.phase === 'sense')
		);
		expect(schema.safeParse(full).success).toBe(true);
		const { sense: _sense, ...withoutSense } = full.items as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unused-vars
		expect(schema.safeParse({ ...full, items: withoutSense }).success).toBe(false);
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
			items: {
				produce: [
					{
						instruction: 'Arrange: I do not know whether it is useful.',
						targetSpan: 'かどうか',
						rationale: 'x',
						tiles,
						accepted
					}
				]
			}
		});
		expect(item.tiles).not.toEqual(tiles);
		const { dropped } = validateItems(grammarKakadouka.card, [item]);
		expect(dropped.some((d) => /tiles_not_shuffled/.test(d.reason))).toBe(false);
	});
});

describe('punctuation-only tiles', () => {
	it('are dropped, and the item still validates', () => {
		const [item] = toRawItems(2, 1, {
			items: {
				produce: [
					{
						instruction: 'Arrange the tiles to mean: I want to check whether this medicine works.',
						targetSpan: 'かどうか',
						rationale: 'x',
						tiles: ['この薬が', '効く', 'かどうか', '、', '確かめたいです'],
						accepted: ['この薬が効くかどうか、確かめたいです']
					}
				]
			}
		});
		expect([...(item.tiles as string[])].sort()).toEqual(
			['この薬が', '効く', 'かどうか', '確かめたいです'].sort()
		);
		expect(validateItems(grammarKakadouka.card, [item], { stage: 2 }).dropped).toEqual([]);
	});
});

describe('salvaging an empty tile item', () => {
	const translation = {
		instruction: 'Translate into Japanese: I will ask whether it is safe.',
		targetSpan: 'かどうか',
		rationale: '安全かどうか is the embedded question.',
		tiles: [],
		accepted: ['安全かどうか聞きます', '安全かどうか聞いてみます']
	};

	it('becomes a free typed item with the first accepted answer as canonical', () => {
		const [item] = toRawItems(2, 1, { items: { produce: [translation] } });
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
		const [item] = toRawItems(2, 1, { items: { produce: [{ ...translation, accepted: [] }] } });
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
			const parsed = generationSchemaFor(card, stage).parse(wirePayload(card, stage, mine));

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

	it('assigns ids from stage, attempt, phase and position, takes the phase from the key, marks spares', () => {
		const mc = {
			instruction: 'x',
			sentence: '',
			kana: '',
			focus: '',
			targetSpan: 'y',
			coverage: '',
			rationale: 'z',
			options: []
		};
		const raw = toRawItems(1, 2, {
			items: { understand: [mc, mc], sense: [mc] },
			spares: { understand: [mc] }
		});
		expect(raw.map((r) => r.id)).toEqual([
			's1a2-understand0',
			's1a2-understand1',
			's1a2-sense0',
			's1a2-understandx0'
		]);
		expect(raw.map((r) => r.phase)).toEqual(['understand', 'understand', 'sense', 'understand']);
		expect(raw.map((r) => r.spare)).toEqual([undefined, undefined, undefined, true]);
	});

	it('turns empty strings into absent fields but keeps required ones for the validator', () => {
		const [item] = toRawItems(1, 1, {
			items: {
				understand: [
					{
						instruction: '',
						sentence: '',
						kana: '',
						focus: '',
						targetSpan: '',
						coverage: '',
						rationale: '',
						options: [{ text: 'a', correct: true, tag: '' }]
					}
				]
			}
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
			items: {
				understand: [
					wire('かれは〇〇〇だ'),
					wire('かれは〇だ'),
					wire('かれは〇〇だ'),
					wire('かれは＿＿だ')
				]
			}
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
		const parsed = generationSchemaFor(wordKibishii.card, 1).parse({
			items: { understand: [{ ...toWire(good), kana: '' }], sense: [] },
			spares: { understand: [], sense: [] }
		});
		const { dropped } = validateItems(wordKibishii.card, toRawItems(1, 1, parsed), { stage: 1 });
		expect(dropped[0].reason).toMatch(/^kana: sentence has no kana line/);
	});
});
