import { describe, expect, it } from 'vitest';
import { compareTranscripts } from './transcript-diff.ts';

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
});
