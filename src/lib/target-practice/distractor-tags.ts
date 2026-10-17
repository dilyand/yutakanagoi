import type { DistractorTag, TargetType } from './types';

/**
 * Distractor tags (design doc §5). Every wrong option in an Understand item
 * carries one; at least one per item must be a "valid meaning, wrong place"
 * tag for the type, so the correct answer isn't simply the only option that
 * matches the card.
 *
 * A tag is `name` or `name:param` (`other_sense:3`, `other_compound:解説`).
 */

export const GENERIC_TAGS: readonly string[] = ['context', 'opposite', 'unrelated'];

interface TagTable {
	/** At least one wrong option per Understand item must use one of these. */
	required: readonly string[];
	/** Additional type-specific tags allowed beyond the generic ones. */
	extra: readonly string[];
}

export const TYPE_TAGS: Record<TargetType, TagTable> = {
	word: { required: ['other_sense'], extra: [] },
	kanji: { required: ['other_compound', 'other_reading'], extra: ['lookalike'] },
	set_phrase: { required: ['wrong_situation', 'wrong_register', 'literal_misread'], extra: [] },
	grammar: { required: ['misread_similar_pattern'], extra: [] },
	// Derived by applying the same rule to Contrast; not spelled out in the brainstorm.
	contrast: { required: ['wrong_side'], extra: [] }
};

/** Tags whose param is mandatory. */
const PARAM_REQUIRED: readonly string[] = ['other_sense'];

export interface ParsedTag {
	name: string;
	param?: string;
}

export function parseTag(tag: DistractorTag): ParsedTag {
	const i = tag.indexOf(':');
	if (i === -1) return { name: tag };
	return { name: tag.slice(0, i), param: tag.slice(i + 1) };
}

export function allowedTagNames(type: TargetType): string[] {
	return [...TYPE_TAGS[type].required, ...TYPE_TAGS[type].extra, ...GENERIC_TAGS];
}

export function isRequiredTag(type: TargetType, tag: DistractorTag): boolean {
	return TYPE_TAGS[type].required.includes(parseTag(tag).name);
}

/**
 * Structural check of one tag for `type`. Returns a problem string, or null
 * when the tag is fine. Card-dependent checks (does `other_sense:3` name a
 * real sense?) are done by validate-items.ts, which has the card.
 */
export function tagProblem(type: TargetType, tag: DistractorTag): string | null {
	const { name, param } = parseTag(tag);
	if (!allowedTagNames(type).includes(name)) return `tag "${name}" is not allowed for ${type}`;
	if (PARAM_REQUIRED.includes(name) && (param === undefined || param.trim() === '')) {
		return `tag "${name}" needs a parameter`;
	}
	return null;
}
