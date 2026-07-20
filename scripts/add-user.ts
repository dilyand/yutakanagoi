import { createAdminClient } from './lib/supabase-admin.ts';
import { hashPassword } from '../src/lib/server/password.ts';

// Usernames/passwords are never hardcoded here or written to any committed
// file — only ever passed at the shell and stored in the `users` table.
// password_hash is NOT NULL (see supabase/README.md), so both are required
// up front rather than leaving a user row briefly unauthenticatable between
// this and a separate `npm run set-password` call.
const username = process.argv[2];
const password = process.argv[3];
if (!username || !password) {
	console.error('Usage: npm run add-user -- <username> <password>');
	process.exit(1);
}

const supabase = createAdminClient();

const passwordHash = await hashPassword(password);
const { error } = await supabase.from('users').insert({ username, password_hash: passwordHash });
if (error) {
	if (error.code === '23505') {
		console.error(`A user named "${username}" already exists.`);
	} else {
		console.error('Failed to add user:', error.message);
	}
	process.exit(1);
}

console.log(`Added user "${username}".`);
