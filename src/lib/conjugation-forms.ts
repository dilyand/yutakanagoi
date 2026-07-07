import type { WordClass } from './conjugation-word-list';

// Masu-family forms are their own leaf items here, not a style axis crossed
// onto every other form — see 2.0.0's conjugation-drills design notes for why
// (avoids a style(2) x polarity(2) x tense(2) x stem(5) combinatorial
// explosion while still covering every genuinely-drilled form).
export type VerbFormId =
	| 'nai'
	| 'ta'
	| 'nakatta'
	| 'te'
	| 'nakute'
	| 'potential'
	| 'passive'
	| 'causative'
	| 'volitional'
	| 'conditional_ba'
	| 'conditional_tara'
	| 'imperative'
	| 'tai'
	| 'masu'
	| 'masen'
	| 'mashita'
	| 'masen_deshita'
	| 'potential_negative'
	| 'potential_past'
	| 'passive_negative'
	| 'passive_past'
	| 'causative_negative'
	| 'causative_past'
	| 'causative_passive'
	| 'causative_passive_past';

export type IAdjectiveFormId =
	| 'negative'
	| 'past'
	| 'past_negative'
	| 'te'
	| 'negative_te'
	| 'conditional_kereba'
	| 'adverbial'
	| 'sou'
	| 'polite'
	| 'polite_past';

export type CopulaFormId =
	| 'negative'
	| 'past'
	| 'past_negative'
	| 'te'
	| 'conditional_nara'
	| 'desu'
	| 'negative_desu'
	| 'deshita'
	| 'past_negative_desu';

export interface FormDescriptor<Id extends string> {
	id: Id;
	label: string;
}

// Labels deliberately drop the romaji suffix (e.g. "negative", not
// "negative (-nai)") unless the kana-suffixed name is genuinely how the
// form is naturally referred to (te-form, masu-form-family, etc.) or is
// needed to tell two forms apart (the two conditionals). Where a suffix is
// kept, it's the actual kana (〜て), not a romanized fragment — see
// claude-evaluate.ts's NO_ROMAJI_NOTE for why romaji is avoided throughout
// this feature's UI and generated text.
export const VERB_FORMS: FormDescriptor<VerbFormId>[] = [
	{ id: 'nai', label: 'negative' },
	{ id: 'ta', label: 'past' },
	{ id: 'nakatta', label: 'negative past' },
	{ id: 'te', label: '〜て form' },
	{ id: 'nakute', label: 'negative 〜て form' },
	{ id: 'potential', label: 'potential' },
	{ id: 'passive', label: 'passive' },
	{ id: 'causative', label: 'causative' },
	{ id: 'volitional', label: 'volitional' },
	{ id: 'conditional_ba', label: '〜ば form' },
	{ id: 'conditional_tara', label: '〜たら form' },
	{ id: 'imperative', label: 'imperative' },
	{ id: 'tai', label: '〜たい form' },
	{ id: 'masu', label: 'polite' },
	{ id: 'masen', label: 'polite negative' },
	{ id: 'mashita', label: 'polite past' },
	{ id: 'masen_deshita', label: 'polite negative past' },
	{ id: 'potential_negative', label: 'potential negative' },
	{ id: 'potential_past', label: 'potential past' },
	{ id: 'passive_negative', label: 'passive negative' },
	{ id: 'passive_past', label: 'passive past' },
	{ id: 'causative_negative', label: 'causative negative' },
	{ id: 'causative_past', label: 'causative past' },
	{ id: 'causative_passive', label: 'causative passive' },
	{ id: 'causative_passive_past', label: 'causative passive past' }
];

export const I_ADJECTIVE_FORMS: FormDescriptor<IAdjectiveFormId>[] = [
	{ id: 'negative', label: 'negative' },
	{ id: 'past', label: 'past' },
	{ id: 'past_negative', label: 'negative past' },
	{ id: 'te', label: '〜て form' },
	{ id: 'negative_te', label: 'negative 〜て form' },
	{ id: 'conditional_kereba', label: '〜ければ form' },
	{ id: 'adverbial', label: 'adverbial' },
	{ id: 'sou', label: '〜そう form' },
	{ id: 'polite', label: 'polite' },
	{ id: 'polite_past', label: 'polite past' }
];

export const COPULA_FORMS: FormDescriptor<CopulaFormId>[] = [
	{ id: 'negative', label: 'negative' },
	{ id: 'past', label: 'past' },
	{ id: 'past_negative', label: 'negative past' },
	{ id: 'te', label: '〜で form' },
	{ id: 'conditional_nara', label: '〜なら form' },
	{ id: 'desu', label: 'polite' },
	{ id: 'negative_desu', label: 'polite negative' },
	{ id: 'deshita', label: 'polite past' },
	{ id: 'past_negative_desu', label: 'polite negative past' }
];

/**
 * Canonical cell id for a (word class, form) pair, e.g.
 * "godan_mu:causative_passive_past". `:` rather than `_` since word classes
 * already contain underscores (godan_mu) — this keeps the two halves
 * unambiguous to split back apart later.
 */
export function cellId(wordClass: WordClass, formId: string): string {
	return `${wordClass}:${formId}`;
}

/** Human-readable label for a (word class, form) pair, e.g. "causative passive past". */
export function getFormLabel(wordClass: WordClass, formId: string): string {
	const forms: FormDescriptor<string>[] =
		wordClass === 'i_adjective'
			? I_ADJECTIVE_FORMS
			: wordClass === 'copula'
				? COPULA_FORMS
				: VERB_FORMS;
	return forms.find((form) => form.id === formId)?.label ?? formId;
}
