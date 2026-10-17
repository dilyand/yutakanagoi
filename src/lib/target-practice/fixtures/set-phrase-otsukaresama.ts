import { claude, mc, right, tiles, typed, wrong } from './build';
import type { Fixture } from './build';
import type { SetPhraseCard } from '../types';

/** A5 — Set phrase, お疲れ様です. */
const card: SetPhraseCard = {
	ok: true,
	type: 'set_phrase',
	target: 'お疲れ様です',
	reading: 'おつかれさまです',
	rule: "お疲れ様です acknowledges a colleague's effort; with external clients use お世話になっております instead.",
	modelSentences: ['お疲れ様です。今日も暑いですね。', '部長、お疲れ様です。'],
	meaning: "Acknowledges someone's effort; the standard workplace greeting.",
	uses: ['Greeting colleagues', 'Opening internal emails', 'お疲れ様でした when leaving'],
	variants: [
		{ text: 'お疲れ', note: 'casual' },
		{ text: 'お疲れ様でした', note: 'leaving or finished' }
	],
	register: 'Polite; fine sideways or upward.',
	watchOuts: [
		'Internal-leaning: external clients get お世話になっております.',
		'ご苦労様 is for people lower in rank.'
	]
};

export const setPhraseOtsukaresama: Fixture = {
	name: 'A5 set phrase お疲れ様です',
	card,
	items: [
		// Understand (4)
		mc(
			'p-u1',
			'understand',
			{
				instruction: 'What is the situation?',
				sentence: 'A: 今日はもう帰ります。お疲れ様でした。 B: お疲れ様でした。',
				kana: 'A: きょうはもうかえります。〇〇。 B: 〇〇。',
				targetSpan: 'お疲れ様でした',
				rationale: 'The phrase is a parting acknowledgement between colleagues, not a complaint.'
			},
			[
				right('Colleagues parting for the day'),
				wrong('A is complaining about being tired', 'literal_misread'),
				wrong("They're meeting for the first time", 'wrong_situation')
			]
		),
		mc(
			'p-u2',
			'understand',
			{
				instruction: 'This is the opening of an email. Who is the likely recipient?',
				sentence: 'お疲れ様です。田中です。会議の資料を送ります。',
				kana: '〇〇。たなかです。かいぎのしりょうをおくります。',
				targetSpan: 'お疲れ様です',
				rationale: 'お疲れ様です opens internal emails to colleagues.'
			},
			[right('A colleague'), wrong('A new client', 'wrong_situation')]
		),
		mc(
			'p-u3',
			'understand',
			{
				instruction: "What is B's tone?",
				sentence: 'A: 先に失礼します。 B: あ、お疲れ！',
				kana: 'A: さきにしつれいします。 B: あ、〇〇！',
				targetSpan: 'お疲れ',
				rationale: 'The clipped お疲れ is casual, between peers or to a junior.'
			},
			[right('Casual, to a peer or junior'), wrong('Formal, to a client', 'wrong_register')]
		),
		mc(
			'p-u4',
			'understand',
			{
				instruction: 'What is A doing?',
				sentence: 'A: 残業ですか。お疲れ様です。 B: ありがとうございます。',
				kana: 'A: ざんぎょうですか。〇〇。 B: ありがとうございます。',
				targetSpan: 'お疲れ様です',
				rationale: 'B thanks A, which fits an acknowledgement of effort.'
			},
			[
				right("Acknowledging B's effort"),
				wrong('Asking whether B is tired', 'literal_misread'),
				wrong('Criticizing the overtime', 'opposite')
			]
		),
		// Situation (3) — S2's answer is NOT the target
		mc(
			'p-s1',
			'situation',
			{
				instruction: 'You pass a coworker in the corridor at 2pm. What do you say?',
				targetSpan: 'お疲れ様です',
				rationale: 'A daytime greeting between colleagues is お疲れ様です.'
			},
			[
				right('お疲れ様です'),
				wrong('お世話になっております', 'wrong_situation'),
				wrong('ご苦労様です', 'wrong_register')
			]
		),
		mc(
			'p-s2',
			'situation',
			{
				instruction: 'You are opening an email to a new external client. Which phrase fits?',
				targetSpan: 'お疲れ様です',
				rationale: 'External clients get お世話になっております; お疲れ様です is internal-leaning.'
			},
			[
				wrong('お疲れ様です', 'wrong_situation'),
				right('お世話になっております'),
				wrong('ご苦労様です', 'wrong_register')
			]
		),
		mc(
			'p-s3',
			'situation',
			{
				instruction:
					'You are leaving and saying goodbye to colleagues staying late. What do you say?',
				targetSpan: 'お疲れ様でした',
				rationale: 'When leaving, the past form お疲れ様でした is used.'
			},
			[
				right('お疲れ様でした'),
				wrong('いらっしゃいませ', 'unrelated'),
				wrong('おはようございます', 'unrelated')
			]
		),
		// Produce (5)
		typed('p-p1', 'produce', {
			form: 'cloze',
			instruction: "Fill in B's reply.",
			sentence: 'A: 先に失礼します。 B: ＿＿＿＿。',
			kana: 'A: さきにしつれいします。 B: ＿＿＿＿。',
			targetSpan: 'お疲れ様でした',
			answer: 'お疲れ様でした',
			accepted: ['お疲れ様でした', 'お疲れ様です'],
			hint: 'A is leaving; reply with the colleague greeting.',
			rationale: 'Colleagues answer a departing 失礼します with お疲れ様でした.'
		}),
		typed('p-p2', 'produce', {
			form: 'free',
			instruction: 'Say the casual version of the phrase to a peer.',
			targetSpan: 'お疲れ',
			answer: 'お疲れ',
			accepted: ['お疲れ', 'お疲れさま', 'お疲れ様'],
			hint: 'Clip the phrase down for a friendly register.',
			rationale: 'Between peers it shortens to お疲れ.'
		}),
		typed('p-p3', 'produce', {
			form: 'free',
			instruction: 'This opening is wrong for a client. Rewrite it.',
			sentence: 'お疲れ様です、山田です。',
			kana: '〇〇、やまだです。',
			targetSpan: 'お疲れ様です',
			answer: 'お世話になっております。山田です。',
			accepted: ['お世話になっております。山田です。', 'お世話になっております、山田です。'],
			hint: 'External clients get the "thank you for your continued business" greeting.',
			rationale: 'Swap お疲れ様です for お世話になっております when writing to a client.'
		}),
		tiles(
			'p-p4',
			'produce',
			{
				targetSpan: 'お疲れ様でした',
				rationale: 'Either order works: say you are leaving first, or the greeting first.'
			},
			['お疲れ様でした', '失礼します', '先に'],
			['先に失礼します。お疲れ様でした。', 'お疲れ様でした。先に失礼します。']
		),
		typed('p-p5', 'produce', {
			form: 'free',
			instruction: 'Say in Japanese: "Thanks for your work today" (as you leave).',
			targetSpan: 'お疲れ様でした',
			answer: '今日もお疲れ様でした',
			accepted: ['今日もお疲れ様でした', '今日はお疲れ様でした', 'お疲れ様でした'],
			hint: 'Use the past form, since you are leaving.',
			rationale: '今日もお疲れ様でした is the natural leaving phrase.'
		}),
		// Use (3)
		claude(
			'p-x1',
			'use',
			{
				instruction: 'A colleague has just finished a long presentation. Acknowledge their effort.',
				targetSpan: 'お疲れ様でした',
				rationale: 'お疲れ様でした acknowledges something that is finished.'
			},
			['お疲れ様でした。', 'お疲れ様です。']
		),
		claude(
			'p-x2',
			'use',
			{
				instruction: 'Make this casual greeting suitable for your boss.',
				sentence: 'お疲れ！',
				kana: '〇〇！',
				targetSpan: 'お疲れ',
				rationale: 'Use the full polite form to a superior.'
			},
			['お疲れ様です', 'お疲れ様でした']
		),
		claude(
			'p-x3',
			'use',
			{
				instruction: 'Write a two-line end-of-day exchange with a colleague.',
				targetSpan: 'お疲れ様でした',
				free: true,
				rationale: 'One person says they are leaving; the other answers with お疲れ様でした.'
			},
			[]
		)
	]
};
