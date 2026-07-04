export interface VocabMasterEntry {
	word: string;
	frequencyRank: number;
}

/** Parses vocab-master.md's `- word` bullet list, in file order = frequency rank. */
export function parseVocabMaster(markdown: string): VocabMasterEntry[] {
	const entries: VocabMasterEntry[] = [];
	let rank = 0;
	for (const line of markdown.split('\n')) {
		const match = line.match(/^- (.+)$/);
		if (!match) continue;
		rank += 1;
		entries.push({ word: match[1].trim(), frequencyRank: rank });
	}
	return entries;
}

export interface WordStateEntry {
	word: string;
	box: number;
	lastSession: number;
}

export interface VocabState {
	sessionIndex: number;
	words: WordStateEntry[];
}

/** Parses vocab-state.md's `session_index: N` header and `word | box | last_session` table. */
export function parseVocabState(markdown: string): VocabState {
	const lines = markdown.split('\n');

	const sessionIndexLine = lines.find((line) => line.trim().startsWith('session_index:'));
	if (!sessionIndexLine) {
		throw new Error('vocab-state.md is missing a "session_index:" line');
	}
	const sessionIndex = Number(sessionIndexLine.split(':')[1]?.trim());
	if (!Number.isInteger(sessionIndex)) {
		throw new Error(`could not parse session_index from: "${sessionIndexLine}"`);
	}

	const words: WordStateEntry[] = [];
	for (const line of lines) {
		if (!line.includes('|')) continue;
		const cells = line.split('|').map((cell) => cell.trim());
		if (cells.length !== 3) continue;
		const [word, boxStr, lastSessionStr] = cells;
		if (word === 'word' || word === '') continue; // header row

		const box = Number(boxStr);
		const lastSession = Number(lastSessionStr);
		if (!Number.isInteger(box) || !Number.isInteger(lastSession)) {
			throw new Error(`could not parse table row: "${line}"`);
		}
		words.push({ word, box, lastSession });
	}

	return { sessionIndex, words };
}
