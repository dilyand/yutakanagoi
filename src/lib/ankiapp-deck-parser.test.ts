// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseAnkiAppDeck } from './ankiapp-deck-parser';

const DECK_HEADER = `<deck name="HelloTalk" tags="Japanese"><config base="japanese"></config><fields><japanese name="Japanese" sides="11" furiganaMode="back"></japanese><text name="Meaning" sides="01" lang="en-US"><sources><translation><ref name="Japanese" /></translation></sources></text></fields><cards>`;
const DECK_FOOTER = `</cards></deck>`;

describe('parseAnkiAppDeck', () => {
	it('extracts the japanese field from each card', () => {
		const xml =
			DECK_HEADER +
			'<card><japanese name="Japanese">知り合う</japanese><text name="Meaning">get acquainted</text></card>' +
			'<card><japanese name="Japanese">魅力</japanese><text name="Meaning">charm</text></card>' +
			DECK_FOOTER;

		expect(parseAnkiAppDeck(xml)).toEqual(['知り合う', '魅力']);
	});

	it('decodes XML entities', () => {
		const xml =
			DECK_HEADER +
			'<card><japanese name="Japanese">味方でいる</japanese><text name="Meaning">I&apos;m on your side</text></card>' +
			DECK_FOOTER;

		expect(parseAnkiAppDeck(xml)).toEqual(['味方でいる']);
	});

	it('trims incidental whitespace/newlines around a word', () => {
		const xml =
			DECK_HEADER +
			'<card><japanese name="Japanese">\n異文化</japanese><text name="Meaning">different culture</text></card>' +
			DECK_FOOTER;

		expect(parseAnkiAppDeck(xml)).toEqual(['異文化']);
	});

	it('skips a card missing the japanese field without failing the whole parse', () => {
		const xml =
			DECK_HEADER +
			'<card><text name="Meaning">no word here</text></card>' +
			'<card><japanese name="Japanese">出会う</japanese><text name="Meaning">meet</text></card>' +
			DECK_FOOTER;

		expect(parseAnkiAppDeck(xml)).toEqual(['出会う']);
	});

	it("does not pick up the fields section's own japanese element", () => {
		const xml = DECK_HEADER + DECK_FOOTER;

		expect(() => parseAnkiAppDeck(xml)).toThrow(/No words found/);
	});

	it('throws on malformed XML', () => {
		expect(() => parseAnkiAppDeck('<deck><cards><card>')).toThrow(
			"Couldn't read this file as an AnkiApp deck export."
		);
	});

	it('throws when no cards are present', () => {
		expect(() => parseAnkiAppDeck('<deck><cards></cards></deck>')).toThrow(/No words found/);
	});
});
