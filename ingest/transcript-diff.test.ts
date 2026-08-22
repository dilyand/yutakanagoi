import { describe, expect, it } from 'vitest';
import { compareTranscripts, bestSubstringSimilarity } from './transcript-diff.ts';

describe('compareTranscripts', () => {
	it('does not flag a transcript that matches the ASR pass closely', () => {
		const supplied = 'おはよう。今日はいい天気ですね。散歩に行きました。';
		const asr = 'おはよう今日はいい天気ですね散歩に行きました';
		const report = compareTranscripts(supplied, asr);
		expect(report.diverged).toBe(false);
		expect(report.divergentSentences).toHaveLength(0);
	});

	it('flags an extra clause the ASR pass never produced — the real hallucination case from the feasibility work', () => {
		const supplied = 'おはよう。今日はいい天気ですね。これをたくさん買いました。散歩に行きました。';
		const asr = 'おはよう今日はいい天気ですね散歩に行きました';
		const report = compareTranscripts(supplied, asr);
		expect(report.diverged).toBe(true);
		expect(report.divergentSentences).toContain('これをたくさん買いました。');
	});

	it('tolerates minor wording differences without flagging the whole transcript', () => {
		const supplied = 'あの、中古だけど結構新しい靴を買って、試してみた。';
		const asr = 'あの中古の中古だけど結構新しい靴を買ってこれを試してみる';
		const report = compareTranscripts(supplied, asr);
		expect(report.overallSimilarity).toBeGreaterThan(0.5);
	});

	it('flags a transcript that is unrelated to the ASR pass entirely', () => {
		const supplied = 'これはまったく違う内容の文章です。全然関係ありません。';
		const asr = '今日は天気がいいですね散歩に行きましょう';
		const report = compareTranscripts(supplied, asr);
		expect(report.diverged).toBe(true);
	});

	it('flags a localized hallucination even on a long recording where whole-text similarity stays above threshold', () => {
		// Without checking divergentSentences, this exact case slips through:
		// one fully invented sentence dilutes to a small fraction of a long
		// transcript's total characters, keeping overallSimilarity above
		// DIVERGENCE_THRESHOLD (0.75) even though it's exactly the kind of
		// localized hallucination this gate exists to catch.
		const sentences = [
			'おはよう。',
			'今日はいい天気ですね。',
			'公園まで散歩に行きました。',
			'桜がきれいに咲いていました。',
			'途中でコーヒーを買いました。',
			'友達と少し話しました。',
			'それから家に帰りました。',
			'夕方は本を読みました。',
			'夜ご飯はカレーを作りました。',
			'とても美味しかったです。'
		];
		const fake = 'これは完全に無関係などこかの誰かの話です。';
		const supplied = sentences.slice(0, 5).join('') + fake + sentences.slice(5).join('');
		const asr = sentences.join('').replace(/[。、！？]/g, '');
		const report = compareTranscripts(supplied, asr);
		expect(report.overallSimilarity).toBeGreaterThan(0.75);
		expect(report.divergentSentences).toContain(fake);
		expect(report.diverged).toBe(true);
	});

	it('flags a localized hallucination in a supplied transcript that uses ASCII punctuation instead of full-width marks', () => {
		// Without splitting on ASCII .!? too, a transcript that uses ordinary
		// periods has no 。！？ anywhere, so splitSentences returns the whole
		// text as one "sentence" — the per-sentence check degrades to an
		// aggregate comparison and can't localize a single invented sentence.
		const sentences = [
			'Good morning.',
			'The weather is nice today.',
			'I went for a walk in the park.',
			'The cherry blossoms were blooming.',
			'I bought some coffee on the way.',
			'I talked with a friend for a while.',
			'Then I went back home.',
			'In the evening I read a book.',
			'For dinner I made curry.',
			'It was very delicious.'
		];
		const fake = 'This is a completely unrelated made up sentence.';
		const supplied =
			sentences.slice(0, 5).join(' ') + ' ' + fake + ' ' + sentences.slice(5).join(' ');
		const asr = sentences.join(' ').replace(/[.]/g, '');
		const report = compareTranscripts(supplied, asr);
		expect(report.overallSimilarity).toBeGreaterThan(0.75);
		expect(report.divergentSentences).toContain(fake);
		expect(report.diverged).toBe(true);
	});

	it('flags an ASR-only span — a clause whisper invented that the supplied transcript never had', () => {
		// The mirror image of the localized-hallucination case: the *ASR*
		// side has one clause the supplied transcript doesn't. Checking only
		// supplied-sentence-against-ASR-text misses this direction entirely.
		// Uses whisper's own segment boundaries (not asrText's punctuation,
		// which routinely doesn't exist) to localize it.
		const sentences = [
			'おはよう。',
			'今日はいい天気ですね。',
			'公園まで散歩に行きました。',
			'桜がきれいに咲いていました。',
			'途中でコーヒーを買いました。',
			'友達と少し話しました。',
			'それから家に帰りました。',
			'夕方は本を読みました。',
			'夜ご飯はカレーを作りました。',
			'とても美味しかったです。'
		];
		const fakeSegment = 'これは完全に無関係などこかの誰かの話です';
		const asrSegments = [...sentences.slice(0, 5), fakeSegment, ...sentences.slice(5)].map((s) =>
			s.replace(/[。、！？]/g, '')
		);
		const asrText = asrSegments.join('');
		const supplied = sentences.join('');
		const report = compareTranscripts(supplied, asrText, asrSegments);
		expect(report.overallSimilarity).toBeGreaterThan(0.75);
		expect(report.divergentSentences).toHaveLength(0);
		expect(report.asrOnlySpans).toContain(fakeSegment);
		expect(report.diverged).toBe(true);
	});

	it('does not flag anything when no asrSegments are supplied — backward compatible for callers with only plain ASR text', () => {
		const supplied = 'おはよう。今日はいい天気ですね。散歩に行きました。';
		const asr = 'おはよう今日はいい天気ですね散歩に行きました';
		const report = compareTranscripts(supplied, asr);
		expect(report.asrOnlySpans).toHaveLength(0);
	});
});

describe('bestSubstringSimilarity (code review regression)', () => {
	it('scores an exact match at the end of haystack as 1, even when its start position is not a multiple of step', () => {
		// step = floor(needle.length / 4) = 5. The exact match starts at
		// index 3 (haystack.length - needle.length), which a `for (i += 5)`
		// scan starting at 0 never lands on (0, 5, 10, ... all overshoot or
		// undershoot 3) — without always evaluating the last valid start
		// position, the only window ever scored is the misaligned one at
		// i=0, which scores well below 1 despite an exact match existing.
		const needle = 'abcdefghijklmnopqrst'; // 20 chars
		const haystack = 'xyz' + needle; // exact match starts at index 3
		expect(bestSubstringSimilarity(needle, haystack)).toBe(1);
	});
});
