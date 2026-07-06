import { createAdminClient } from './lib/supabase-admin.ts';

// Reads the most recent rows from error_events (written by
// src/lib/server/logger.ts) — a one-command way to see recent production
// errors without going through the Vercel dashboard. See supabase/README.md.
const LIMIT = 50;

const supabase = createAdminClient();

const { data, error } = await supabase
	.from('error_events')
	.select('occurred_at, route, message, context')
	.order('occurred_at', { ascending: false })
	.limit(LIMIT);

if (error) {
	console.error('Failed to read error_events:', error.message);
	process.exit(1);
}

if (!data || data.length === 0) {
	console.log('No error_events rows found.');
} else {
	for (const row of data) {
		console.log(`[${row.occurred_at}] ${row.route ?? '(unknown route)'}: ${row.message}`);
		if (row.context && Object.keys(row.context).length > 0) {
			console.log(`  context: ${JSON.stringify(row.context)}`);
		}
	}
}
