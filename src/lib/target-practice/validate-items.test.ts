import { describe, expect, it } from 'vitest';
import { coverageUniverse, validateItems } from './validate-items';
import { skeletonFor } from './skeleton';
import {
	allFixtures,
	contrastKimeruKimaru,
	grammarKakadouka,
	kanjiKai,
	setPhraseOtsukaresama,
	wordKibishii
} from './fixtures';
import type { Fixture } from './fixtures';
import type { Item, McOption, WordCard } from './types';

type Loose = Record<string, unknown>;

function clone<T>(v: T): T {
	return JSON.parse(JSON.stringify(v)) as T;
}

/** Validate a fixture's items after editing the item with `id`; returns that item's drop reason. */
function dropReason(fx: Fixture, id: string, edit: (item: Loose) => void): string | undefined {
	const items = clone(fx.items) as unknown as Loose[];
	edit(items.find((i) => i.id === id)!);
	return validateItems(fx.card, items).dropped.find((d) => d.id === id)?.reason;
}

function validWith(fx: Fixture, mutate: (items: Loose[]) => Loose[]) {
	return validateItems(fx.card, mutate(clone(fx.items) as unknown as Loose[]));
}

describe('Appendix A golden fixtures', () => {
	it.each(allFixtures.map((f) => [f.name, f] as const))(
		'%s validates with nothing dropped',
		(_n, fx) => {
			const result = validateItems(fx.card, fx.items);
			expect(result.dropped).toEqual([]);
			expect(result.setIssues).toEqual([]);
			expect(result.valid).toHaveLength(fx.items.length);
		}
	);

	it.each(allFixtures.map((f) => [f.name, f] as const))(
		'%s fills its skeleton exactly',
		(_n, fx) => {
			for (const p of skeletonFor(fx.card)) {
				const n = fx.items.filter((i) => i.phase === p.id && !i.spare).length;
				expect(n, `${fx.name} / ${p.id}`).toBe(p.count);
			}
		}
	);

	it('validates the two generation stages separately, with stage 1 as prior context for stage 2', () => {
		const fx = grammarKakadouka;
		const s1 = fx.items.filter((i) => i.phase === 'understand');
		const s2 = fx.items.filter((i) => i.phase !== 'understand');
		const r1 = validateItems(fx.card, s1, { stage: 1 });
		const r2 = validateItems(fx.card, s2, { stage: 2, priorItems: r1.valid });
		expect(r1.dropped).toEqual([]);
		expect(r1.setIssues).toEqual([]);
		expect(r2.dropped).toEqual([]);
		expect(r2.setIssues).toEqual([]);
	});

	it('rejects an item generated into the wrong stage', () => {
		const understand = grammarKakadouka.items.filter((i) => i.phase === 'understand');
		const r = validateItems(grammarKakadouka.card, understand, { stage: 2 });
		expect(r.valid).toEqual([]);
		expect(r.dropped[0].reason).toMatch(/^phase_out_of_stage/);
	});

	it('covers every sense, side and reading with the fixtures', () => {
		expect(coverageUniverse(wordKibishii.card)).toEqual(['sense:1', 'sense:2', 'sense:3']);
		expect(coverageUniverse(contrastKimeruKimaru.card)).toEqual(['side:a', 'side:b']);
		expect(coverageUniverse(kanjiKai.card)).toEqual(['reading:かい', 'reading:げ', 'reading:と']);
		expect(coverageUniverse(grammarKakadouka.card)).toEqual([]);
	});
});

describe('robustness', () => {
	it('drops garbage without throwing', () => {
		const r = validateItems(grammarKakadouka.card, [null, 'x', 42, [], {}, { id: 'a' }]);
		expect(r.valid).toEqual([]);
		expect(r.dropped).toHaveLength(6);
		expect(r.dropped.every((d) => d.reason.startsWith('shape:'))).toBe(true);
		expect(r.dropped[0].id).toBe('#0');
		expect(r.dropped[5].id).toBe('a');
	});
});

describe('shape and phase', () => {
	const g = grammarKakadouka;

	it('requires rationale and targetSpan', () => {
		expect(dropReason(g, 'g-u1', (i) => delete i.rationale)).toMatch(/rationale is missing/);
		expect(dropReason(g, 'g-u1', (i) => delete i.targetSpan)).toMatch(/targetSpan is missing/);
	});

	it('rejects an unknown kind', () => {
		expect(dropReason(g, 'g-u1', (i) => (i.kind = 'riddle'))).toMatch(/unknown kind/);
	});

	it("rejects a phase that is not in the type's skeleton", () => {
		expect(dropReason(g, 'g-u1', (i) => (i.phase = 'sort'))).toMatch(/^unknown_phase/);
	});

	it('rejects an item kind the phase does not use', () => {
		expect(
			dropReason(g, 'g-p1', (i) => {
				i.kind = 'mc';
				i.options = [];
			})
		).toMatch(/^kind_not_allowed|^shape/);
		expect(
			dropReason(g, 'g-x1', (i) => {
				Object.assign(i, { kind: 'typed', form: 'free', answer: 'x', accepted: ['x'], hint: 'h' });
			})
		).toMatch(/^kind_not_allowed/);
	});

	it('needs a prompt', () => {
		expect(dropReason(g, 'g-p5', (i) => delete i.instruction)).toMatch(/^no_prompt/);
	});
});

describe('language hygiene', () => {
	it('keeps Japanese words and sentences out of the English instruction', () => {
		for (const text of [
			'Combine with かどうか.',
			'Rewrite 友達が「来週、時間がありますか。」 as reported speech.',
			'Replace 決める with the other verb.'
		]) {
			expect(dropReason(grammarKakadouka, 'g-x1', (i) => (i.instruction = text))).toMatch(
				/^language: instruction/
			);
		}
	});

	it('lets short grammar labels through (な-adjective, て-form, だ)', () => {
		for (const text of [
			'Fill the blank; the な-adjective drops だ.',
			'Use the て-form of the verb.',
			'Put the ない-form here.'
		]) {
			expect(dropReason(grammarKakadouka, 'g-x1', (i) => (i.instruction = text))).toBeUndefined();
		}
	});

	it('accepts a dialogue kana line with one speaker per line', () => {
		expect(
			dropReason(grammarKakadouka, 'g-u4', (i) => {
				i.sentence =
					'A: 明日のパーティー、来る？\nB: 仕事が終わるかどうか分からないから、まだ返事できない。';
				i.kana =
					'A: あしたのパーティー、くる？\nB: しごとがおわる〇〇わからないから、まだへんじできない。';
			})
		).toBeUndefined();
	});

	it('requires an English rationale and hint', () => {
		expect(dropReason(grammarKakadouka, 'g-u1', (i) => (i.rationale = 'かどうかの意味'))).toMatch(
			/rationale must be written in English/
		);
		expect(dropReason(grammarKakadouka, 'g-p1', (i) => (i.hint = 'ヒント'))).toMatch(
			/hint must be written in English/
		);
	});

	it('requires the sentence to be Japanese and typed answers to be Japanese', () => {
		expect(
			dropReason(grammarKakadouka, 'g-u1', (i) => {
				i.sentence = 'He might come.';
				i.kana = 'he';
			})
		).toMatch(/sentence contains no Japanese/);
		expect(
			dropReason(grammarKakadouka, 'g-p5', (i) => {
				i.answer = 'this train';
				i.accepted = ['this train'];
			})
		).toMatch(/typed answer contains no Japanese/);
	});
});

describe('kana line', () => {
	const g = grammarKakadouka;

	it('requires a kana line whenever there is a sentence', () => {
		expect(dropReason(g, 'g-u1', (i) => delete i.kana)).toMatch(/^kana: sentence has no kana line/);
	});

	it('allows only kana and punctuation', () => {
		expect(dropReason(g, 'g-u1', (i) => (i.kana = '彼が来る〇〇、まだ分かりません。'))).toMatch(
			/^kana: kana line contains something other/
		);
		expect(dropReason(g, 'g-u1', (i) => (i.kana = 'kare ga 〇〇'))).toMatch(/^kana:/);
	});

	it('requires the mask when the target occurs, and forbids it when it does not', () => {
		expect(
			dropReason(g, 'g-u1', (i) => (i.kana = 'かれがくるかどうか、まだわかりません。'))
		).toMatch(/〇〇 is missing/);
		expect(dropReason(g, 'g-p1', (i) => (i.kana = 'あしたはあめがふる〇〇わからない。'))).toMatch(
			/target is not in the sentence/
		);
	});

	it('accepts A/B speaker labels and cloze blanks in the kana line', () => {
		// g-u4 (dialogue labels) and g-p1 (blank) are valid fixtures, so they would have been dropped otherwise.
		const r = validateItems(g.card, g.items);
		expect(r.valid.map((i) => i.id)).toEqual(expect.arrayContaining(['g-u4', 'g-p1']));
	});

	it('requires the focus to be a substring of the sentence', () => {
		expect(dropReason(kanjiKai, 'k-r1', (i) => (i.focus = '決'))).toMatch(/^focus:/);
	});
});

describe('mc items', () => {
	const g = grammarKakadouka;
	const opts = (i: Loose) => i.options as McOption[];

	it('needs 2-4 options', () => {
		expect(dropReason(g, 'g-c1', (i) => (i.options = opts(i).slice(0, 1)))).toMatch(
			/^mc_option_count/
		);
		expect(
			dropReason(g, 'g-u1', (i) =>
				opts(i).push({ text: 'Extra', correct: false, tag: 'unrelated' })
			)
		).toMatch(/^mc_option_count: 5/);
	});

	it('needs distinct options', () => {
		expect(
			dropReason(g, 'g-c1', (i) => (opts(i)[0].text = '行っても、行かなくても、同じだ。'))
		).toMatch(/^mc_duplicate_options/);
	});

	it('needs exactly one correct option', () => {
		expect(dropReason(g, 'g-u1', (i) => opts(i).forEach((o) => (o.correct = false)))).toMatch(
			/0 correct/
		);
		expect(dropReason(g, 'g-u1', (i) => opts(i).forEach((o) => (o.correct = true)))).toMatch(
			/4 correct/
		);
	});

	it('forbids a tag on the correct option', () => {
		expect(dropReason(g, 'g-u1', (i) => (opts(i)[0].tag = 'context'))).toMatch(/^tag_on_correct/);
	});

	it('requires a tag on every wrong option in Understand', () => {
		expect(dropReason(g, 'g-u1', (i) => delete opts(i)[3].tag)).toMatch(/^untagged_distractor/);
	});

	it('requires at least one valid-meaning-wrong-place distractor in Understand', () => {
		expect(
			dropReason(g, 'g-u1', (i) => {
				opts(i)[1].tag = 'context';
				opts(i)[2].tag = 'unrelated';
			})
		).toMatch(/^missing_required_tag/);
	});

	it('rejects a tag that belongs to another type', () => {
		expect(dropReason(g, 'g-u1', (i) => (opts(i)[3].tag = 'wrong_side'))).toMatch(
			/^bad_tag: tag "wrong_side"/
		);
	});

	it("checks other_sense against the card's senses", () => {
		const w = wordKibishii;
		expect(dropReason(w, 'w-u1', (i) => (opts(i)[1].tag = 'other_sense:9'))).toMatch(
			/not a sense on the card/
		);
		expect(dropReason(w, 'w-u1', (i) => (opts(i)[1].tag = 'other_sense:1'))).toMatch(
			/item's own sense/
		);
		expect(dropReason(w, 'w-u1', (i) => (opts(i)[1].tag = 'other_sense'))).toMatch(
			/needs a parameter/
		);
	});

	it('does not demand an other_sense distractor from a one-sense Word (there is none to name)', () => {
		const one = clone(wordKibishii);
		one.card = { ...(one.card as WordCard), senses: [(one.card as WordCard).senses[0]] };
		const item = one.items.find((i) => i.id === 'w-u1') as unknown as Loose;
		item.coverage = 'sense:1';
		item.options = [
			{ text: 'He is strict with us', correct: true },
			{ text: 'He is cheerful', correct: false, tag: 'opposite' },
			{ text: 'He is late', correct: false, tag: 'context' }
		];
		expect(validateItems(one.card, [item]).dropped).toEqual([]);
		// ...but a multi-sense Word still does.
		expect(
			dropReason(wordKibishii, 'w-u1', (i) =>
				opts(i).forEach((o) => !o.correct && (o.tag = 'opposite'))
			)
		).toMatch(/^missing_required_tag/);
	});

	it('does not require tags outside Understand', () => {
		expect(
			dropReason(grammarKakadouka, 'g-c1', (i) => opts(i).forEach((o) => delete o.tag))
		).toBeUndefined();
	});
});

describe('typed items', () => {
	const g = grammarKakadouka;

	it('needs the canonical answer in accepted', () => {
		expect(dropReason(g, 'g-p1', (i) => (i.accepted = ['どうか']))).toMatch(
			/^typed_answer_not_accepted/
		);
		expect(dropReason(g, 'g-p1', (i) => (i.accepted = []))).toMatch(/^shape/);
	});

	it('treats punctuation and width variants of the answer as the same', () => {
		expect(dropReason(g, 'g-p1', (i) => (i.accepted = ['かどうか。']))).toBeUndefined();
	});

	it('needs exactly one blank in a cloze', () => {
		expect(
			dropReason(g, 'g-p2', (i) => {
				i.sentence = 'この情報は本当かどうか確かめたい。';
				i.kana = 'このじょうほうはほんとう〇〇たしかめたい。';
			})
		).toMatch(/0 blanks/);
		// The original A1 C2 packed two clozes into one item.
		expect(
			dropReason(g, 'g-c2', (i) => {
				i.sentence = '雨が＿＿、試合は行われる。 雨が＿＿、まだ分からない。';
				i.kana = 'あめが＿＿、しあいはおこなわれる。 あめが＿＿、まだわからない。';
			})
		).toMatch(/2 blanks/);
		expect(dropReason(g, 'g-p1', (i) => delete i.sentence)).toMatch(/^cloze_no_sentence/);
	});

	it('forbids a blank in a free item', () => {
		expect(
			dropReason(g, 'g-p5', (i) => {
				i.sentence = 'この電車は＿＿。';
				i.kana = 'このでんしゃは＿＿。';
			})
		).toMatch(/^free_has_blank/);
	});

	it('requires each accepted answer to fill the blank cleanly', () => {
		expect(dropReason(g, 'g-c2', (i) => (i.accepted = ['降るかどうか', '降るかどうか、']))).toMatch(
			/^cloze_unclean_fill.*doubled punctuation/
		);
		expect(dropReason(g, 'g-p1', (i) => (i.accepted = ['かどうか', '（かどうか']))).toMatch(
			/^cloze_unclean_fill.*unbalanced/
		);
	});

	it('rejects a cloze whose answer is already in the prompt', () => {
		expect(
			dropReason(g, 'g-p1', (i) => {
				i.sentence = '明日は雨が降る＿＿分からない。かどうか';
				i.kana = 'あしたはあめがふる＿＿わからない。〇〇';
			})
		).toMatch(/^answer_in_prompt/);
	});

	it('does not count the cue as part of the prompt', () => {
		// k-p5 lists the answer 解説 in its cue by design.
		expect(dropReason(kanjiKai, 'k-p5', () => {})).toBeUndefined();
	});
});

describe('tiles items', () => {
	const g = grammarKakadouka;
	const tilesOf = (i: Loose) => i.tiles as string[];

	it('needs at least three tiles', () => {
		expect(
			dropReason(g, 'g-p4', (i) => {
				i.tiles = ['店が開いている', 'かどうか調べてみます'];
				i.accepted = ['店が開いているかどうか調べてみます'];
			})
		).toMatch(/^tiles_too_few/);
	});

	it('rejects a displayed order that is already a correct answer', () => {
		expect(
			dropReason(
				g,
				'g-p4',
				(i) => (i.tiles = ['店が', '開いている', 'かどうか', '調べて', 'みます'])
			)
		).toMatch(/^tiles_not_shuffled/);
	});

	it('rejects an accepted sentence the tiles cannot build', () => {
		expect(dropReason(g, 'g-p4', (i) => (i.accepted = ['店が開いているかどうか調べます']))).toMatch(
			/^tiles_not_reassemblable/
		);
		expect(dropReason(g, 'g-p4', (i) => tilesOf(i).pop())).toMatch(/^tiles_not_reassemblable/);
	});

	it('matches accepted sentences to tiles ignoring punctuation (A5 P4 has no 。 on its tiles)', () => {
		const r = validateItems(setPhraseOtsukaresama.card, setPhraseOtsukaresama.items);
		expect(r.valid.map((i) => i.id)).toContain('p-p4');
	});

	it('rejects a shuffle equal to ANY accepted order, not just the first', () => {
		expect(
			dropReason(
				setPhraseOtsukaresama,
				'p-p4',
				(i) => (i.tiles = ['お疲れ様でした', '先に', '失礼します'])
			)
		).toMatch(/^tiles_not_shuffled/);
	});
});

describe('claude items', () => {
	it('needs exemplars unless it is a free item', () => {
		expect(dropReason(grammarKakadouka, 'g-x1', (i) => (i.expected = []))).toMatch(
			/^claude_no_expected/
		);
		expect(dropReason(grammarKakadouka, 'g-x4', () => {})).toBeUndefined();
	});

	it('needs Japanese exemplars', () => {
		expect(
			dropReason(grammarKakadouka, 'g-x1', (i) => (i.expected = ['whether the shop is cheap']))
		).toMatch(/expected answers must be Japanese/);
	});
});

describe('coverage keys', () => {
	it('requires a key where the type needs one', () => {
		expect(dropReason(wordKibishii, 'w-u1', (i) => delete i.coverage)).toMatch(
			/^coverage_missing_key/
		);
		expect(dropReason(contrastKimeruKimaru, 'c-s1', (i) => delete i.coverage)).toMatch(
			/^coverage_missing_key/
		);
		expect(dropReason(kanjiKai, 'k-r1', (i) => delete i.coverage)).toMatch(/^coverage_missing_key/);
	});

	it("rejects a key outside the card's universe", () => {
		expect(dropReason(wordKibishii, 'w-u1', (i) => (i.coverage = 'sense:7'))).toMatch(
			/^coverage_unknown_key/
		);
		expect(dropReason(grammarKakadouka, 'g-u1', (i) => (i.coverage = 'sense:1'))).toMatch(
			/^coverage_unknown_key/
		);
	});

	it('treats a katakana reading key like its hiragana form', () => {
		expect(dropReason(kanjiKai, 'k-r2', (i) => (i.coverage = 'reading:カイ'))).toBeUndefined();
	});
});

describe('target presence', () => {
	it('requires the target span somewhere in the item', () => {
		expect(
			dropReason(wordKibishii, 'w-u1', (i) => {
				i.targetSpan = '優しい';
				i.kana = 'ははわたしのせいせきにとてもきびしい。';
			})
		).toMatch(/^target_missing/);
		// A1 P1: the target is only in the answer.
		expect(dropReason(grammarKakadouka, 'g-p1', () => {})).toBeUndefined();
	});

	it('exempts Set phrase Situation items whose answer is another phrase', () => {
		expect(dropReason(setPhraseOtsukaresama, 'p-s2', () => {})).toBeUndefined();
		// …but not other phases.
		expect(
			dropReason(setPhraseOtsukaresama, 'p-u2', (i) => {
				i.targetSpan = 'お世話になっております';
				i.kana = 'おつかれさまです。たなかです。かいぎのしりょうをおくります。';
			})
		).toMatch(/^target_missing/);
	});

	it('exempts Claude-graded items', () => {
		expect(dropReason(grammarKakadouka, 'g-x4', () => {})).toBeUndefined();
	});
});

describe('dedupe', () => {
	it('drops a repeated id', () => {
		const r = validWith(grammarKakadouka, (items) => [...items, clone(items[0])]);
		expect(r.dropped).toEqual([{ id: 'g-u1', reason: expect.stringMatching(/^duplicate_id/) }]);
	});

	it('drops a later item that repeats an earlier sentence', () => {
		const r = validWith(grammarKakadouka, (items) => {
			const copy = clone(items[0]);
			copy.id = 'g-u1-again';
			return [...items, copy];
		});
		expect(r.dropped).toEqual([
			{ id: 'g-u1-again', reason: expect.stringMatching(/^duplicate_sentence/) }
		]);
		expect(r.valid).toHaveLength(grammarKakadouka.items.length);
	});

	it('drops an item whose sentence the learner just saw on the card', () => {
		expect(
			dropReason(grammarKakadouka, 'g-u1', (i) => {
				i.sentence = '彼が結婚しているかどうか、誰も知らない。';
				i.kana = 'かれがけっこんしている〇〇、だれもしらない。';
			})
		).toMatch(/^duplicate_sentence/);
	});

	it('catches a cloze whose filled sentence repeats a tile answer', () => {
		const r = validWith(grammarKakadouka, (items) => {
			const dup = clone(items.find((i) => i.id === 'g-p1')!);
			dup.id = 'g-p1-copy';
			dup.sentence = '店が開いている＿＿調べてみます。';
			dup.kana = 'みせがあいている＿＿しらべてみます。';
			return [...items, dup];
		});
		expect(r.dropped).toEqual([
			{ id: 'g-p1-copy', reason: expect.stringMatching(/^duplicate_sentence/) }
		]);
	});

	it('drops items that repeat a sentence from an earlier round (avoidSentences)', () => {
		const u1 = grammarKakadouka.items.find((i) => i.id === 'g-u1')!;
		const r = validateItems(grammarKakadouka.card, clone(grammarKakadouka.items), {
			// Normalization makes punctuation and spacing irrelevant.
			avoidSentences: [`${u1.sentence!.replace('。', '')} `, 'ab']
		});
		expect(r.dropped).toEqual([
			{ id: 'g-u1', reason: expect.stringMatching(/^duplicate_sentence.*earlier round/) }
		]);
	});

	it('dedupes stage 2 against stage 1 via priorItems', () => {
		const prior = grammarKakadouka.items.filter((i) => i.phase === 'understand') as Item[];
		const repeat = clone(grammarKakadouka.items.find((i) => i.id === 'g-u1')!) as unknown as Loose;
		Object.assign(repeat, { id: 'g-late', phase: 'use', kind: 'claude', expected: ['何か日本語'] });
		delete repeat.options;
		const r = validateItems(grammarKakadouka.card, [repeat], { stage: 2, priorItems: prior });
		expect(r.dropped).toEqual([
			{ id: 'g-late', reason: expect.stringMatching(/^duplicate_sentence/) }
		]);
	});
});

describe('set-level rules', () => {
	it('reports a phase that falls below its minimum', () => {
		const r = validWith(grammarKakadouka, (items) =>
			items.filter((i) => !['g-u2', 'g-u3', 'g-u4'].includes(i.id as string))
		);
		expect(r.setIssues).toEqual([
			{ code: 'phase_below_minimum', phase: 'understand', detail: expect.stringMatching(/1 valid/) }
		]);
	});

	it('does not count spares toward the minimum', () => {
		const r = validWith(grammarKakadouka, (items) =>
			items.filter((i) => i.phase !== 'produce' || i.id === 'g-spare1' || i.id === 'g-p1')
		);
		expect(r.setIssues.map((s) => s.phase)).toEqual(['produce']);
		expect(r.valid.filter((i) => i.phase === 'produce')).toHaveLength(2); // p1 + the spare
	});

	it('reports a sense that nothing covers', () => {
		const r = validWith(wordKibishii, (items) => items.filter((i) => i.coverage !== 'sense:2'));
		expect(r.setIssues.map((s) => s.code)).toContain('coverage_missing');
		expect(r.setIssues.find((s) => s.code === 'coverage_missing')!.detail).toMatch(/sense:2/);
	});

	it('reports a sense that takes more than about half of the keyed items', () => {
		const r = validWith(wordKibishii, (items) =>
			items.map((i) =>
				typeof i.coverage === 'string' && i.id !== 'w-s1' ? { ...i, coverage: 'sense:3' } : i
			)
		);
		// Coverage on other_sense tags still validates; only the set rule fires.
		const dominant = r.setIssues.filter((s) => s.code === 'coverage_dominant');
		expect(dominant.length).toBeGreaterThan(0);
	});

	it('reports Sort answers that lean to one side by more than one', () => {
		const r = validWith(contrastKimeruKimaru, (items) =>
			items.map((i) => (i.id === 'c-s1' || i.id === 'c-s4' ? { ...i, coverage: 'side:b' } : i))
		);
		expect(r.setIssues.map((s) => s.code)).toContain('sort_unbalanced');
	});

	it('reports a Set phrase Situation phase where every answer is the target', () => {
		const r = validWith(setPhraseOtsukaresama, (items) => items.filter((i) => i.id !== 'p-s2'));
		expect(r.setIssues.map((s) => s.code)).toEqual(
			expect.arrayContaining(['no_non_target_situation'])
		);
	});

	it('skips coverage and balance when validating stage 2 alone', () => {
		const fx = contrastKimeruKimaru;
		const stage2 = fx.items.filter((i) => i.phase === 'produce' || i.phase === 'use');
		const r = validateItems(fx.card, stage2, { stage: 2 });
		expect(r.setIssues).toEqual([]);
	});

	it('checks phase minimums only for the stage being validated', () => {
		const fx = wordKibishii;
		const r = validateItems(
			fx.card,
			fx.items.filter((i) => i.phase === 'understand' || i.phase === 'sense'),
			{
				stage: 1
			}
		);
		expect(r.setIssues).toEqual([]);
	});
});
