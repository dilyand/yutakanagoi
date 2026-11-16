import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { insertFlag } from './flags-repository';

function fakeSupabase(result: { error: unknown }) {
	const insert = vi.fn().mockResolvedValue(result);
	const from = vi.fn(() => ({ insert }));
	return { client: { from } as unknown as SupabaseClient, from, insert };
}

describe('insertFlag', () => {
	it('inserts a row scoped to the user, with null for absent fields', async () => {
		const { client, from, insert } = fakeSupabase({ error: null });
		await insertFlag(client, 7, {
			type: 'word',
			targetKey: '厳しい|きびしい',
			reason: 'card_wrong',
			note: '  '
		});
		expect(from).toHaveBeenCalledWith('target_practice_flags');
		expect(insert).toHaveBeenCalledWith({
			user_id: 7,
			type: 'word',
			target_key: '厳しい|きびしい',
			phase: null,
			item: null,
			reason: 'card_wrong',
			note: null
		});
	});

	it('throws a database error', async () => {
		const { client } = fakeSupabase({ error: new Error('db') });
		await expect(
			insertFlag(client, 7, { type: 'word', targetKey: 'k', reason: 'other' })
		).rejects.toThrow('db');
	});
});
