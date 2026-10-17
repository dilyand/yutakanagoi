import { claude, mc, right, tiles, typed, wrong } from './build';
import type { Fixture } from './build';
import type { WordCard } from '../types';

/** A3 — Word, 厳しい. Senses: 1 strict, 2 harsh/severe, 3 tough/unlikely. */
const card: WordCard = {
	ok: true,
	type: 'word',
	target: '厳しい',
	reading: 'きびしい',
	rule: 'Ask what is being described: a person or rule (strict), weather or criticism (harsh), or a situation or chance (tough, unlikely).',
	modelSentences: ['この学校は規則が厳しい。', '社長から厳しい批判を受けた。'],
	senses: [
		{ id: 1, gloss: 'strict (people, rules)', example: '先生は厳しい。' },
		{
			id: 2,
			gloss: 'harsh, severe (weather, criticism, reality)',
			example: '厳しい寒さが続いている。'
		},
		{
			id: 3,
			gloss: 'tough, unlikely (situations, chances)',
			example: '今の状況では、合格は厳しい。'
		}
	],
	forms: ['厳しくない', '厳しかった', '厳しく (adverb: 厳しく叱る)'],
	lessCommonSenses: 0
};

export const wordKibishii: Fixture = {
	name: 'A3 word 厳しい',
	card,
	items: [
		// Understand (4)
		mc(
			'w-u1',
			'understand',
			{
				instruction: 'What does this mean?',
				sentence: '母は私の成績にとても厳しい。',
				kana: 'ははわたしのせいせきにとても〇〇。',
				targetSpan: '厳しい',
				coverage: 'sense:1',
				rationale: 'A person who is 厳しい about something is strict about it.'
			},
			[
				right('My mother is strict about my grades'),
				wrong('My grades are in a tough spot', 'other_sense:3'),
				wrong('My mother is anxious about my grades', 'context')
			]
		),
		mc(
			'w-u2',
			'understand',
			{
				instruction: 'What does this mean?',
				sentence: '厳しい寒さの中、彼らは山を登り続けた。',
				kana: '〇〇さむさのなか、かれらはやまをのぼりつづけた。',
				targetSpan: '厳しい',
				coverage: 'sense:2',
				rationale: '厳しい寒さ is bitter, severe cold — the harsh sense.'
			},
			[
				right('They kept climbing in bitter cold'),
				wrong('They kept climbing under a strict leader', 'other_sense:1'),
				wrong('They kept climbing even though their chances were slim', 'other_sense:3'),
				wrong('They kept climbing until the cold ended', 'context')
			]
		),
		mc(
			'w-u3',
			'understand',
			{
				instruction: 'What does B mean?',
				sentence: 'A: 来週までに終わりそう？ B: うーん、ちょっと厳しいかな。',
				kana: 'A: らいしゅうまでにおわりそう？ B: うーん、ちょっと〇〇かな。',
				targetSpan: '厳しい',
				coverage: 'sense:3',
				rationale: 'ちょっと厳しい about a deadline means it looks unlikely to work out.'
			},
			[
				right('Finishing by next week looks unlikely'),
				wrong('The schedule is too strict', 'other_sense:1'),
				wrong("B is being harsh about A's work", 'other_sense:2'),
				wrong("It'll be easy", 'opposite')
			]
		),
		mc(
			'w-u4',
			'understand',
			{
				instruction: 'Which option uses the target word in the same sense as the sentence below?',
				sentence: '来月は予定が詰まっていて、参加は厳しい。',
				kana: 'らいげつはよていがつまっていて、さんかは〇〇。',
				targetSpan: '厳しい',
				coverage: 'sense:3',
				rationale:
					'Both the prompt and 資金繰りが厳しい describe a situation that is tough or unlikely.'
			},
			[
				wrong('彼女は自分に厳しい', 'other_sense:1'),
				wrong('厳しい冬だった', 'other_sense:2'),
				right('今月は資金繰りが厳しい')
			]
		),
		// Sense (3)
		mc(
			'w-s1',
			'sense',
			{
				instruction: 'Which sense of the target word is used here?',
				sentence: '厳しい校則のせいで、髪を染められない。',
				kana: '〇〇こうそくのせいで、かみをそめられない。',
				targetSpan: '厳しい',
				coverage: 'sense:1',
				rationale: 'School rules are strict.'
			},
			[right('strict'), wrong('harsh', 'other_sense:2'), wrong('tough / unlikely', 'other_sense:3')]
		),
		mc(
			'w-s2',
			'sense',
			{
				instruction: 'Which sense of the target word is used here?',
				sentence: '今年の冬は例年より厳しかった。',
				kana: 'ことしのふゆはれいねんより〇〇。',
				targetSpan: '厳しかった',
				coverage: 'sense:2',
				rationale: 'A winter that is 厳しい is harsh.'
			},
			[wrong('strict', 'other_sense:1'), right('harsh'), wrong('tough / unlikely', 'other_sense:3')]
		),
		mc(
			'w-s3',
			'sense',
			{
				instruction: 'Which sense of the target word is used here?',
				sentence: '今の成績だと、第一志望は厳しいね。',
				kana: 'いまのせいせきだと、だいいちしぼうは〇〇ね。',
				targetSpan: '厳しい',
				coverage: 'sense:3',
				rationale: 'A first-choice school that is 厳しい is a long shot.'
			},
			[wrong('strict', 'other_sense:1'), wrong('harsh', 'other_sense:2'), right('tough / unlikely')]
		),
		// Produce (5)
		typed('w-p1', 'produce', {
			form: 'cloze',
			instruction: 'Fill the blank with the right form of the target word (past).',
			sentence: '去年の冬は今年より＿＿＿＿。',
			cue: '（厳しい, past）',
			kana: 'きょねんのふゆはことしより＿＿＿＿。',
			targetSpan: '厳しかった',
			answer: '厳しかった',
			accepted: ['厳しかった', 'きびしかった'],
			hint: 'い-adjectives form the past by replacing い with かった.',
			rationale: 'The past of 厳しい is 厳しかった.'
		}),
		typed('w-p2', 'produce', {
			form: 'cloze',
			instruction: 'Fill the blank with the right form of the target word (negative).',
			sentence: 'この先生はあまり＿＿＿＿。',
			cue: '（厳しい, negative）',
			kana: 'このせんせいはあまり＿＿＿＿。',
			targetSpan: '厳しくない',
			answer: '厳しくない',
			accepted: ['厳しくない', 'きびしくない'],
			hint: 'い-adjectives form the negative by replacing い with くない.',
			rationale: '厳しい → 厳しくない; あまり goes with a negative.'
		}),
		typed('w-p3', 'produce', {
			form: 'cloze',
			instruction: 'Fill the blank with the adverb form of the target word.',
			sentence: '母は私を＿＿＿＿叱った。',
			cue: '（adverb form）',
			kana: 'はははわたしを＿＿＿＿しかった。',
			targetSpan: '厳しく',
			answer: '厳しく',
			accepted: ['厳しく', 'きびしく'],
			hint: 'To modify a verb, an い-adjective drops い and takes く.',
			rationale: '厳しい → 厳しく modifies 叱った.'
		}),
		tiles(
			'w-p4',
			'produce',
			{
				targetSpan: '厳しかった',
				rationale: '思ったより comes before the adjective it compares.'
			},
			['厳しかった', '思ったより', '試験は'],
			['試験は思ったより厳しかった']
		),
		typed('w-p5', 'produce', {
			form: 'free',
			instruction: 'Say in Japanese: "The company\'s situation is tough right now."',
			targetSpan: '厳しい',
			answer: '会社の状況は今、厳しい',
			accepted: ['会社の状況は今、厳しい', '会社の状況は今厳しい', '今、会社の状況は厳しい'],
			hint: 'Use the tough / unlikely sense, describing a situation (状況).',
			rationale: '状況が厳しい describes a tough situation.'
		}),
		// Use (3)
		claude(
			'w-x1',
			'use',
			{
				instruction:
					'A colleague asks "Can you make tomorrow\'s deadline?" You doubt it. Reply casually, using the target word.',
				targetSpan: '厳しい',
				rationale: 'ちょっと厳しいかも is the natural casual "that looks unlikely".'
			},
			['ちょっと厳しいかも']
		),
		claude(
			'w-x2',
			'use',
			{
				instruction: 'Say that your boss is strict about time.',
				targetSpan: '厳しい',
				rationale: '時間に厳しい: strict about time.'
			},
			['上司は時間に厳しい']
		),
		claude(
			'w-x3',
			'use',
			{
				instruction: 'Write a sentence of your own, ideally in a sense you have not used yet.',
				targetSpan: '厳しい',
				free: true,
				rationale: 'Any of the three senses works if the sentence is natural.'
			},
			[]
		)
	]
};
