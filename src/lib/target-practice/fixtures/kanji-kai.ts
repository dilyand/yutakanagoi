import { claude, mc, right, tiles, typed, wrong } from './build';
import type { Fixture } from './build';
import type { KanjiCard } from '../types';

/**
 * A4 — Kanji, 解.
 *
 * 解約 is deliberately NOT a card compound: Understand U4 tests guessing it
 * from 解 + 約 (the original Appendix A listed it on the card and said it
 * wasn't — a contradiction resolved in favour of the item).
 */
const card: KanjiCard = {
	ok: true,
	type: 'kanji',
	target: '解',
	rule: 'Think "untie": solving, explaining, understanding and breaking up all come from loosening something.',
	modelSentences: ['この問題の解き方を教えてください。'],
	meaning: 'to untie, resolve, understand',
	readings: [
		{ kana: 'カイ', kind: 'on', rare: false },
		{ kana: 'ゲ', kind: 'on', rare: true },
		{ kana: 'と', kind: 'kun', okurigana: 'く', rare: false },
		{ kana: 'と', kind: 'kun', okurigana: 'ける', rare: false }
	],
	compounds: [
		{ word: '理解', reading: 'りかい', gloss: 'understanding' },
		{ word: '解決', reading: 'かいけつ', gloss: 'solution, resolution' },
		{ word: '解説', reading: 'かいせつ', gloss: 'explanation, commentary' },
		{ word: '誤解', reading: 'ごかい', gloss: 'misunderstanding' },
		{ word: '解散', reading: 'かいさん', gloss: 'dispersal, breaking up' }
	]
};

export const kanjiKai: Fixture = {
	name: 'A4 kanji 解',
	card,
	items: [
		// Understand (4)
		mc(
			'k-u1',
			'understand',
			{
				instruction: 'What does this mean?',
				sentence: '問題が解決した。',
				kana: 'もんだいが〇〇けつした。',
				targetSpan: '解',
				rationale: '解決 is resolution: the problem was resolved.'
			},
			[
				right('The problem was resolved'),
				wrong('The problem was explained', 'other_compound:解説'),
				wrong('The problem was misunderstood', 'other_compound:誤解')
			]
		),
		mc(
			'k-u2',
			'understand',
			{
				instruction: 'What did the teacher do?',
				sentence: '先生が試験の問題を解説してくれた。',
				kana: 'せんせいがしけんのもんだいを〇〇せつしてくれた。',
				targetSpan: '解',
				rationale: '解説 is explanation: the teacher went through the questions.'
			},
			[
				right('Went through the exam questions'),
				wrong('Resolved the exam questions', 'other_compound:解決'),
				wrong('Misunderstood the exam questions', 'other_compound:誤解')
			]
		),
		mc(
			'k-u3',
			'understand',
			{
				instruction: 'What happened to the people?',
				sentence: '集まった人たちは、警察の指示で解散した。',
				kana: 'あつまったひとたちは、けいさつのしじで〇〇さんした。',
				targetSpan: '解',
				rationale: '解散 is breaking up: the crowd dispersed.'
			},
			[
				right('They dispersed'),
				wrong('They understood', 'other_compound:理解'),
				wrong('They defrosted', 'other_compound:解凍')
			]
		),
		mc(
			'k-u4',
			'understand',
			{
				instruction:
					'What did the speaker do? (This compound is not on the card — work it out from the kanji.)',
				sentence: '携帯電話を解約した。',
				kana: 'けいたいでんわを〇〇やくした。',
				targetSpan: '解',
				rationale: '解 (undo) + 約 (contract): to cancel a contract.'
			},
			[
				right('Cancelled the phone contract'),
				wrong('Solved a problem with the phone', 'other_compound:解決'),
				wrong('Explained the phone contract', 'other_compound:解説')
			]
		),
		// Reading (3)
		mc(
			'k-r1',
			'reading',
			{
				instruction: 'How is the highlighted kanji read?',
				sentence: '問題を解く。',
				kana: 'もんだいを〇〇く。',
				focus: '解',
				targetSpan: '解',
				coverage: 'reading:と',
				rationale: 'With okurigana (解く) the kun reading と is used.'
			},
			[right('と'), wrong('かい', 'other_reading'), wrong('げ', 'other_reading')]
		),
		mc(
			'k-r2',
			'reading',
			{
				instruction: 'How is the highlighted kanji read?',
				sentence: '事件が解決した。',
				kana: 'じけんが〇〇けつした。',
				focus: '解',
				targetSpan: '解',
				coverage: 'reading:かい',
				rationale: 'In the compound 解決 the on reading カイ is used.'
			},
			[wrong('と', 'other_reading'), right('かい'), wrong('げ', 'other_reading')]
		),
		mc(
			'k-r3',
			'reading',
			{
				instruction: 'How is the highlighted kanji read?',
				sentence: '解熱剤を飲んだ。',
				kana: '〇〇ねつざいをのんだ。',
				focus: '解',
				targetSpan: '解',
				coverage: 'reading:げ',
				rationale: 'In 解熱 the rare on reading ゲ is used.'
			},
			[wrong('かい', 'other_reading'), wrong('と', 'other_reading'), right('げ')]
		),
		// Produce (5)
		typed('k-p1', 'produce', {
			form: 'free',
			instruction: 'Type the reading, in hiragana, of the highlighted word.',
			sentence: '彼の気持ちを理解する。',
			kana: 'かれのきもちをり〇〇する。',
			focus: '理解',
			targetSpan: '解',
			answer: 'りかい',
			accepted: ['りかい'],
			hint: 'The first kanji is read り; the second uses the on reading.',
			rationale: '理解 is read りかい.'
		}),
		typed('k-p2', 'produce', {
			form: 'cloze',
			instruction: 'Type the word for "misunderstanding" (use your IME).',
			sentence: 'それは＿＿です。',
			cue: '（ごかい）',
			kana: 'それは＿＿です。',
			targetSpan: '解',
			answer: '誤解',
			accepted: ['誤解'],
			hint: 'Type ごかい and pick the right kanji from the IME list.',
			rationale: '誤解 is "mistaken" + "understanding".'
		}),
		typed('k-p3', 'produce', {
			form: 'cloze',
			instruction: 'Fill the blank with the right form of the verb (negative).',
			sentence: '難しくて、なかなか＿＿＿＿。',
			cue: '（とける, negative）',
			kana: 'むずかしくて、なかなか＿＿＿＿。',
			targetSpan: '解',
			answer: '解けない',
			accepted: ['解けない', 'とけない'],
			hint: 'The kun reading と goes with the okurigana ける.',
			rationale: 'The negative of 解ける is 解けない.'
		}),
		tiles(
			'k-p4',
			'produce',
			{
				targetSpan: '解',
				rationale: 'ようやく (at last) sits just before the verb phrase 解決した.'
			},
			['解決', '問題は', 'した', 'ようやく'],
			['問題はようやく解決した']
		),
		typed('k-p5', 'produce', {
			form: 'cloze',
			instruction: 'Choose the compound that fits the blank.',
			sentence: '先生の＿＿のおかげで、文法がよく分かった。',
			cue: '（解説 / 解決 / 解散 / 誤解）',
			kana: 'せんせいの＿＿のおかげで、ぶんぽうがよくわかった。',
			targetSpan: '解',
			answer: '解説',
			accepted: ['解説'],
			hint: 'Which compound means "explanation"?',
			rationale: "先生の解説: the teacher's explanation."
		}),
		// Use (3)
		claude(
			'k-x1',
			'use',
			{
				instruction: 'Say: "I think there was a misunderstanding."',
				targetSpan: '解',
				rationale: 'Use 誤解 with ある: 誤解があったと思います.'
			},
			['誤解があったと思います']
		),
		claude(
			'k-x2',
			'use',
			{
				instruction: 'Tell a friend casually that the landlord problem is sorted.',
				targetSpan: '解',
				rationale: 'Casual sentence-final よ with 解決した: もう解決したよ.'
			},
			['もう解決したよ']
		),
		claude(
			'k-x3',
			'use',
			{
				instruction:
					'Write a sentence with any compound of the target kanji, other than the word for "understanding".',
				targetSpan: '解',
				free: true,
				rationale: 'Any natural compound works: 解決, 解説, 誤解, 解散 and so on.'
			},
			[]
		)
	]
};
