import { createAdminClient } from './lib/supabase-admin.ts';
import { hashPassword } from '../src/lib/server/password.ts';

// Passwords are never hardcoded here or written to any committed file —
// only ever passed at the shell, same convention as add-user.ts's username.
const username = process.argv[2];
const password = process.argv[3];
if (!username || !password) {
	console.error('Usage: npm run set-password -- <username> <password>');
	process.exit(1);
}

const supabase = createAdminClient();

const { data: user, error: findError } = await supabase
	.from('users')
	.select('id')
	.eq('username', username)
	.maybeSingle();
if (findError) {
	console.error('Failed to look up user:', findError.message);
	process.exit(1);
}
if (!user) {
	console.error(`No user named "${username}" — create it first with npm run add-user.`);
	process.exit(1);
}

const passwordHash = await hashPassword(password);
const { error: updateError } = await supabase
	.from('users')
	.update({ password_hash: passwordHash })
	.eq('id', user.id);
if (updateError) {
	console.error('Failed to set password:', updateError.message);
	process.exit(1);
}

console.log(`Password set for "${username}".`);
