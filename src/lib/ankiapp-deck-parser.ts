export function parseAnkiAppDeck(xmlText: string): string[] {
	const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
	if (doc.querySelector('parsererror')) {
		throw new Error("Couldn't read this file as an AnkiApp deck export.");
	}

	const words = Array.from(doc.querySelectorAll('card > japanese'))
		.map((el) => (el.textContent ?? '').trim())
		.filter((word) => word.length > 0);

	if (words.length === 0) {
		throw new Error('No words found — expected an AnkiApp deck export.');
	}

	return words;
}
