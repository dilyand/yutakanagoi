import { isKana, hasJapaneseScript } from './normalize';
import { CONTRAST_KINDS, TARGET_TYPES } from './types';
import type { Card, ContrastKind, TargetType } from './types';

/**
 * "Per card" rules from design doc §5. Takes `unknown` (model output) and
 * never throws.
 *
 * - `ok`: a usable card.
 * - `rejected`: the model declined (type mismatch, unsupported contrast kind).
 *   `suggestedType` drives the "Switch to Grammar?" redirect.
 * - `invalid`: the model returned something malformed; log `problems`.
 */
export type CardCheck =
	| { status: 'ok'; card: Card }
	| { status: 'rejected'; reason: string; suggestedType?: TargetType }
	| { status: 'invalid'; problems: string[] };

export const MAX_WORD_SENSES = 4;
export const MAX_RARE_READINGS = 1;
export const MAX_KANJI_COMPOUNDS = 8;

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown): v is string {
	return typeof v === 'string' && v.trim() !== '';
}

export function validateCard(raw: unknown, expectedType: TargetType): CardCheck {
	if (!isRec(raw)) return { status: 'invalid', problems: ['card is not an object'] };

	if (raw.ok === false) {
		const reason = str(raw.reason) ? raw.reason : 'This target is not supported.';
		const suggested = TARGET_TYPES.find((t) => t === raw.suggestedType && t !== expectedType);
		return { status: 'rejected', reason, suggestedType: suggested };
	}
	if (raw.ok !== true) return { status: 'invalid', problems: ['card.ok must be true or false'] };
	if (raw.type !== expectedType) {
		return {
			status: 'invalid',
			problems: [`card.type is ${String(raw.type)}, expected ${expectedType}`]
		};
	}

	if (expectedType === 'contrast' && raw.contrastKind === 'similar_kanji') {
		return {
			status: 'rejected',
			reason: 'Contrasting similar-looking kanji is not supported yet.'
		};
	}

	const problems: string[] = [];
	checkBase(raw, expectedType, problems);
	switch (expectedType) {
		case 'word':
			checkWord(raw, problems);
			break;
		case 'kanji':
			checkKanji(raw, problems);
			break;
		case 'set_phrase':
			checkSetPhrase(raw, problems);
			break;
		case 'grammar':
			checkGrammar(raw, problems);
			break;
		case 'contrast':
			checkContrast(raw, problems);
			break;
	}
	if (problems.length > 0) return { status: 'invalid', problems };
	return { status: 'ok', card: raw as unknown as Card };
}

function strArray(v: unknown, name: string, problems: string[], { min = 0, max = Infinity } = {}) {
	if (!Array.isArray(v) || !v.every(str)) {
		problems.push(`${name} must be an array of non-empty strings`);
		return;
	}
	if (v.length < min || v.length > max) {
		problems.push(
			`${name} must have ${min}-${max === Infinity ? '∞' : max} entries, has ${v.length}`
		);
	}
}

function checkBase(raw: Rec, type: TargetType, problems: string[]) {
	if (!str(raw.target)) problems.push('target is missing');
	if (!str(raw.rule)) problems.push('rule is missing');
	strArray(raw.modelSentences, 'modelSentences', problems, {
		min: type === 'grammar' ? 2 : 1,
		max: type === 'grammar' ? 3 : 4
	});
	if (
		Array.isArray(raw.modelSentences) &&
		raw.modelSentences.some((s) => !hasJapaneseScript(String(s)))
	) {
		problems.push('modelSentences must be Japanese');
	}
	if (type !== 'kanji' && type !== 'contrast') {
		if (!str(raw.reading)) problems.push('reading is missing');
		else if (!isKana(raw.reading, { allowPatternMarks: true })) {
			problems.push('reading must be kana only');
		}
	}
}

function checkWord(raw: Rec, problems: string[]) {
	const senses = raw.senses;
	if (!Array.isArray(senses) || senses.length < 1) {
		problems.push('senses must have at least one entry');
	} else {
		if (senses.length > MAX_WORD_SENSES) {
			problems.push(`senses has ${senses.length} entries, max ${MAX_WORD_SENSES}`);
		}
		const ids = new Set<number>();
		for (const s of senses) {
			if (!isRec(s) || !Number.isInteger(s.id) || (s.id as number) < 1) {
				problems.push('each sense needs a positive integer id');
				continue;
			}
			if (ids.has(s.id as number)) problems.push(`duplicate sense id ${String(s.id)}`);
			ids.add(s.id as number);
			if (!str(s.gloss)) problems.push(`sense ${String(s.id)} has no gloss`);
			if (!str(s.example) || !hasJapaneseScript(s.example)) {
				problems.push(`sense ${String(s.id)} needs a Japanese example`);
			}
		}
	}
	strArray(raw.forms, 'forms', problems);
	if (!Number.isInteger(raw.lessCommonSenses) || (raw.lessCommonSenses as number) < 0) {
		problems.push('lessCommonSenses must be a non-negative integer');
	}
}

function checkKanji(raw: Rec, problems: string[]) {
	if (str(raw.target) && !/^\p{Unified_Ideograph}$/u.test(raw.target)) {
		problems.push('target must be exactly one kanji');
	}
	if (!str(raw.meaning)) problems.push('meaning is missing');

	const readings = raw.readings;
	if (!Array.isArray(readings) || readings.length < 1) {
		problems.push('readings must have at least one entry');
	} else {
		let rare = 0;
		for (const r of readings) {
			if (!isRec(r) || !str(r.kana) || !isKana(r.kana)) {
				problems.push('every reading needs a kana-only `kana`');
				continue;
			}
			if (r.kind !== 'on' && r.kind !== 'kun') problems.push(`reading ${r.kana} has no kind`);
			if (r.okurigana !== undefined && !(str(r.okurigana) && isKana(r.okurigana))) {
				problems.push(`reading ${r.kana} has non-kana okurigana`);
			}
			if (typeof r.rare !== 'boolean') problems.push(`reading ${r.kana} needs a boolean rare`);
			else if (r.rare) rare++;
		}
		if (rare > MAX_RARE_READINGS) {
			problems.push(`${rare} readings flagged rare, max ${MAX_RARE_READINGS}`);
		}
	}

	const compounds = raw.compounds;
	if (!Array.isArray(compounds) || compounds.length < 3 || compounds.length > MAX_KANJI_COMPOUNDS) {
		problems.push(`compounds must have 3-${MAX_KANJI_COMPOUNDS} entries`);
	} else {
		for (const c of compounds) {
			if (!isRec(c) || !str(c.word) || !str(c.reading) || !str(c.gloss)) {
				problems.push('every compound needs word, reading and gloss');
			} else {
				if (!isKana(c.reading)) problems.push(`compound ${c.word} reading must be kana only`);
				if (str(raw.target) && !c.word.includes(raw.target)) {
					problems.push(`compound ${c.word} does not contain the kanji`);
				}
			}
		}
	}
}

function checkSetPhrase(raw: Rec, problems: string[]) {
	if (!str(raw.meaning)) problems.push('meaning is missing');
	strArray(raw.uses, 'uses', problems, { min: 1 });
	if (
		!Array.isArray(raw.variants) ||
		!raw.variants.every((v) => isRec(v) && str(v.text) && str(v.note))
	) {
		problems.push('variants must be an array of {text, note}');
	}
	if (!str(raw.register)) problems.push('register is missing');
	strArray(raw.watchOuts, 'watchOuts', problems);
}

function checkGrammar(raw: Rec, problems: string[]) {
	if (!str(raw.form)) problems.push('form is missing');
	if (!str(raw.use)) problems.push('use is missing');
	if (!str(raw.watchOut)) problems.push('watchOut is missing');
	strArray(raw.neighbours, 'neighbours', problems, { max: 4 });
}

function checkContrast(raw: Rec, problems: string[]) {
	if (!CONTRAST_KINDS.includes(raw.contrastKind as ContrastKind)) {
		problems.push(`contrastKind must be one of ${CONTRAST_KINDS.join(', ')}`);
	}
	if (!str(raw.axis)) problems.push('axis is missing');
	if (!str(raw.commonMistake)) problems.push('commonMistake is missing');
	const sides = raw.sides;
	if (!Array.isArray(sides) || sides.length !== 2) {
		problems.push('sides must have exactly two entries');
	} else {
		for (const s of sides) {
			if (!isRec(s) || !str(s.form) || !str(s.reading) || !str(s.meaning)) {
				problems.push('each side needs form, reading and meaning');
			} else if (!isKana(s.reading, { allowPatternMarks: true })) {
				problems.push(`side ${s.form} reading must be kana only`);
			}
		}
		if (isRec(sides[0]) && isRec(sides[1]) && sides[0].form === sides[1].form) {
			problems.push('the two sides have the same form');
		}
	}
	if (
		!Array.isArray(raw.minimalPair) ||
		raw.minimalPair.length !== 2 ||
		!raw.minimalPair.every(str)
	) {
		problems.push('minimalPair must be two sentences');
	}
}
