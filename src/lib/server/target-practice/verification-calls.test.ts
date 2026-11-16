import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const callClaudeMock = vi.hoisted(() => vi.fn());
vi.mock('./claude-call', async (importOriginal) => ({
	...(await importOriginal<typeof import('./claude-call')>()),
	callClaude: callClaudeMock
}));

import { reviewRejections } from './review';
import { verifyContrastItems } from './verify-contrast';
import { reviewPrompt, verifyContrastPrompt } from './verification-prompts';
import { grammarKakadouka } from '$lib/target-practice/fixtures';
import { contrastItemsToVerify } from '$lib/target-practice/verification';
import { toGradeInput } from '$lib/target-practice/grade';

const supabase = {} as SupabaseClient;
const card = grammarKakadouka.card;
const contrast = contrastItemsToVerify(grammarKakadouka.items);
const typedInput = toGradeInput(
	grammarKakadouka.items.find((i) => i.kind === 'typed')!,
	'答え'
)!;

function modelReturns(parsed: unknown) {
	const parse = vi
		.fn()
		.mockResolvedValue({ usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: parsed });
	callClaudeMock.mockImplementation(async (opts: { call: (c: unknown) => unknown }) =>
		opts.call({ messages: { parse } })
	);
	return parse;
}

beforeEach(() => vi.clearAllMocks());

describe('verifyContrastPrompt', () => {
	it('marks the claimed-faulty option, keeps items in untrusted tags and demands doubt', () => {
		const { system, user } = verifyContrastPrompt(card, contrast);
		expect(system).toContain('ONLY if BOTH hold');
		expect(system).toContain('any real doubt');
		expect(user.match(/\[MARKED AS THE ERROR\]/g)).toHaveLength(contrast.length);
		expect(user.match(/\[claimed sound\]/g)).toHaveLength(contrast.length * 3);
		expect(user).toContain('Item id: g-c1');
		expect(user.match(/<untrusted>/g)).toHaveLength(2);
	});
});

describe('verifyContrastItems', () => {
	it('asks the review model, as a ceiling call, and returns the doubted items', async () => {
		const parse = modelReturns({
			results: [
				{ id: 'g-c1', ok: true, problem: '' },
				{ id: 'g-c2', ok: false, problem: 'The marked sentence is fine.' }
			]
		});
		const failures = await verifyContrastItems(supabase, 7, card, contrast);
		expect(failures).toEqual([{ id: 'g-c2', problem: 'The marked sentence is fine.' }]);
		expect(callClaudeMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 7, kind: 'ceiling', maxRetries: 0, timeoutMs: 25_000 })
		);
		const args = parse.mock.calls[0][0];
		expect(args.model).toBe('claude-opus-5-5');
		expect(args.thinking).toEqual({ type: 'adaptive', display: 'omitted' });
		expect(args.output_config.effort).toBe('low');
	});

	it('makes no call for nothing to check', async () => {
		expect(await verifyContrastItems(supabase, 7, card, [])).toEqual([]);
		expect(callClaudeMock).not.toHaveBeenCalled();
	});
});

describe('reviewPrompt', () => {
	it('shows the first reason as a claim to check and warns that it may be wrong', () => {
		const { system, user } = reviewPrompt(card, [
			{ input: typedInput, first: { correct: false, feedback: 'It is redundant.' } }
		]);
		expect(system).toContain('may be wrong');
		expect(system).toContain('INDEPENDENTLY');
		expect(user).toContain('First grader: REJECTED. Its reason: It is redundant.');
		expect(user).toContain("Learner's answer: 答え");
	});
});

describe('reviewRejections', () => {
	it('returns one review per rejected item from the review model', async () => {
		const parse = modelReturns({
			results: [{ acceptable: true, feedback: 'A native would accept it.' }]
		});
		const reviews = await reviewRejections(supabase, 7, card, [
			{ input: typedInput, first: { correct: false, feedback: 'x' } }
		]);
		expect(reviews).toEqual([{ acceptable: true, feedback: 'A native would accept it.' }]);
		expect(callClaudeMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ceiling' }));
		expect(parse.mock.calls[0][0].model).toBe('claude-opus-5-5');
		expect(parse.mock.calls[0][0].thinking).toEqual({ type: 'adaptive', display: 'omitted' });
	});

	it('makes no call when nothing was rejected', async () => {
		expect(await reviewRejections(supabase, 7, card, [])).toEqual([]);
		expect(callClaudeMock).not.toHaveBeenCalled();
	});
});
