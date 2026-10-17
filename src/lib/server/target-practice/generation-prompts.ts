import { NO_ROMAJI_NOTE, UNTRUSTED_INPUT_NOTE, tagUntrusted } from '$lib/server/claude-shared';
import { TYPE_TAGS, GENERIC_TAGS } from '$lib/target-practice/distractor-tags';
import { spareQuota } from '$lib/target-practice/generation';
import type { GenerationStage, RegenerationRequest } from '$lib/target-practice/generation';
import { TARGET_MASK } from '$lib/target-practice/normalize';
import { skeletonFor } from '$lib/target-practice/skeleton';
import { cardModelSentences, coverageUniverse } from '$lib/target-practice/validate-items';
import type { Card, PhaseId, TargetType } from '$lib/target-practice/types';
import { LEARNER_LEVEL } from './prompts';

/**
 * Prompts for target practice's two generation stages (design doc §4-§6).
 *
 * The model fills a fixed skeleton from a confirmed card. Every rule below is
 * one validateItems enforces — an item that breaks one is dropped, so the rules
 * are stated as requirements (a timid "try to" is ignored; see the slice-3
 * decline-wording finding) and the reason is given. Counts, tags and coverage
 * keys are read from skeleton.ts / distractor-tags.ts / validate-items.ts, not
 * restated, so the prompt can't drift from the validator.
 *
 * The card comes from the client, so it goes in <untrusted> tags like any
 * other learner-round-tripped text.
 */

// --- Rules shared by every item ----------------------------------------------

const ROLE =
	'You write the practice items for a Japanese learner who is drilling ONE target. The confirmed ' +
	'target card below is the only source of truth about the target: build every item from it, never ' +
	'from your own recall of the target. Your output is checked by a program; an item that breaks any ' +
	'rule below is discarded, so follow each rule exactly.';

const FIELD_RULES = [
	'FIELDS.',
	'- Items are grouped by phase: each phase is its own key under "items" (and under "spares"), and ' +
		'every item must be written for the phase it sits under. A writing ("use") item is never ' +
		'multiple choice.',
	'- "instruction" is English task wording. It may use short grammar labels of one or two ' +
		'characters (な-adjective, て-form, ない-form, だ) but must NOT contain any Japanese word or ' +
		'sentence, not even quoted, and never the target: refer to it as "the target pattern", "the ' +
		'target word" or "the phrase". Every Japanese word or sentence the learner must read goes in ' +
		'"sentence", in the options, or in "cue". Use "" when the item needs no instruction. Do not ' +
		'copy the sentence into the instruction either: write "Combine the two sentences below into ' +
		'one using the target pattern.", not the sentences themselves.',
	'- "sentence" is the Japanese the learner reads: a natural sentence, or a short dialogue with ' +
		'speaker labels (A: … B: …). Use "" when the item has no Japanese prompt.',
	`- "kana" is required whenever "sentence" is not empty: the full sentence in hiragana (katakana ` +
		`words stay katakana), keeping the punctuation and the speaker labels. Replace exactly the ` +
		`reading of the characters in "targetSpan" — and nothing else; never a neighbour pattern or ` +
		`any other word — with ${TARGET_MASK}, so the line does not give the ` +
		`target's reading away (sentence 彼が来るかどうか、まだ分かりません。 with targetSpan かどうか → ` +
		`かれがくる${TARGET_MASK}、まだわかりません。). Use ${TARGET_MASK} only if "targetSpan" literally ` +
		`appears inside "sentence" — when the target is the answer to a blank, the kana line has no ` +
		`${TARGET_MASK}. ${TARGET_MASK} is exactly two characters, once for each occurrence of ` +
		`"targetSpan". A blank ＿＿ is copied as it is and is NEVER replaced by ${TARGET_MASK} (sentence ` +
		`雨が＿＿、まだ分からない。 → あめが＿＿、まだわからない。). Kana, punctuation and speaker labels ` +
		`only: no kanji, no romaji.`,
	'- "targetSpan" is NEVER empty: it is the target exactly as it appears in this item, in the ' +
		'inflected form used (決まった, not 決まる). It must appear in the sentence, an option, an ' +
		'answer or the tiles. An item that is about a neighbour of the target (a contrast, a ' +
		'look-alike) still gets the target as its targetSpan — the target appears in one of its ' +
		'options or answers.',
	'- "rationale" is NEVER empty, on every item including the free writing item: English, why the ' +
		'right answer is right (it is shown after a miss). It may quote Japanese.',
	'- "focus" is a part of "sentence" to highlight, or "". "coverage" is described per type; "" ' +
		'where not asked for.',
	'- Never put a sentence in two items, never reuse or lightly rephrase a sentence from the list ' +
		'"already shown to the learner" in the user message, and never write the same sentence with a ' +
		'different blank. Write every item sentence fresh.'
].join('\n');

const MC_RULES = [
	'MULTIPLE-CHOICE ITEMS ("options").',
	'- 2 to 4 options, all different, exactly ONE with correct: true.',
	'- Every wrong option has a "tag" from the list under TAGS; the correct option has tag "". A ' +
		'wrong option must be plainly wrong to a learner who knows the target, not merely worse.',
	'- Options are short. Put English options in English and Japanese options in Japanese.'
].join('\n');

const TYPED_RULES = [
	'TYPED ITEMS (answer, accepted, form).',
	'- form "cloze": "sentence" has exactly ONE blank written ＿＿ (put each ＿ in the same place in ' +
		'"kana"), the blank is where the answer goes, and the answer must not already appear in the ' +
		'sentence. Filling any accepted answer into the blank must give a clean natural sentence.',
	'- form "free": the learner types a whole answer (a reading, a translation, a rewrite); "sentence" ' +
		'has no ＿＿ (it is the text to read or rewrite, or "" ).',
	'- "answer" is the canonical Japanese answer. "accepted" lists every answer you would mark ' +
		'correct, INCLUDING the canonical one: the kana and kanji spellings, and the plain and polite ' +
		'forms where both are fine. The learner types it, so list real variants, not near-misses.',
	'- "cue" is a short hint such as （来る） shown after the sentence, or "". "hint" is one English ' +
		'line that nudges without giving the answer away.',
	'- The answer must contain Japanese.'
].join('\n');

const TILES_RULES = [
	'TILE ITEMS ("tiles", "accepted").',
	'- 4 to 7 tiles (at least 3), each a natural chunk of a sentence. List "tiles" in the order of ' +
		'ONE correct sentence — the server shuffles them for display.',
	'- "tiles" must not be empty: the tile list IS the item. A translation exercise without tiles is ' +
		'a free typed item instead.',
	'- "accepted" lists EVERY full sentence that can be built by using all the tiles once; if more ' +
		'than one word order is natural, list each. Punctuation is ignored when comparing.',
	'- "instruction" gives the English meaning of the sentence to build, since the tiles alone do ' +
		'not say it.'
].join('\n');

const CLAUDE_RULES = [
	'WRITING ITEMS ("expected", "free"): the learner writes Japanese and an assistant marks it.',
	'- "instruction" sets up a situation or task in English. "sentence" is optional Japanese to work ' +
		'from — if you give one, its "kana" line is required like everywhere else. Put quoted Japanese ' +
		'in "sentence", never in "instruction".',
	'- "expected" holds one or two model answers in Japanese (they are examples, not an answer key). ' +
		'The FINAL writing item of the session is a free "write your own sentence" item: free: true ' +
		'and "expected": []. Every other writing item is guided: free: false with at least one expected ' +
		'answer.'
].join('\n');

// --- Tags ----------------------------------------------------------------------

/** How a tag is written when it takes a parameter; every other tag is just its name. */
const TAG_FORM: Record<string, string> = {
	other_sense: 'other_sense:<n>',
	other_compound: 'other_compound:<word>',
	misread_similar_pattern: 'misread_similar_pattern:<pattern>'
};

const TAG_MEANING: Record<string, string> = {
	other_sense:
		'a real meaning of the word (sense n on the card, never the sense this item is about) ' +
		'used where it does not fit',
	other_compound:
		'another compound of the kanji (write it after the colon) that a reader might pick wrongly',
	other_reading: 'a different real reading of the kanji, used in the wrong place',
	lookalike: 'a similar-looking kanji or word',
	wrong_situation: 'a real phrase that belongs to a different situation',
	wrong_register: 'a real phrase in the right situation but the wrong politeness level',
	literal_misread: 'what the words would mean read literally, not the idiomatic meaning',
	misread_similar_pattern:
		'the meaning of a similar pattern (write the pattern after the colon, e.g. ても〜なくても)',
	wrong_side: 'the meaning of the OTHER member of the pair applied',
	context: 'fits the surrounding context but does not answer the question',
	opposite: 'the opposite of the right answer',
	unrelated: 'plausible-looking but unrelated'
};

function tagsSection(type: TargetType, stage: GenerationStage): string {
	const { required, extra } = TYPE_TAGS[type];
	const line = (name: string) => `  ${TAG_FORM[name] ?? name} — ${TAG_MEANING[name]}`;
	return [
		'TAGS for wrong options (write the tag exactly as shown):',
		stage === 1
			? `- Required in every UNDERSTAND item (at least one wrong option in each): ${required.join(' or ')}. ` +
				'This option must be a valid meaning or use of the target, put where it does not belong — ' +
				'not an obviously silly answer.'
			: '- Every wrong option carries one of these tags.',
		...[...required, ...extra, ...GENERIC_TAGS].map(line)
	].join('\n');
}

// --- Phases ----------------------------------------------------------------------

const PHASE_NOTES: Record<PhaseId, string> = {
	understand: 'multiple choice: comprehension of natural Japanese that contains the target',
	sense: 'multiple choice: which sense of the word a sentence uses',
	reading: 'multiple choice: which reading the highlighted kanji has in a word',
	situation: 'multiple choice: which phrase fits an English situation',
	sort: 'multiple choice with two options: which of the two fits',
	produce: 'typed and tile items: the learner produces the target',
	use: 'writing items: the learner writes Japanese that is marked',
	contrast: 'multiple choice or typed: tell the target from its neighbours'
};

function phasesSection(card: Card, stage: GenerationStage, only?: RegenerationRequest[]): string {
	const spec = skeletonFor(card).filter((p) => p.stage === stage);
	const lines = ['PHASES — one key under "items" for each, every key filled, in this order:'];
	for (const p of spec) {
		const want = only?.find((r) => r.phase === p.id);
		if (only && !want) continue;
		lines.push(`- "${p.id}": ${want ? want.need : p.count} items — ${PHASE_NOTES[p.id]}`);
	}
	if (!only) {
		const quota = spareQuota(card, stage);
		if (quota.length > 0) {
			lines.push(
				'SPARES go under "spares", in the key of their phase (never under "items"): extra ' +
					'reserve items, held to exactly the same rules as the others but different in ' +
					'content: ' +
					quota.map((q) => `${q.count} for "${q.phase}"`).join(', ') +
					'.'
			);
		}
	} else {
		lines.push('There is no "spares" key this time.');
	}
	return lines.join('\n');
}

function coverageSection(card: Card): string {
	const keys = coverageUniverse(card);
	if (keys.length === 0) {
		return 'This card has no coverage keys: set "coverage" to "" on every item.';
	}
	return (
		`COVERAGE keys for this card: ${keys.join(', ')}. ` +
		(card.type === 'contrast'
			? 'side:a is the FIRST item of the pair, side:b the second.'
			: card.type === 'word'
				? 'sense:<n> is sense n on the card.'
				: 'reading:<hiragana> is a reading on the card.')
	);
}

// --- Per-type recipes -------------------------------------------------------------

const STAGE_1_RECIPE: Record<TargetType, (card: Card) => string> = {
	grammar: () =>
		[
			'GRAMMAR — UNDERSTAND. Each item is a natural sentence or short dialogue that contains the ' +
				'pattern and asks what it means or what follows from it (an English question, English ' +
				'options; or Japanese options where the question is "which sentence says …"). NEVER name ' +
				'the pattern in the question or tell the learner it is there. Vary the question: what is ' +
				"meant, what is not known, why can't B answer, which sentence says X. Each item needs a " +
				'misread_similar_pattern distractor — the meaning you would get by misreading the ' +
				"sentence as a similar pattern from the card's watch-out or neighbours (write that " +
				'pattern after the colon).'
		].join('\n'),
	word: (card) =>
		card.type === 'word' && card.senses.length === 1
			? 'WORD (one sense) — UNDERSTAND. Each item is a natural sentence using the word in a ' +
				'different common collocation or context; ask what the sentence means. coverage is ' +
				'"sense:1" on every item. Never ask "what does the word mean" — ask what the sentence ' +
				'says. The card has one sense, so there is no other_sense distractor: tag wrong ' +
				'options context (fits the surroundings, not the sentence), opposite or unrelated.'
			: [
					"WORD — UNDERSTAND. Each item is a natural sentence using the word in ONE of the card's " +
						'senses; ask what the sentence means. Set coverage to "sense:<n>" for the sense the ' +
						'sentence uses, spread across the senses so every sense appears and none takes more ' +
						'than half the items. NEVER ask "what does the word mean" — ask what the sentence ' +
						'says. Every item needs an other_sense:<n> distractor: the meaning the sentence would ' +
						'have if the word were read in a different sense (n is that other sense, never the ' +
						"item's own).",
					'WORD — SENSE. Show a sentence that uses the word; the question is which sense it is ' +
						"(options are the senses' short glosses, in English). Exactly one correct " +
						'option, with coverage "sense:<n>" for the sentence\'s sense; wrong options are ' +
						"the other senses' glosses, tagged other_sense:<n>. One item per sense, so every " +
						'sense appears once.'
				].join('\n'),
	kanji: () =>
		[
			'KANJI — UNDERSTAND. Each item is a natural sentence containing a common COMPOUND of the ' +
				'kanji; ask what the sentence means. targetSpan is the kanji itself. Use compounds from ' +
				'the card, EXCEPT one item that uses a common compound that is NOT on the card — say so in ' +
				'its instruction ("this compound is not on the card — work it out from the kanji"). ' +
				'Each item needs an other_compound:<word> distractor: the meaning of another compound of ' +
				'this kanji.',
			'KANJI — READING. "sentence" contains a word with the kanji, "focus" is the highlighted ' +
				'kanji (or word), and the question is how the highlighted kanji is read; options are ' +
				'readings in hiragana. Exactly one correct option; wrong options are other readings of ' +
				'the kanji from the card, tagged other_reading. coverage is "reading:<hiragana>" of the ' +
				'CORRECT reading. Write at least one item for EVERY reading on the card — including the ' +
				'one marked rare — and at least 3 items; if the card has more readings than that, write ' +
				'one per reading.'
		].join('\n'),
	set_phrase: () =>
		[
			'SET PHRASE — UNDERSTAND. Each item is a short dialogue or message that uses the phrase; ask ' +
				'what is going on, what a speaker means or how they sound. Never name the phrase in the ' +
				'question. Each item needs a wrong_situation, wrong_register or literal_misread ' +
				'distractor.',
			'SET PHRASE — SITUATION. "instruction" describes an everyday situation in English; the ' +
				'options are 2-3 Japanese phrases, including close neighbours of the target (from the ' +
				"card's variants and watch-outs). At least ONE item must have a correct answer that is " +
				'NOT the target phrase (so choosing the target every time would fail); the others have ' +
				'the target (or one of its listed variants) as the answer. targetSpan is always the ' +
				'target phrase as it appears in the item. Wrong options carry wrong_situation, ' +
				'wrong_register, or unrelated tags.'
		].join('\n'),
	contrast: (card) =>
		[
			'CONTRAST — UNDERSTAND. Each item is a natural sentence containing ONE of the two items; ask ' +
				'what it means or who/what is in focus (English options). coverage is "side:a" or ' +
				'"side:b" for the member the sentence uses; spread so both appear. Never name the ' +
				'contrast. Every item needs a wrong_side distractor: the meaning you would get by ' +
				'applying the OTHER member.',
			'CONTRAST — SORT. Rapid two-option choice, each with exactly ONE natural answer. Either ' +
				'"instruction" gives an English meaning and the options are the two members in the ' +
				'required form (決めた / 決まった), or "sentence" has a ＿＿ blank (kana line keeps the ＿＿) ' +
				'and the options are the two members. If the pair differs in grammar rather than ' +
				'meaning, one item may instead ask which of three sentences is wrong (one correct ' +
				'option). The wrong option is tagged wrong_side. HARD RULE: the other member must NOT ' +
				'also be acceptable in the sentence — if both fit, rewrite the sentence until only one ' +
				'does. coverage is the side of the CORRECT option; make it balanced: the correct ' +
				'sides are split as evenly as possible (e.g. 3 side:a and 2 side:b, or 2 and 3), and ' +
				'across UNDERSTAND and SORT together each side should be the answer to about half the ' +
				'items (so if Sort leans to side:a, lean Understand to side:b).',
			contrastKindNote(card)
		].join('\n')
};

function contrastKindNote(card: Card): string {
	if (card.type !== 'contrast') return '';
	const notes: Record<string, string> = {
		transitivity_pair:
			'This pair is transitive/intransitive: contrast who acts (を / が, a person doing it vs ' +
			'something simply happening).',
		near_synonym:
			"This pair is near-synonyms: contrast the nuance, register or collocations from the card's " +
			'axis, choosing contexts where only one is natural.',
		grammar: 'This pair is two grammar patterns: contrast the meaning or the attachment rule.'
	};
	return notes[card.contrastKind] ?? '';
}

const STAGE_2_RECIPE: Record<TargetType, (card: Card) => string> = {
	grammar: () =>
		[
			'GRAMMAR — PRODUCE (5): 3 cloze items (fill the pattern itself; fill the pattern after a ' +
				'noun or な-adjective; fill a verb in the right tense using "cue" — the answer includes ' +
				'the pattern), 1 tile item, 1 free typed item that asks for an English→Japanese ' +
				'sentence. The pattern must appear in every item.',
			'GRAMMAR — USE (4): three guided writing items (combine two sentences with the pattern; turn ' +
				'a quoted question into reported speech; reply to a friend in a situation), then the ' +
				'final free "write your own sentence" item.',
			'GRAMMAR — CONTRAST (3): tell the target apart from the neighbours on the card. Use "mc" ' +
				'items (a meaning that one of two patterns expresses; a register question) and a typed ' +
				'cloze where only the target fits. The target pattern itself must appear among every ' +
				"item's options (even when it is the wrong one) or in its answer. Wrong options carry misread_similar_pattern, " +
				'context, opposite or unrelated tags.'
		].join('\n'),
	word: (card) =>
		card.type === 'word' && card.senses.length === 1
			? 'WORD (one sense) — PRODUCE (6): cloze items that need an inflected form (use "cue" with the ' +
				'dictionary form) or a form like the adverb, a collocation cloze, 1 tile item, 1 free ' +
				'English→Japanese item. USE (3): guided writing items in different contexts, then the ' +
				'final free item.'
			: [
					'WORD — PRODUCE (5): cloze items that need an inflected form (negative, past, adverb, ' +
						'te-form) with "cue" holding the dictionary form, a collocation cloze, 1 tile item ' +
						'and 1 free English→Japanese item. Cover more than one sense.',
					'WORD — USE (3): guided writing items, each in a different sense, then the final free ' +
						'item.'
				].join('\n'),
	kanji: () =>
		[
			'KANJI — PRODUCE (5): (1) a free typed item "type the reading in hiragana of the ' +
				'highlighted word" with "focus"; (2) a cloze that asks for a compound typed through the ' +
				'IME, with the reading in "cue" (the answer is the kanji spelling); (3) a cloze ' +
				'for a kun-reading verb or adjective with okurigana, accepting kana and kanji; (4) a ' +
				'tile item; (5) a cloze that gives a list of compounds in "cue" and asks which one ' +
				'fits. The target kanji must appear in every answer or sentence.',
			'KANJI — USE (3): guided writing items (use a compound in a short statement; a casual ' +
				'sentence), then the final free item: "write a sentence with any compound of the target ' +
				'kanji".'
		].join('\n'),
	set_phrase: () =>
		[
			'SET PHRASE — PRODUCE (5): (1) a cloze where the learner fills a reply with the phrase in ' +
				'the right form; (2) a free typed item for the casual or shortened form; (3) a free ' +
				'typed item "this line is wrong for the situation, rewrite it" with the wrong line in ' +
				'"sentence"; (4) a tile item where several word orders are fine — list ALL of them in ' +
				'"accepted"; (5) a free English→Japanese item.',
			'SET PHRASE — USE (3): guided writing items in different situations (acknowledge ' +
				"someone's effort; adjust a line for a boss), then the final free item: a short " +
				'exchange that uses the phrase.'
		].join('\n'),
	contrast: (card) =>
		[
			'CONTRAST — PRODUCE (4): cloze items that need the right member in the right form (use ' +
				'"cue" with the dictionary form, and make sure only one member fits), 1 tile item; ' +
				'the target members must appear in every answer.',
			card.type === 'contrast' && card.contrastKind === 'transitivity_pair'
				? 'CONTRAST — USE (3): swap-the-verb items (rewrite a sentence with the OTHER member, ' +
					'changing the particle: 日程を決めた → 日程が決まった), then the final free item: write ' +
					'a sentence for each member.'
				: 'CONTRAST — USE (3): guided writing items that need one member in a given situation, ' +
					'then the final free item: write one sentence for each member.'
		].join('\n')
};

// --- Public prompt builders ---------------------------------------------------------

export interface GenerationPromptInput {
	card: Card;
	stage: GenerationStage;
	/** Sentences from an earlier round (or earlier attempt) the new items must not repeat. */
	avoid?: string[];
	/** A second attempt asking only for the missing pieces of some phases. */
	regenerate?: RegenerationRequest[];
}

/**
 * The counts, restated last so they are the freshest thing the model reads. (On
 * its own this did not stop the model closing `items` after the first phase —
 * the per-phase keys in the schema do; this stays as a cheap second signal.)
 */
function checklist(card: Card, stage: GenerationStage, regenerate?: RegenerationRequest[]): string {
	if (regenerate) return '';
	const spec = skeletonFor(card).filter((p) => p.stage === stage);
	const spares = spareQuota(card, stage);
	return (
		'Write now, under "items": ' +
		spec.map((p) => `"${p.id}" × ${p.count}`).join(', ') +
		(spares.length > 0
			? '; and under "spares": ' + spares.map((q) => `"${q.phase}" × ${q.count}`).join(', ')
			: '') +
		'. Every phase key must be filled.'
	);
}

/**
 * The card as the generator sees it: without its example sentences. They were
 * the easiest thing to copy — 4 of 11 drops in the slice-5 real run were items
 * repeating a card sentence — so they are listed separately as "already shown"
 * instead. The rule, form, senses' glosses and the rest still ground the items.
 */
export function cardForGeneration(card: Card): Card {
	switch (card.type) {
		case 'word':
			return {
				...card,
				modelSentences: [],
				senses: card.senses.map((s) => ({ ...s, example: '' }))
			};
		case 'contrast':
			return { ...card, modelSentences: [], minimalPair: ['', ''] };
		default:
			return { ...card, modelSentences: [] };
	}
}

export function generationPrompt(input: GenerationPromptInput): { system: string; user: string } {
	const { card, stage, avoid = [], regenerate } = input;
	const recipe = (stage === 1 ? STAGE_1_RECIPE : STAGE_2_RECIPE)[card.type](card);

	const kinds = stage === 1 ? [MC_RULES] : [MC_RULES, TYPED_RULES, TILES_RULES, CLAUDE_RULES];

	const system = [
		ROLE,
		LEARNER_LEVEL,
		FIELD_RULES,
		...kinds,
		tagsSection(card.type, stage),
		phasesSection(card, stage, regenerate),
		coverageSection(card),
		recipe,
		NO_ROMAJI_NOTE,
		UNTRUSTED_INPUT_NOTE
	]
		.filter((part) => part !== '')
		.join('\n\n');

	const lines = [
		`Target type: ${card.type}.`,
		`Target card (reference data; its example sentences are left out on purpose and listed under "already shown" below): ${tagUntrusted(JSON.stringify(cardForGeneration(card)))}`
	];
	if (regenerate) {
		lines.push(
			'This is a second attempt: write ONLY the phases above, as extra items to add to ones ' +
				'already written. Why each is needed:'
		);
		for (const r of regenerate) {
			lines.push(
				`- ${r.phase}: ${r.need} more item${r.need === 1 ? '' : 's'}` +
					(r.coverage.length > 0 ? `, covering ${r.coverage.join(', ')}` : '') +
					` (${r.reasons.join('; ')})`
			);
		}
	}
	// Already on the learner's card, or used in an earlier round / attempt.
	const shown = [
		...new Set([...cardModelSentences(card).filter((x) => x.trim() !== ''), ...avoid])
	];
	if (shown.length > 0) {
		lines.push(
			'Sentences already shown to the learner — do not reuse or lightly rephrase any of these:\n' +
				tagUntrusted(shown.map((x) => `- ${x}`).join('\n'))
		);
	}
	// Last, so the counts are the freshest thing the model reads.
	lines.push(checklist(card, stage, regenerate));
	return { system, user: lines.filter((l) => l !== '').join('\n') };
}
