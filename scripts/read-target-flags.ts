import { createAdminClient } from './lib/supabase-admin.ts';

// Reads the most recent target-practice flag-button reports (table
// target_practice_flags, written by /api/target/flag) — read to tune the
// generation prompts, not a per-item fix queue. See supabase/README.md.
// Usage: npm run logs:flags [-- <limit>]
const limit = Number(process.argv[2]) || 30;

const supabase = createAdminClient();

const { data, error } = await supabase
	.from('target_practice_flags')
	.select('created_at, type, target_key, phase, reason, note, item')
	.order('created_at', { ascending: false })
	.limit(limit);

if (error) {
	console.error('Failed to read target_practice_flags:', error.message);
	process.exit(1);
}

if (!data || data.length === 0) {
	console.log('No target_practice_flags rows found.');
} else {
	for (const row of data) {
		const where = row.phase ? `${row.phase} item` : 'card';
		console.log(`[${row.created_at}] ${row.type} ${row.target_key} — ${where} — ${row.reason}`);
		if (row.note) console.log(`  note: ${row.note}`);
		if (row.item) console.log(`  item: ${JSON.stringify(row.item)}`);
	}
}
