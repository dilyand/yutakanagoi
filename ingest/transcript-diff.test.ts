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
});
