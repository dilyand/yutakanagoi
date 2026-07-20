// AnkiApp lets a card's Japanese field carry a furigana reading override
// using doubled corner brackets appended to the word, e.g. 過ぎる「「すぎる」」
// — meant to tell AnkiApp's own UI which reading to display, not to become
// part of the word itself.
function stripReadingOverride(word: string): string {
	return word.replace(/「+[^」]*」+\s*$/, '').trim();
}

export function parseAnkiAppDeck(xmlText: string): string[] {
	const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
	if (doc.querySelector('parsererror')) {
		throw new Error("Couldn't read this file as an AnkiApp deck export.");
	}

	const words = Array.from(doc.querySelectorAll('card > japanese'))
		.map((el) => stripReadingOverride((el.textContent ?? '').trim()))
		.filter((word) => word.length > 0);

	if (words.length === 0) {
		throw new Error('No words found — expected an AnkiApp deck export.');
	}

	return words;
}
