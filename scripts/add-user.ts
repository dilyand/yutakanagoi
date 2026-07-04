import { createAdminClient } from './lib/supabase-admin.ts';

// Usernames are never hardcoded here or written to any committed file — only
// ever passed at the shell and stored in the `users` table.
const username = process.argv[2];
if (!username) {
	console.error('Usage: npm run add-user -- <username>');
	process.exit(1);
}

const supabase = createAdminClient();

const { error } = await supabase.from('users').insert({ username });
if (error) {
	if (error.code === '23505') {
		console.error(`A user named "${username}" already exists.`);
	} else {
		console.error('Failed to add user:', error.message);
	}
	process.exit(1);
}

console.log(`Added user "${username}".`);
