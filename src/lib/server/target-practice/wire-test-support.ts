import { spareQuota } from '$lib/target-practice/generation';
import type { GenerationStage, RegenerationRequest } from '$lib/target-practice/generation';
import { skeletonFor } from '$lib/target-practice/skeleton';
import type { Card, Item } from '$lib/target-practice/types';

/**
 * Test support: the model's side of the wire format. Turns a fixture `Item`
 * into the flat-with-empty-strings object a generation schema parses, so tests
 * can stand in for the model with the Appendix A fixtures.
 */
export function toWire(item: Item): Record<string, unknown> {
	const common = {
		instruction: item.instruction ?? '',
		sentence: item.sentence ?? '',
		kana: item.kana ?? '',
		targetSpan: item.targetSpan,
		rationale: item.rationale
	};
	switch (item.kind) {
		case 'mc':
			return {
				...common,
				focus: item.focus ?? '',
				coverage: item.coverage ?? '',
				options: item.options.map((o) => ({ text: o.text, correct: o.correct, tag: o.tag ?? '' }))
			};
		case 'typed':
			return {
				...common,
				focus: item.focus ?? '',
				cue: item.cue ?? '',
				hint: item.hint,
				form: item.form,
				answer: item.answer,
				accepted: item.accepted
			};
		case 'tiles':
			return {
				instruction: item.instruction ?? '',
				targetSpan: item.targetSpan,
				rationale: item.rationale,
				tiles: item.tiles,
				accepted: item.accepted
			};
		case 'claude':
			return { ...common, expected: item.expected, free: item.free === true };
	}
}

/**
 * A parsed-output payload for `generationSchemaFor(card, stage, regenerate)`:
 * wire items grouped under one key per phase (empty arrays for phases with
 * nothing), spares under the phases that have a quota. Items of a phase the
 * schema doesn't have are left out, as the model couldn't write them. Unless
 * `spares` is given, fixture items flagged `spare: true` are the spares.
 */
export function wirePayload(
	card: Card,
	stage: GenerationStage,
	items: Item[],
	spares?: Item[],
	regenerate?: RegenerationRequest[]
) {
	const phases = skeletonFor(card)
		.filter((p) => p.stage === stage && (!regenerate || regenerate.some((r) => r.phase === p.id)))
		.map((p) => p.id);
	const primaries = spares ? items : items.filter((i) => !i.spare);
	const reserve = spares ?? items.filter((i) => i.spare);
	const group = (list: Item[], keys: string[]) =>
		Object.fromEntries(keys.map((k) => [k, list.filter((i) => i.phase === k).map(toWire)]));
	const quotaPhases = regenerate ? [] : spareQuota(card, stage).map((q) => q.phase);
	return {
		items: group(primaries, phases),
		...(quotaPhases.length > 0 ? { spares: group(reserve, quotaPhases) } : {})
	};
}
