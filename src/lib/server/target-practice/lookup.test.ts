import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { isHttpError } from '@sveltejs/kit';

const logError = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('$lib/server/logger', () => ({ logError }));

const callClaudeMock = vi.hoisted(() => vi.fn());
vi.mock('./claude-call', async (importOriginal) => ({
	...(await importOriginal<typeof import('./claude-call')>()),
	callClaude: callClaudeMock
}));

import { UsageCapError } from './claude-call';
import { lookupCandidates, lookupCard } from './lookup';
import { wordKibishii, contrastKimeruKimaru } from '$lib/target-practice/fixtures';
import type { Card } from '$lib/target-practice/types';

const supabase = {} as SupabaseClient;

/** Makes callClaude run the route's `call` against a fake client returning `parsed`. */
function modelReturns(parsed: unknown) {
	const parse = vi
		.fn()
		.mockResolvedValue({ usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: parsed });
	callClaudeMock.mockImplementation(async (opts: { call: (c: unknown) => unknown }) =>
		opts.call({ messages: { parse } })
	);
	return parse;
}

function body(card: Card) {
	const { ok: _ok, type: _type, target: _target, ...rest } = card; // eslint-disable-line @typescript-eslint/no-unused-vars
	return rest;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('lookupCandidates', () => {
	it('returns validated candidates, as a lookup call on the grading model', async () => {
		const parse = modelReturns({
			candidates: [
				{ target: '人気', reading: 'にんき', gloss: 'popularity' },
				{ target: '人気', reading: 'ひとけ', gloss: 'signs of people' }
			]
		});
		const result = await lookupCandidates(supabase, 7, 'word', '人気');

		expect(result).toEqual({
			status: 'ok',
			candidates: [
				{ target: '人気', reading: 'にんき', gloss: 'popularity' },
				{ target: '人気', reading: 'ひとけ', gloss: 'signs of people' }
			]
		});
		expect(callClaudeMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 7, kind: 'lookup' })
		);
		const args = parse.mock.calls[0][0];
		expect(args.model).toBe('claude-sonnet-5');
		expect(args.thinking).toEqual({ type: 'disabled' });
		expect(args.messages[0].content).toContain('<untrusted>');
	});

	it('logs dropped candidates and returns none when nothing survives', async () => {
		modelReturns({ candidates: [{ target: 'run', reading: 'ran', gloss: 'to run' }] });
		expect(await lookupCandidates(supabase, 7, 'word', 'to run')).toEqual({ status: 'none' });
		expect(logError).toHaveBeenCalledWith(
			'target-practice/lookup/candidates',
			expect.any(Error),
			expect.objectContaining({ dropped: [expect.objectContaining({ index: 0 })] })
		);
	});

	it('turns a usage cap into a limit outcome with the reset time', async () => {
		callClaudeMock.mockRejectedValue(
			new UsageCapError('cap_reached', 'lookup', new Date('2026-10-18T00:00:00Z'))
		);
		expect(await lookupCandidates(supabase, 7, 'word', '食べる')).toEqual({
			status: 'limit',
			reason: 'cap_reached',
			resetsAt: '2026-10-18T00:00:00.000Z',
			message: 'Daily lookup limit reached — it resets at 00:00 UTC.'
		});
	});

	it('reports the kill switch as its own limit reason', async () => {
		callClaudeMock.mockRejectedValue(
			new UsageCapError('disabled', 'lookup', new Date('2026-10-18T00:00:00Z'))
		);
		expect(await lookupCandidates(supabase, 7, 'word', '食べる')).toMatchObject({
			status: 'limit',
			reason: 'disabled',
			message: 'Target practice is switched off right now.'
		});
	});

	it('logs a model/SDK failure and raises a 502', async () => {
		callClaudeMock.mockRejectedValue(new Anthropic.AnthropicError('boom'));
		await expect(lookupCandidates(supabase, 7, 'word', '食べる')).rejects.toSatisfy((e) =>
			isHttpError(e, 502)
		);
		expect(logError).toHaveBeenCalled();
	});

	it('lets unexpected errors (a database failure) propagate unchanged', async () => {
		const dbError = new Error('db down');
		callClaudeMock.mockRejectedValue(dbError);
		await expect(lookupCandidates(supabase, 7, 'word', '食べる')).rejects.toBe(dbError);
	});
});

describe('lookupCard', () => {
	const confirmed = { type: 'word' as const, target: wordKibishii.card.target };

	it('returns the validated card, with a larger timeout and the type-specific schema', async () => {
		const parse = modelReturns({ result: { card: body(wordKibishii.card) } });
		const result = await lookupCard(supabase, 7, confirmed);

		expect(result).toEqual({ status: 'ok', card: wordKibishii.card });
		expect(callClaudeMock).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'lookup', timeoutMs: 25_000 })
		);
		expect(parse.mock.calls[0][0].max_tokens).toBe(2048);
	});

	it('returns a rejection with the suggested type', async () => {
		modelReturns({ result: { reason: 'That is a set phrase.', suggestedType: 'set_phrase' } });
		expect(await lookupCard(supabase, 7, { type: 'word', target: 'お疲れ様です' })).toEqual({
			status: 'rejected',
			reason: 'That is a set phrase.',
			suggestedType: 'set_phrase'
		});
	});

	it('rejects a similar_kanji Contrast as not supported', async () => {
		const card = { ...body(contrastKimeruKimaru.card), contrastKind: 'similar_kanji' };
		modelReturns({ result: { card } });
		const result = await lookupCard(supabase, 7, {
			type: 'contrast',
			target: '決める vs 決まる',
			sides: ['決める', '決まる']
		});
		expect(result).toMatchObject({
			status: 'rejected',
			reason: expect.stringMatching(/not supported/)
		});
	});

	it('logs the problems of a malformed card and raises a 502', async () => {
		modelReturns({ result: { card: { ...body(wordKibishii.card), senses: [] } } });
		await expect(lookupCard(supabase, 7, confirmed)).rejects.toSatisfy((e) => isHttpError(e, 502));
		expect(logError).toHaveBeenCalledWith(
			'target-practice/lookup/card',
			expect.any(Error),
			expect.objectContaining({
				problems: expect.arrayContaining([expect.stringMatching(/senses/)])
			})
		);
	});

	it('turns a usage cap into a limit outcome', async () => {
		callClaudeMock.mockRejectedValue(
			new UsageCapError('cap_reached', 'lookup', new Date('2026-10-18T00:00:00Z'))
		);
		expect(await lookupCard(supabase, 7, confirmed)).toMatchObject({ status: 'limit' });
	});
});
