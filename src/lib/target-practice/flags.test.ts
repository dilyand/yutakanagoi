import { describe, expect, it } from 'vitest';
import { flagItemPayload } from './flags';
import { grammarKakadouka } from './fixtures';

const item = grammarKakadouka.items.find((i) => i.kind === 'claude')!;

describe('flagItemPayload', () => {
	it('stores the item unchanged when there is no response', () => {
		expect(flagItemPayload(item, null)).toBe(item);
	});

	it('adds the learner answer and the grader feedback next to the item', () => {
		const out = flagItemPayload(item, {
			answer: '明日は雨がふるかどうだ分かりません。',
			outcome: 'wrong',
			graderFeedback: "Also で particle isn't needed.",
			attempts: 1
		}) as Record<string, unknown>;
		expect(out.id).toBe(item.id);
		expect(out.learnerResponse).toEqual({
			answer: '明日は雨がふるかどうだ分かりません。',
			outcome: 'wrong',
			graderFeedback: "Also で particle isn't needed.",
			attempts: 1
		});
	});

	it('leaves graderFeedback out when nothing was graded by Claude', () => {
		const out = flagItemPayload(item, { answer: 'x', outcome: 'neutral', attempts: 1 }) as {
			learnerResponse: Record<string, unknown>;
		};
		expect('graderFeedback' in out.learnerResponse).toBe(false);
	});
});
