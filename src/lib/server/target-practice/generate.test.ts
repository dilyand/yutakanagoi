import { beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { isHttpError } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';

const logError = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('$lib/server/logger', () => ({ logError }));

const recordPracticedTarget = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('./history-repository', () => ({ recordPracticedTarget }));

const callClaudeMock = vi.hoisted(() => vi.fn());
vi.mock('./claude-call', async (importOriginal) => ({
	...(await importOriginal<typeof import('./claude-call')>()),
	callClaude: callClaudeMock
}));

import { cardForGeneration } from './generation-prompts';
import { UsageCapError } from './claude-call';
import { generateStage } from './generate';
import { wirePayload } from './wire-test-support';
import type { RegenerationRequest } from '$lib/target-practice/generation';
import { grammarKakadouka, wordKibishii } from '$lib/target-practice/fixtures';
import type { Fixture } from '$lib/target-practice/fixtures';
import { skeletonFor } from '$lib/target-practice/skeleton';
import type { Item } from '$lib/target-practice/types';

const supabase = {} as SupabaseClient;
const card = grammarKakadouka.card;

// What the model parsed to: wire items under one key per phase of the stage.
const s1 = (items: Item[], spares?: Item[]) => wirePayload(card, 1, items, spares);
const s2 = (items: Item[], spares?: Item[]) => wirePayload(card, 2, items, spares);
/** The payload for a regeneration that asked for `phases` (no spares key). */
const regen = (items: Item[], ...phases: RegenerationRequest['phase'][]) =>
	wirePayload(
		card,
		phases.some((p) => p === 'produce' || p === 'use' || p === 'contrast') ? 2 : 1,
		items,
		undefined,
		phases.map((phase) => ({ phase, need: 1, coverage: [], reasons: [] }))
	);

const stageItems = (fx: Fixture, stage: 1 | 2) =>
	fx.items.filter((i) => skeletonFor(fx.card).find((p) => p.id === i.phase)?.stage === stage);
const ids = (items: Item[]) => items.map((i) => i.id.replace(/^s\d+a\d+-/, ''));

/**
 * Each queued entry answers one callClaude: a payload (what the model parsed
 * to), or an Error to throw. The fake client's `parse` is shared so tests can
 * read the prompts it received.
 */
function modelAnswers(...queue: (object | Error)[]) {
	const parse = vi.fn();
	callClaudeMock.mockImplementation(async (opts: { call: (c: unknown) => unknown }) => {
		const next = queue.shift();
		if (next instanceof Error) throw next;
		parse.mockResolvedValueOnce({
			usage: { input_tokens: 1, output_tokens: 1 },
			parsed_output: next
		});
		return opts.call({ messages: { parse } });
	});
	return parse;
}

const run = (over: Partial<Parameters<typeof generateStage>[2]> = {}) =>
	generateStage(supabase, 7, { stage: 1, card, retry: false, avoid: [], ...over });

beforeEach(() => {
	vi.clearAllMocks();
});

describe('generateStage: a clean stage', () => {
	it('stage 1: opens a session, validates, records the target', async () => {
		const parse = modelAnswers(s1(stageItems(grammarKakadouka, 1)));
		const result = await run();

		expect(result).toMatchObject({ status: 'ok', stage: 1, setIssues: [], regenerated: false });
		if (result.status !== 'ok') throw new Error('unreachable');
		expect(ids(result.items)).toEqual(['understand0', 'understand1', 'understand2', 'understand3']);
		expect(callClaudeMock).toHaveBeenCalledTimes(1);
		expect(callClaudeMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 7,
				kind: 'session',
				maxRetries: 0,
				timeoutMs: 50_000
			})
		);
		expect(parse).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'claude-sonnet-5',
				max_tokens: 6000,
				thinking: { type: 'disabled' }
			})
		);
		expect(recordPracticedTarget).toHaveBeenCalledWith(supabase, 7, card);
	});

	it('a retried stage 1 and every stage 2 only spend against the ceiling', async () => {
		modelAnswers(s1(stageItems(grammarKakadouka, 1)));
		await run({ retry: true });
		expect(callClaudeMock).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'ceiling' }));

		modelAnswers(s2(stageItems(grammarKakadouka, 2)));
		await run({ stage: 2 });
		expect(callClaudeMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ kind: 'ceiling', timeoutMs: 70_000 })
		);
	});

	it('stage 2 does not touch the learner’s history', async () => {
		modelAnswers(s2(stageItems(grammarKakadouka, 2)));
		await run({ stage: 2 });
		expect(recordPracticedTarget).not.toHaveBeenCalled();
	});

	it('puts the card, the avoid list and the stage in the prompt', async () => {
		const parse = modelAnswers(s1(stageItems(grammarKakadouka, 1)));
		await run({ avoid: ['昨日は雨でした。'] });
		const args = parse.mock.calls[0][0];
		expect(args.system).toContain('PHASES — one key under "items"');
		expect(args.messages[0].content).toContain(JSON.stringify(cardForGeneration(card)));
		expect(args.messages[0].content).toContain('昨日は雨でした。');
	});
});

describe('generateStage: failures that need nothing from the model', () => {
	it('a cap hit is a limit outcome and records nothing', async () => {
		modelAnswers(new UsageCapError('cap_reached', 'session', new Date('2026-10-18T00:00:00Z')));
		const result = await run();
		expect(result).toEqual({
			status: 'limit',
			reason: 'cap_reached',
			resetsAt: '2026-10-18T00:00:00.000Z',
			message: 'Daily practice session limit reached — it resets at 00:00 UTC.'
		});
		expect(recordPracticedTarget).not.toHaveBeenCalled();
	});

	it('a model failure is logged and becomes a 502', async () => {
		modelAnswers(new Anthropic.APIConnectionError({ message: 'boom' }));
		const err = await run().catch((e) => e);
		expect(isHttpError(err, 502)).toBe(true);
		expect(logError).toHaveBeenCalledWith(
			'target-practice/generate/stage1',
			expect.anything(),
			expect.objectContaining({ type: 'grammar' })
		);
		expect(recordPracticedTarget).not.toHaveBeenCalled();
	});

	it('output that does not fit the schema is also a logged 502', async () => {
		modelAnswers({ items: 'nope' });
		const err = await run().catch((e) => e);
		expect(isHttpError(err, 502)).toBe(true);
		expect(logError).toHaveBeenCalled();
	});
});

describe('generateStage: spares and regeneration', () => {
	const understand = stageItems(grammarKakadouka, 1);

	it('promotes a spare into a short phase without a second call', async () => {
		modelAnswers(s1(understand.slice(0, 3), understand.slice(3)));
		const result = await run();
		if (result.status !== 'ok') throw new Error('unreachable');
		expect(callClaudeMock).toHaveBeenCalledTimes(1);
		expect(result.regenerated).toBe(false);
		expect(result.items).toHaveLength(4);
		expect(result.items.some((i) => i.spare)).toBe(false);
	});

	it('keeps spares that are not needed as spares', async () => {
		const stage2 = stageItems(grammarKakadouka, 2);
		modelAnswers(s2(stage2));
		const result = await run({ stage: 2 });
		if (result.status !== 'ok') throw new Error('unreachable');
		expect(result.items.filter((i) => i.spare).map((i) => i.id)).toEqual(['s2a1-producex0']);
		expect(result.setIssues).toEqual([]);
	});

	it('refills a phase below its minimum with one smaller call, then records the target', async () => {
		const parse = modelAnswers(
			s1(understand.slice(0, 1)), // 1 valid understand item: below the minimum of 2
			regen(understand.slice(1), 'understand')
		);
		const result = await run();
		if (result.status !== 'ok') throw new Error('unreachable');

		expect(result.regenerated).toBe(true);
		expect(result.setIssues).toEqual([]);
		expect(ids(result.items)).toEqual(['understand0', 'understand0', 'understand1', 'understand2']); // a1 #0, then a2 #0..2
		expect(callClaudeMock).toHaveBeenCalledTimes(2);
		expect(callClaudeMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ kind: 'ceiling', timeoutMs: 40_000 })
		);
		const second = parse.mock.calls[1][0];
		expect(second.max_tokens).toBe(3000);
		expect(second.messages[0].content).toContain('second attempt');
		expect(second.messages[0].content).toContain('understand: 3 more items');
		// What exists already is passed along so the model doesn't repeat it.
		expect(second.messages[0].content).toContain(understand[0].sentence);
		expect(recordPracticedTarget).toHaveBeenCalledTimes(1);
	});

	it('regenerates when a phase is above the minimum but short of its target (2 of 4), in either stage', async () => {
		const parse = modelAnswers(
			s1(understand.slice(0, 2)),
			regen(understand.slice(2), 'understand')
		);
		const result = await run();
		if (result.status !== 'ok') throw new Error('unreachable');
		expect(callClaudeMock).toHaveBeenCalledTimes(2);
		expect(parse.mock.calls[1][0].messages[0].content).toContain('understand: 2 more items');
		expect(result.items).toHaveLength(4);
		expect(result.setIssues).toEqual([]);

		const stage2 = stageItems(grammarKakadouka, 2).filter((i) => !i.spare);
		const second = modelAnswers(
			s2(stage2.filter((i) => i.id !== 'g-p1' && i.id !== 'g-p2')),
			regen(
				stage2.filter((i) => i.id === 'g-p1' || i.id === 'g-p2'),
				'produce'
			)
		);
		await run({ stage: 2 });
		expect(second.mock.calls[1][0].messages[0].content).toContain('produce: 2 more items');
	});

	it('does not regenerate when spares fill the gap', async () => {
		modelAnswers(s1(understand.slice(0, 2), understand.slice(2)));
		await run();
		expect(callClaudeMock).toHaveBeenCalledTimes(1);
	});

	it('regenerates at most once', async () => {
		modelAnswers(s1(understand.slice(0, 1)), regen([], 'understand'));
		const result = await run();
		if (result.status !== 'ok') throw new Error('unreachable');
		expect(callClaudeMock).toHaveBeenCalledTimes(2);
		expect(result.setIssues.map((i) => i.code)).toEqual(['phase_below_minimum']);
		// An unusable stage 1 is not "practised".
		expect(recordPracticedTarget).not.toHaveBeenCalled();
	});

	it('survives a failed regeneration: first result, issues reported, failure logged', async () => {
		modelAnswers(s1(understand.slice(0, 1)), new Anthropic.APIConnectionError({ message: 'boom' }));
		const result = await run();
		if (result.status !== 'ok') throw new Error('unreachable');
		expect(result.regenerated).toBe(false);
		expect(result.items).toHaveLength(1);
		expect(result.setIssues.map((i) => i.code)).toEqual(['phase_below_minimum']);
		expect(logError).toHaveBeenCalledWith(
			'target-practice/generate/stage1-regenerate',
			expect.anything(),
			expect.anything()
		);
	});

	it('a cap hit during regeneration is not an error', async () => {
		modelAnswers(
			s1(understand.slice(0, 1)),
			new UsageCapError('cap_reached', 'ceiling', new Date())
		);
		const result = await run();
		expect(result.status).toBe('ok');
		expect(logError).not.toHaveBeenCalledWith(
			'target-practice/generate/stage1-regenerate',
			expect.anything(),
			expect.anything()
		);
	});

	it('logs dropped items with their reasons', async () => {
		const broken = s1(understand, []);
		(broken.items.understand[3] as Record<string, unknown>).kana = '';
		modelAnswers(broken);
		await run();
		expect(logError).toHaveBeenCalledWith(
			'target-practice/generate/outcome',
			expect.anything(),
			expect.objectContaining({
				stage: 1,
				attempt: 1,
				// By phase, so a phase the model left out entirely is visible.
				received: { understand: 4 },
				dropped: [
					{
						id: 's1a1-understand3',
						reason: expect.stringMatching(/^kana: sentence has no kana/),
						// A truncated copy of what the model wrote, for prompt tuning.
						item: expect.stringContaining('"id":"s1a1-understand3"')
					}
				]
			})
		);
	});

	it('drops items repeating a sentence from an earlier round', async () => {
		modelAnswers(s1(understand));
		const result = await run({ avoid: [understand[0].sentence!] });
		if (result.status !== 'ok') throw new Error('unreachable');
		expect(ids(result.items)).toEqual(['understand1', 'understand2', 'understand3']);
	});
});

describe('generateStage: history is best-effort', () => {
	it('logs a failed history write and still returns the session', async () => {
		recordPracticedTarget.mockRejectedValueOnce(new Error('db down'));
		modelAnswers(s1(stageItems(grammarKakadouka, 1)));
		const result = await run();
		expect(result.status).toBe('ok');
		expect(logError).toHaveBeenCalledWith(
			'target-practice/generate/history',
			expect.objectContaining({ message: 'db down' }),
			expect.objectContaining({ targetKey: '〜かどうか' })
		);
	});

	it('uses the Word key (target|reading) for the log context', async () => {
		recordPracticedTarget.mockRejectedValueOnce(new Error('db down'));
		modelAnswers(wirePayload(wordKibishii.card, 1, stageItems(wordKibishii, 1)));
		await generateStage(supabase, 7, {
			stage: 1,
			card: wordKibishii.card,
			retry: false,
			avoid: []
		});
		expect(logError).toHaveBeenCalledWith(
			'target-practice/generate/history',
			expect.anything(),
			expect.objectContaining({ targetKey: '厳しい|きびしい' })
		);
	});
});
