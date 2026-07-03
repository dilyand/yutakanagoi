import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;

/**
 * Fetches every row for a table/column selection, paginating past PostgREST's
 * default max_rows cap (1000 by default — see supabase/config.toml's
 * [api].max_rows) instead of silently truncating results.
 */
export async function fetchAllRows<T>(
	supabase: SupabaseClient,
	table: string,
	columns: string
): Promise<T[]> {
	const rows: T[] = [];
	let from = 0;

	for (;;) {
		const { data, error } = await supabase
			.from(table)
			.select(columns)
			.range(from, from + PAGE_SIZE - 1);
		if (error) throw error;

		const page = (data ?? []) as T[];
		rows.push(...page);
		if (page.length < PAGE_SIZE) break;
		from += PAGE_SIZE;
	}

	return rows;
}
