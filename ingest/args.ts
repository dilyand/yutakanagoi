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

/**
 * Rejects a value that isn't safe to use as a single filesystem path
 * segment — every ingestion command builds
 * ingest/work/<user>/<slug>/... directly from --user/--slug (or, in
 * ingest:transcribe's case, a slug derived from the audio filename via
 * deriveListName), with nothing else constraining their characters.
 * "..", "/", or "\" in either lets a malformed value navigate outside the
 * intended per-user work directory — deriveListName can itself produce
 * ".." for a filename like "...m4a" (its extension-stripping and
 * separator-collapsing never touches literal dots), so this needs to run
 * on both raw CLI input and any derived value.
 */
export function requireSafePathComponent(value: string, label: string): string {
	if (
		value === '' ||
		value === '.' ||
		value === '..' ||
		value.includes('/') ||
		value.includes('\\')
	) {
		console.error(
			`"${value}" is not a valid ${label} — must not be empty, ".", "..", or contain "/" or "\\".`
		);
		process.exit(1);
	}
	return value;
}
