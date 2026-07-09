export function deriveListName(filename: string): string {
	const dotIndex = filename.lastIndexOf('.');
	const withoutExtension = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;

	return withoutExtension
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/[\s_]+/g, '-')
		.toLowerCase()
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}
