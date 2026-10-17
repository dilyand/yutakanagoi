import { NO_ROMAJI_NOTE, UNTRUSTED_INPUT_NOTE, tagUntrusted } from '$lib/server/claude-shared';
import { MAX_CANDIDATES } from '$lib/target-practice/lookup';
import type { ConfirmedTarget } from '$lib/target-practice/lookup';
import type { TargetType } from '$lib/target-practice/types';

/**
 * Prompts for target practice's lookup step (candidate picker + target card).
 * Prompt text lives here, apart from the call plumbing in lookup.ts, so the
 * generation prompts in a later slice can share LEARNER_LEVEL and be tuned in
 * the same place. Learner-supplied and client-round-tripped text (the input,
 * and a candidate's reading/gloss) always goes in <untrusted> tags.
 */

/**
 * The one level knob (design doc §6): no per-session setting. Matches the app's
 * master word list, so unknown kanji in example sentences stay rare.
 */
export const LEARNER_LEVEL =
	'Write every Japanese example sentence for an intermediate learner: use vocabulary from roughly ' +
	'the 2000 most frequent Japanese words, apart from the target itself, so unfamiliar kanji stay rare.';

const TYPE_LABEL: Record<TargetType, string> = {
	word: 'a single Japanese word',
	kanji: 'a single kanji character',
	set_phrase:
		'a set phrase: a fixed expression with no open slot, proverbs included (not a 四字熟語)',
	grammar: 'a grammar pattern: a form with an open slot, written with 〜',
	contrast: 'two items to tell apart (a pair of words, patterns or phrases)'
};

// --- Candidate step ------------------------------------------------------

const CANDIDATE_SCOPE: Partial<Record<TargetType, string>> = {
	word:
		'The learner wants to study one Japanese word. The input is either English or Japanese. ' +
		'If it is English, list the Japanese words a learner most plausibly means, most common ' +
		'first (to run → 走る). If it is Japanese, list the distinct words that share this spelling ' +
		'but differ in reading or meaning (人気 → にんき "popularity" and ひとけ "signs of people"); ' +
		'for kana-only input also list the common kanji words it could be (たべる → 食べる; はし → ' +
		'橋, 箸, 端). If only one word fits, return exactly one candidate. Each target must be a ' +
		'single word in dictionary form — never a phrase, a pattern, or an inflected form — written ' +
		'the way a learner normally sees it (kanji where the usual spelling uses kanji, kana where it ' +
		'is usually written in kana).',
	grammar:
		'The learner wants to study one Japanese grammar pattern, described in English. List the ' +
		'patterns they most plausibly mean, most common first, including the closest confusable ' +
		'ones when the description fits several ("whether or not" → 〜かどうか, 〜ても〜なくても). ' +
		'Write each target in 〜 notation, with 〜 where the open slot is and any optional part in ' +
		'ASCII parentheses (〜(よ)うとする). Never return a single vocabulary word or a full sentence.'
};

export function candidatePrompt(type: TargetType, input: string): { system: string; user: string } {
	const scope = CANDIDATE_SCOPE[type];
	if (!scope) throw new Error(`The candidate step does not apply to ${type}`);
	return {
		system:
			`${scope} ` +
			`Return at most ${MAX_CANDIDATES} candidates, each distinct. For each: "target" (Japanese), ` +
			'"reading" (the whole target in hiragana — katakana only for katakana words; keep 〜 where ' +
			'the slot is, and spell optional parts out in full), and "gloss" (English, under 12 words, ' +
			'specific enough to tell the candidates apart). Only list things you are confident exist; ' +
			'never invent one to reach a count. If nothing fits, return an empty list. ' +
			`${NO_ROMAJI_NOTE} ${UNTRUSTED_INPUT_NOTE}`,
		user: `Input: ${tagUntrusted(input)}`
	};
}

// --- Card step -----------------------------------------------------------

const CARD_COMMON =
	'You write the target card a Japanese learner reads before drilling one target. Every later ' +
	'exercise is generated from this card, so accuracy matters more than completeness: include only ' +
	'what you are confident is correct, and no more than the limits below. ' +
	'Write English fields in English and Japanese fields in Japanese. Readings are kana only. ' +
	`${LEARNER_LEVEL} ` +
	'The target is given exactly as the learner confirmed it. Never change it, respell it, or ' +
	'substitute a different word that happens to share its reading or kanji; if a reading or ' +
	'meaning is supplied, it tells you which word is meant — conform to it. ' +
	'"rule" is a one-line takeaway in English (under 25 words) that the learner will see again at ' +
	'the end of the session. Each "modelSentences" entry is a natural Japanese sentence that ' +
	'contains the target (in whatever inflected form fits), with no English. ' +
	'Each type covers one kind of thing, and the learner chose the type; if the target is not that ' +
	'kind of thing (see the decline rules for this type below), do not write a card for it. ' +
	'Decline instead, even though you could stretch the card to fit: return "reason" (one English ' +
	'sentence) and "suggestedType" — the type that fits, from word, kanji, set_phrase, grammar, ' +
	'contrast, or none if no type fits. Never decline just because a target is unusual, archaic or ' +
	'hard, or because a word appears in an inflected form.';

const CARD_DECLINE: Record<TargetType, string> = {
	word:
		'Decline for WORD if the target is a fixed expression, greeting, idiom or proverb ' +
		'(お疲れ様です, 猿も木から落ちる → set_phrase), or a pattern with an open slot (→ grammar).',
	kanji: 'Decline for KANJI if the target is not a single kanji character (→ word).',
	set_phrase:
		'Decline for SET PHRASE if the target is a single ordinary word (食べる → word), or a ' +
		'pattern with an open slot (→ grammar).',
	grammar:
		'Decline for GRAMMAR if the target is a single ordinary word (食べる → word), or a fixed ' +
		'expression with no open slot (→ set_phrase).',
	contrast: 'Decline for CONTRAST as described at the end of the CONTRAST card rules.'
};

const CARD_FIELDS: Record<TargetType, string> = {
	word:
		'WORD card. "reading": the whole word in kana. "senses": the 1 to 4 main senses, most common ' +
		'first, ids 1, 2, 3…, each with a short English "gloss" and a Japanese "example" sentence; ' +
		'a word with one sense gets one entry. "lessCommonSenses": how many further senses you left ' +
		'out (0 if none). "forms": 2 to 5 common inflected or derived forms (厳しくない, 厳しかった, ' +
		'厳しく). "modelSentences": 2 or 3, spread across the senses.',
	kanji:
		'KANJI card. "meaning": the core meaning in a few English words. "readings": the common ' +
		'readings, kana only, each with "kana" (the kun reading is the stem only — と, not と(く)), ' +
		'"kind" ("on" or "kun"), "okurigana" (kun readings only, when there is one: く), and "rare". ' +
		'Mark at most one reading "rare": a real reading used in only a few words (ゲ in 解熱); every ' +
		'other reading is not rare. "compounds": 5 to 7 common words that contain the kanji, each ' +
		'with kana "reading" and a short English "gloss". "modelSentences": 2 or 3, using common ' +
		'compounds.',
	set_phrase:
		'SET PHRASE card. "reading": the whole phrase in kana. "meaning": what it says or does, in ' +
		'English. "uses": 1 to 3 short descriptions of when it is used. "variants": up to 3 related ' +
		'forms (casual, past, polite…), each with "text" and an English "note". "register": one ' +
		'line on politeness and who it suits. "watchOuts": up to 3 common mistakes or look-alikes ' +
		'(for a greeting, the phrase learners confuse it with). "modelSentences": 2 or 3 short ' +
		'lines of dialogue or text where it is used.',
	grammar:
		'GRAMMAR card. "reading": the pattern in kana (〜 optional). "form": how it attaches, ' +
		'including nouns and な-adjectives where they differ. "use": what it expresses and how it is ' +
		'typically used, in one or two sentences. "watchOut": the most common misunderstanding or ' +
		'look-alike pattern. "neighbours": 1 to 3 closest confusable patterns in 〜 notation. ' +
		'"modelSentences": 2 or 3.',
	contrast:
		'CONTRAST card. "sides": exactly two entries in the order given, each with "form" copied ' +
		'exactly from the input, kana "reading", and an English "meaning" focused on how it differs. ' +
		'"axis": the one dimension the pair differs on, in a sentence. "rule": a one-line decision ' +
		'rule for choosing between them. "commonMistake": the most common learner error, with a ' +
		'wrong example marked ✗. "minimalPair": exactly two sentences, one per side in the order ' +
		'given, identical except for the contrast. "contrastKind": "transitivity_pair" (a transitive ' +
		'and intransitive pair), "near_synonym", "grammar" (two patterns), or "similar_kanji" (two ' +
		'look-alike kanji; classify honestly, this kind is not supported yet). "modelSentences": 2 or ' +
		'3, mixing both sides. Decline (suggestedType "none") if the two items are not the same ' +
		'kind of thing (a word against a pattern) or are not something a learner would confuse, ' +
		'so there is nothing sensible to tell apart.'
};

export function cardPrompt(confirmed: ConfirmedTarget): { system: string; user: string } {
	const { type } = confirmed;
	const lines = [`Type: ${type} — ${TYPE_LABEL[type]}`];
	if (confirmed.sides) {
		lines.push(
			`Item 1 (side a): ${tagUntrusted(confirmed.sides[0])}`,
			`Item 2 (side b): ${tagUntrusted(confirmed.sides[1])}`
		);
	} else {
		lines.push(`Target: ${tagUntrusted(confirmed.target)}`);
	}
	if (confirmed.reading) lines.push(`Reading: ${tagUntrusted(confirmed.reading)}`);
	if (confirmed.gloss) lines.push(`Meaning: ${tagUntrusted(confirmed.gloss)}`);

	return {
		system: `${CARD_COMMON} ${CARD_DECLINE[type]} ${CARD_FIELDS[type]} ${NO_ROMAJI_NOTE} ${UNTRUSTED_INPUT_NOTE}`,
		user: lines.join('\n')
	};
}
