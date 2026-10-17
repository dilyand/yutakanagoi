import type { PhaseId, TargetType } from './types';

/**
 * What the picker and the input screen show (design doc §2). The picker lists
 * only the types that are built — types ship incrementally (§14), each after
 * its own live smoke test.
 */
export const BUILT_TYPES: readonly TargetType[] = ['grammar', 'word'];

export function isBuilt(type: TargetType): boolean {
	return BUILT_TYPES.includes(type);
}

export interface TypeGuidance {
	label: string;
	/** One line under the label in the picker. */
	blurb: string;
	placeholder: string;
	/** The "what counts" note on the input screen. */
	note: string;
	/** Clickable examples that fill the field. */
	chips: string[];
}

export const GUIDANCE: Record<TargetType, TypeGuidance> = {
	grammar: {
		label: 'Grammar pattern',
		blurb: 'A pattern with a slot you fill in.',
		placeholder: '〜かどうか',
		note: 'A pattern with a slot you fill in: write it in Japanese (〜てしまう) or describe it in English (“the more, the more”). Fixed text is a set phrase; a single word is a Word.',
		chips: ['〜かどうか', '〜てしまう', '〜ことになる', 'the more, the more']
	},
	word: {
		label: 'Word',
		blurb: 'One word, practised across its main senses.',
		placeholder: '厳しい',
		note: 'One word, in Japanese (kanji or kana) or English. Phrases and sentences are not words.',
		chips: ['厳しい', '食べる', 'deadline', 'to run']
	},
	kanji: {
		label: 'Kanji',
		blurb: 'One character: readings and compounds.',
		placeholder: '解',
		note: 'Exactly one kanji. Compounds are Words.',
		chips: ['解', '憂', '複', '縮']
	},
	set_phrase: {
		label: 'Set phrase',
		blurb: 'A fixed expression or proverb.',
		placeholder: 'お疲れ様です',
		note: 'Fixed text with no slot to fill in. Proverbs count; 四字熟語 do not.',
		chips: ['お疲れ様です', 'しょうがない', '気が重い', '猿も木から落ちる']
	},
	contrast: {
		label: 'Contrast',
		blurb: 'Two things to tell apart.',
		placeholder: '決める vs 決まる',
		note: 'Two Japanese items of the same kind, separated by “vs”, “/” or “、”.',
		chips: ['決める vs 決まる', '知る vs 分かる', 'ので vs から']
	}
};

/** Phase names as the learner sees them (header and wrap-up). */
export const PHASE_LABELS: Record<PhaseId, string> = {
	understand: 'Understand',
	sense: 'Senses',
	reading: 'Readings',
	situation: 'Situations',
	sort: 'Sort',
	produce: 'Produce',
	use: 'Use',
	contrast: 'Contrast'
};
