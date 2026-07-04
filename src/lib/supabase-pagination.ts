import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;

/**
 * Fetches every row for a table/column selection, paginating past PostgREST's
 * default max_rows cap (1000 by default — see supabase/config.toml's
 * [api].max_rows) instead of silently truncating results. `eqFilters` applies
 * an `.eq(column, value)` per entry (e.g. `{ list_id: listId }`) before paging.
 */
export async function fetchAllRows<T>(
	supabase: SupabaseClient,
	table: string,
	columns: string,
	eqFilters: Record<string, string | number> = {}
): Promise<T[]> {
	const rows: T[] = [];
	let from = 0;

	for (;;) {
		let query = supabase.from(table).select(columns);
		for (const [column, value] of Object.entries(eqFilters)) {
			query = query.eq(column, value);
		}
		const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
		if (error) throw error;

		const page = (data ?? []) as T[];
		rows.push(...page);
		if (page.length < PAGE_SIZE) break;
		from += PAGE_SIZE;
	}

	return rows;
}
