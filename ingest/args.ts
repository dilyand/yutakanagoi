/**
 * Minimal `--flag value` / `--flag` (boolean) argv parser — no dependency,
 * matching how every existing script in this repo (add-user.ts,
 * set-password.ts, ...) avoids pulling in a CLI-parsing library for a
 * handful of flags.
 */
export function parseArgs(argv: string[]): Record<string, string | true> {
	const args: Record<string, string | true> = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('--')) continue;
		const key = arg.slice(2);
		const next = argv[i + 1];
		if (next !== undefined && !next.startsWith('--')) {
			args[key] = next;
			i++;
		} else {
			args[key] = true;
		}
	}
	return args;
}

export function requireString(
	args: Record<string, string | true>,
	key: string,
	usage: string
): string {
	const value = args[key];
	if (typeof value !== 'string' || value.length === 0) {
		console.error(`Missing --${key}.\n\n${usage}`);
		process.exit(1);
	}
	return value;
}
