import { claude, mc, right, tiles, typed, wrong } from './build';
import type { Fixture } from './build';
import type { GrammarCard } from '../types';

/** A1 — Grammar, 〜かどうか (reached via the English "whether or not"). */
const card: GrammarCard = {
	ok: true,
	type: 'grammar',
	target: '〜かどうか',
	reading: 'かどうか',
	rule: 'かどうか turns a yes/no question into a clause you can know, ask or decide.',
	modelSentences: [
		'彼が結婚しているかどうか、誰も知らない。',
		'新しい店がおいしいかどうか、食べてみないと分かりません。',
		'この答えが正しいかどうか、先生に聞いてみよう。'
	],
	form: 'Plain form + かどうか. For nouns and な-adjectives drop だ (本当かどうか).',
	use: 'Embeds a yes/no question inside a larger sentence, usually with 分かる, 知る, 調べる, 確かめる or 決める.',
	watchOut: 'Not "regardless of whether" — that is ても〜なくても.',
	neighbours: ['〜ても〜なくても', '〜か否か']
};

const ONE_PATTERN = 'misread_similar_pattern:ても〜なくても';
const QUESTION_WORD = 'misread_similar_pattern:question-word か';

export const grammarKakadouka: Fixture = {
	name: 'A1 grammar 〜かどうか',
	card,
	items: [
		// Understand (4)
		mc(
			'g-u1',
			'understand',
			{
				instruction: 'What does this sentence mean?',
				sentence: '彼が来るかどうか、まだ分かりません。',
				kana: 'かれがくるかどうか、まだわかりません。',
				targetSpan: 'かどうか',
				rationale:
					'かどうか embeds a yes/no question: "whether he is coming". It is not "regardless of".'
			},
			[
				right("I don't know yet whether he's coming"),
				wrong('It makes no difference whether he comes', ONE_PATTERN),
				wrong("I don't know who is coming", QUESTION_WORD),
				wrong("I'm sure he's coming", 'opposite')
			]
		),
		mc(
			'g-u2',
			'understand',
			{
				instruction: 'What is everyone wondering?',
				sentence: '先生が来週の試験を延期するかどうか、みんな知りたがっている。',
				kana: 'せんせいがらいしゅうのしけんをえんきするかどうか、みんなしりたがっている。',
				targetSpan: 'かどうか',
				rationale:
					'みんな知りたがっている is about the yes/no question "will the teacher postpone it?".'
			},
			[
				right("Whether the teacher will postpone next week's exam"),
				wrong('When the teacher will postpone it', QUESTION_WORD),
				wrong('Everyone wants it postponed whether or not the teacher agrees', ONE_PATTERN),
				wrong('Whether everyone will take the exam', 'context')
			]
		),
		mc(
			'g-u3',
			'understand',
			{
				instruction: 'Which sentence says the speaker decided whether to eat at all?',
				targetSpan: 'かどうか',
				rationale:
					'食べるかどうか is the yes/no question "eat or not"; 何を / いつ ask for a thing or a time.'
			},
			[
				wrong('何を食べるか決めた', QUESTION_WORD),
				right('食べるかどうか決めた'),
				wrong('いつ食べるか決めた', QUESTION_WORD)
			]
		),
		mc(
			'g-u4',
			'understand',
			{
				instruction: "Why can't B answer yet?",
				sentence:
					'A: 明日のパーティー、来る？ B: 仕事が終わるかどうか分からないから、まだ返事できない。',
				kana: 'A: あしたのパーティー、くる？ B: しごとがおわるかどうかわからないから、まだへんじできない。',
				targetSpan: 'かどうか',
				rationale: 'B does not know yet whether work will be finished, so the answer has to wait.'
			},
			[
				right("B doesn't know if work will be finished in time"),
				wrong('B will come whether or not work gets finished', ONE_PATTERN),
				wrong("B doesn't know when work will finish", QUESTION_WORD),
				wrong('B dislikes parties', 'context')
			]
		),
		// Produce (5)
		typed('g-p1', 'produce', {
			form: 'cloze',
			instruction: 'Fill the blank with the target pattern.',
			sentence: '明日は雨が降る＿＿分からない。',
			kana: 'あしたはあめがふる＿＿わからない。',
			targetSpan: 'かどうか',
			answer: 'かどうか',
			accepted: ['かどうか'],
			hint: 'You need the pattern that turns the yes/no question into a clause.',
			rationale: '降る + かどうか gives "whether it will rain", the thing that is not known.'
		}),
		typed('g-p2', 'produce', {
			form: 'cloze',
			instruction: 'Fill the blank with the target pattern.',
			sentence: 'この情報は本当＿＿確かめたい。',
			kana: 'このじょうほうはほんとう＿＿たしかめたい。',
			targetSpan: 'かどうか',
			answer: 'かどうか',
			accepted: ['かどうか'],
			hint: 'After a noun, the pattern attaches directly — there is no だ.',
			rationale: 'Nouns and な-adjectives drop だ: 本当かどうか, not 本当だかどうか.'
		}),
		typed('g-p3', 'produce', {
			form: 'cloze',
			instruction: 'Fill the blank with the right form of the verb.',
			sentence: '彼が昨日学校に＿＿かどうか、覚えていない。',
			cue: '（来る）',
			kana: 'かれがきのうがっこうに＿＿かどうか、おぼえていない。',
			targetSpan: 'かどうか',
			answer: '来た',
			accepted: ['来た', 'きた'],
			hint: 'The event was yesterday, and the tense lives inside the clause.',
			rationale: 'The tense is marked inside the clause: 来たかどうか, "whether he came".'
		}),
		tiles(
			'g-p4',
			'produce',
			{
				targetSpan: 'かどうか',
				rationale: 'The clause 店が開いているかどうか is the object of 調べてみます.'
			},
			['かどうか', '店が', 'みます', '開いている', '調べて'],
			['店が開いているかどうか調べてみます']
		),
		typed('g-p5', 'produce', {
			form: 'free',
			instruction: 'Say in Japanese: "I want to know whether this train goes to Osaka."',
			targetSpan: 'かどうか',
			answer: 'この電車は大阪に行くかどうか知りたい',
			accepted: ['この電車は大阪に行くかどうか知りたい', 'この電車は大阪へ行くかどうか知りたい'],
			hint: 'Put the yes/no clause (goes to Osaka or not) before 知りたい.',
			rationale:
				'大阪に行くかどうか is the embedded question; 知りたい is the verb that wants the answer.'
		}),
		// A spare for the Produce phase.
		typed('g-spare1', 'produce', {
			spare: true,
			form: 'cloze',
			instruction: 'Fill the blank with the target pattern.',
			sentence: '先生が来る＿＿確認してください。',
			kana: 'せんせいがくる＿＿かくにんしてください。',
			targetSpan: 'かどうか',
			answer: 'かどうか',
			accepted: ['かどうか'],
			hint: 'You are asking someone to check a yes/no fact.',
			rationale: '来る + かどうか is "whether the teacher is coming".'
		}),
		// Use (3 guided + 1 free)
		claude(
			'g-x1',
			'use',
			{
				instruction: 'Combine the two sentences into one using the target pattern.',
				sentence: 'この店は安いですか。調べてみます。',
				kana: 'このみせはやすいですか。しらべてみます。',
				targetSpan: 'かどうか',
				rationale: 'The question becomes a clause: この店が安いかどうか調べてみます.'
			},
			['この店が安いかどうか調べてみます']
		),
		claude(
			'g-x2',
			'use',
			{
				instruction: 'Turn the quoted question into reported speech with the target pattern.',
				sentence: '「田中さんは来ますか」と山田さんに聞いた。',
				kana: '「たなかさんはきますか」とやまださんにきいた。',
				targetSpan: 'かどうか',
				rationale: 'Reported yes/no questions use かどうか: 田中さんが来るかどうか山田さんに聞いた.'
			},
			['田中さんが来るかどうか山田さんに聞いた']
		),
		claude(
			'g-x3',
			'use',
			{
				instruction:
					'A friend asks how your exam went (the sentence below). You have not looked at the result yet. Reply using the target pattern.',
				sentence: '試験の結果、どうだった？',
				kana: 'しけんのけっか、どうだった？',
				targetSpan: 'かどうか',
				rationale: 'You do not know the yes/no answer, so: 合格したかどうか分からない.'
			},
			['まだ見てないから、合格したかどうか分からない']
		),
		claude(
			'g-x4',
			'use',
			{
				instruction:
					'Write one sentence about something you are unsure of this week, using the target pattern.',
				targetSpan: 'かどうか',
				free: true,
				rationale: 'Any yes/no uncertainty works: 行けるかどうか分からない.'
			},
			[]
		),
		// Contrast (3): spot the error. The option marked right is the faulty sentence (the
		// answer to "which one has the error?"); the other three are sound sentences.
		mc(
			'g-c1',
			'contrast',
			{
				instruction: 'One of these sentences misuses the target pattern. Which one has the error?',
				targetSpan: 'かどうか',
				rationale:
					'雨が降るかどうか、試合は行われる。 says the match is held "whether it rains" — かどうか introduces something unknown. "Regardless of rain" is 雨が降っても降らなくても、試合は行われる。'
			},
			[
				right('雨が降るかどうか、試合は行われる。'),
				wrong(
					'雨が降るかどうか、まだ分からない。',
					'context',
					'Correct: かどうか introduces the unknown.'
				),
				wrong(
					'雨が降っても降らなくても、試合は行われる。',
					ONE_PATTERN,
					'Correct: this is the "regardless" pattern.'
				),
				wrong(
					'雨が降るかどうか、天気予報を確認した。',
					'context',
					'Correct: he checked whether it would rain.'
				)
			]
		),
		mc(
			'g-c2',
			'contrast',
			{
				instruction: 'One of these sentences misuses the target pattern. Which one has the error?',
				targetSpan: 'かどうか',
				rationale:
					'After a noun or な-adjective the だ is dropped: 本当かどうか, not 本当だかどうか.'
			},
			[
				right('この話が本当だかどうか、確かめたい。'),
				wrong(
					'この話が本当かどうか、確かめたい。',
					'context',
					'Correct: だ is dropped before かどうか.'
				),
				wrong(
					'新しい店が安いかどうか、調べてみる。',
					'context',
					'Correct: い-adjective, plain form.'
				),
				wrong('彼が元気かどうか、心配です。', 'context', 'Correct: な-adjective, だ dropped.')
			]
		),
		mc(
			'g-c3',
			'contrast',
			{
				instruction: 'One of these sentences misuses the target pattern. Which one has the error?',
				targetSpan: 'かどうか',
				rationale:
					'The pattern needs か before どうか: 彼が来たかどうか. 彼が来たどうか is not a sentence.'
			},
			[
				right('彼が来たどうか、知りたい。'),
				wrong('彼が来たかどうか、知りたい。', 'context', 'Correct: past plain form + かどうか.'),
				wrong(
					'行くか行かないか、まだ決めていない。',
					ONE_PATTERN,
					'Correct: the か〜か pattern for two named options.'
				),
				wrong(
					'来週のテストが難しいかどうか、先生に聞いた。',
					'context',
					'Correct: embedded yes/no question.'
				)
			]
		)
	]
};
