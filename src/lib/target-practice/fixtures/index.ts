import { contrastKimeruKimaru } from './contrast-kimeru-kimaru';
import { grammarKakadouka } from './grammar-kakadouka';
import { kanjiKai } from './kanji-kai';
import { setPhraseOtsukaresama } from './set-phrase-otsukaresama';
import { wordKibishii } from './word-kibishii';
import type { Fixture } from './build';

export type { Fixture } from './build';
export { contrastKimeruKimaru, grammarKakadouka, kanjiKai, setPhraseOtsukaresama, wordKibishii };

/** The five Appendix A sessions: golden fixtures for the validators and eval cases for prompt tuning. */
export const allFixtures: Fixture[] = [
	grammarKakadouka,
	contrastKimeruKimaru,
	wordKibishii,
	kanjiKai,
	setPhraseOtsukaresama
];
