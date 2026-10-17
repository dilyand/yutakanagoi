import { claude, mc, right, tiles, typed, wrong } from './build';
import type { Fixture } from './build';
import type { ContrastCard } from '../types';

/** A2 — Contrast, 決める vs 決まる. Coverage: side:a = 決める, side:b = 決まる. */
const card: ContrastCard = {
	ok: true,
	type: 'contrast',
	target: '決める vs 決まる',
	rule: 'Is the focus on the person doing the deciding (決める) or on the outcome being settled (決まる)?',
	modelSentences: ['私は来月の予定を決めた。', 'パーティーの場所がやっと決まった。'],
	axis: 'Is a person doing the deciding, or is something simply settled?',
	sides: [
		{
			form: '決める',
			reading: 'きめる',
			meaning: 'to decide (transitive, 〜を決める): someone makes the decision'
		},
		{
			form: '決まる',
			reading: 'きまる',
			meaning: 'to be decided (intransitive, 〜が決まる): the result is settled, no one in focus'
		}
	],
	commonMistake: '日程が決めた ✗ / 日程を決まった ✗',
	minimalPair: ['日程を決めた。', '日程が決まった。'],
	contrastKind: 'transitivity_pair'
};

export const contrastKimeruKimaru: Fixture = {
	name: 'A2 contrast 決める vs 決まる',
	card,
	items: [
		// Understand (3)
		mc(
			'c-u1',
			'understand',
			{
				instruction: 'What does this mean?',
				sentence: '来月の旅行の行き先が決まった。',
				kana: 'らいげつのりょこうのいきさきが〇〇。',
				targetSpan: '決まった',
				coverage: 'side:b',
				rationale: '行き先が決まった: the destination is settled; nobody is in focus.'
			},
			[
				right('The destination is settled'),
				wrong('The speaker is still deciding', 'wrong_side'),
				wrong('The trip was cancelled', 'unrelated')
			]
		),
		mc(
			'c-u2',
			'understand',
			{
				instruction: 'Who made the decision?',
				sentence: '田中さんは、来年留学することに決めたそうだ。',
				kana: 'たなかさんは、らいねんりゅうがくすることに〇〇そうだ。',
				targetSpan: '決めた',
				coverage: 'side:a',
				rationale: '〜ことに決めた names the person who decided: 田中さん.'
			},
			[
				right('田中さん'),
				wrong('His parents', 'context'),
				wrong('His company', 'context'),
				wrong('Not stated', 'wrong_side')
			]
		),
		mc(
			'c-u3',
			'understand',
			{
				instruction: 'What is the situation?',
				sentence: 'A: 会議の日程、どうなった？ B: まだ誰も決めていないよ。',
				kana: 'A: かいぎのにってい、どうなった？ B: まだだれも〇〇ていないよ。',
				targetSpan: '決め',
				coverage: 'side:a',
				rationale: '誰も決めていない: nobody has made the decision yet.'
			},
			[
				right('Nobody has made the decision yet'),
				wrong('The date is already settled', 'wrong_side'),
				wrong('Everyone has agreed', 'opposite')
			]
		),
		// Sort (5)
		mc(
			'c-s1',
			'sort',
			{
				instruction: 'Which verb fits? "I\'ve made up my mind: I\'m quitting."',
				targetSpan: '決めた',
				coverage: 'side:a',
				rationale: 'The speaker is the decider, so 〜を決めた / 決めた.'
			},
			[right('決めた'), wrong('決まった', 'wrong_side')]
		),
		mc(
			'c-s2',
			'sort',
			{
				instruction: 'Which verb fits? "The meeting time was set, and nobody asked me."',
				targetSpan: '決まった',
				coverage: 'side:b',
				rationale: 'The time was settled without the speaker in the picture: 決まった.'
			},
			[wrong('決めた', 'wrong_side'), right('決まった')]
		),
		mc(
			'c-s3',
			'sort',
			{
				instruction: 'Which verb fits the blank?',
				sentence: '優勝チームは、昨日の試合で＿＿。',
				kana: 'ゆうしょうチームは、きのうのしあいで＿＿。',
				targetSpan: '決まった',
				coverage: 'side:b',
				rationale: 'The winner is an outcome, not a decision anyone made: 決まった.'
			},
			[right('決まった'), wrong('決めた', 'wrong_side')]
		),
		mc(
			'c-s4',
			'sort',
			{
				instruction: 'Which verb fits the blank?',
				sentence: 'どの大学に行くか、自分で＿＿。',
				kana: 'どのだいがくにいくか、じぶんで＿＿。',
				targetSpan: '決めた',
				coverage: 'side:a',
				rationale: '自分で signals the person deciding: 決めた.'
			},
			[wrong('決まった', 'wrong_side'), right('決めた')]
		),
		mc(
			'c-s5',
			'sort',
			{
				instruction: 'Which sentence is ungrammatical?',
				targetSpan: '決まった',
				coverage: 'side:b',
				rationale: '決まる is intransitive, so it cannot take を: 行き先が決まった.'
			},
			[wrong('行き先を決めた'), wrong('行き先が決まった'), right('行き先を決まった')]
		),
		// Produce (4)
		typed('c-p1', 'produce', {
			form: 'cloze',
			instruction: 'Fill the blank with the right form.',
			sentence: '先週、引っ越しの日が＿＿。',
			cue: '（決まる）',
			kana: 'せんしゅう、ひっこしのひが＿＿。',
			targetSpan: '決まった',
			answer: '決まった',
			accepted: ['決まった', 'きまった'],
			hint: 'The date is the subject (が), so it is the settled verb, in the past.',
			rationale: '引っ越しの日が takes 決まった: the date is settled.'
		}),
		typed('c-p2', 'produce', {
			form: 'cloze',
			instruction: 'Fill the blank with the right form.',
			sentence: '私は来年、大学院に行くことに＿＿。',
			cue: '（決める）',
			kana: 'わたしはらいねん、だいがくいんにいくことに＿＿。',
			targetSpan: '決めた',
			answer: '決めた',
			accepted: ['決めた', 'きめた'],
			hint: 'The speaker (私) is the one deciding, in the past.',
			rationale: '私は…ことに決めた: the speaker made the decision.'
		}),
		tiles(
			'c-p3',
			'produce',
			{
				targetSpan: '決め',
				rationale: '日程を (object) goes with the transitive 決めましょう.'
			},
			['決めましょう', 'みんなで', '日程を'],
			['みんなで日程を決めましょう']
		),
		typed('c-p4', 'produce', {
			form: 'cloze',
			instruction: 'Complete the sentence: "The destination was settled."',
			sentence: '行き先＿＿＿＿。',
			kana: 'いきさき＿＿＿＿。',
			targetSpan: '決まった',
			answer: 'が決まった',
			accepted: ['が決まった', 'がきまった'],
			hint: 'Start with the particle that marks the settled thing.',
			rationale: 'Marking the settled thing with が + 決まった gives 行き先が決まった.'
		}),
		// Use (3)
		claude(
			'c-x1',
			'use',
			{
				instruction: 'Rewrite so that the result, not the person, is the focus.',
				sentence: '私たちは日程を決めた。',
				kana: 'わたしたちはにっていを〇〇。',
				targetSpan: '決めた',
				rationale: '日程が決まった puts the outcome in focus.'
			},
			['日程が決まった']
		),
		claude(
			'c-x2',
			'use',
			{
				instruction: 'Rewrite with "we" as the ones who decided.',
				sentence: '結婚式の場所が決まった。',
				kana: 'けっこんしきのばしょが〇〇。',
				targetSpan: '決まった',
				rationale:
					'Make the decider the topic and the place the object: 私たちは結婚式の場所を決めた.'
			},
			['私たちは結婚式の場所を決めた']
		),
		claude(
			'c-x3',
			'use',
			{
				instruction: 'Write two sentences about your own life, one with each verb.',
				targetSpan: '決める',
				free: true,
				rationale: 'One sentence with a decider and を, one with an outcome and が.'
			},
			[]
		)
	]
};
