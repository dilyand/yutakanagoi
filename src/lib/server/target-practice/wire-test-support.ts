import type { Item } from '$lib/target-practice/types';

/**
 * Test support: the model's side of the wire format. Turns a fixture `Item`
 * into the flat-with-empty-strings object a generation schema parses, so tests
 * can stand in for the model with the Appendix A fixtures.
 */
export function toWire(item: Item): Record<string, unknown> {
	const common = {
		phase: item.phase,
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
				phase: item.phase,
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

/** A parsed-output payload: `items` are primaries, `spares` the reserve. */
export function wirePayload(items: Item[], spares: Item[] = []) {
	return { items: items.map(toWire), spares: spares.map(toWire) };
}
