import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { env } from '$env/dynamic/private';

const MODEL = 'claude-sonnet-5';

const GradeAnswerResult = z.object({
	correct: z.boolean(),
	explanation: z.string()
});

const ExplainWordResult = z.object({
	meaning: z.string()
});

const EvaluateSentenceResult = z.object({
	feedback: z.string(),
	acceptable: z.boolean()
});

export type GradeAnswerRequest = { mode: 'grade_answer'; word: string; userAnswer: string };
export type ExplainWordRequest = { mode: 'explain_word'; word: string };
export type EvaluateSentenceRequest = {
	mode: 'evaluate_sentence';
	word: string;
	sentence: string;
};

export type EvaluateRequest = GradeAnswerRequest | ExplainWordRequest | EvaluateSentenceRequest;

function createClient() {
	const apiKey = env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new Error('ANTHROPIC_API_KEY must be set.');
	}
	return new Anthropic({ apiKey });
}

/**
 * Grades, explains, or evaluates a Japanese vocab drill interaction via the
 * Claude API. This is the only place in the app that calls Anthropic — the
 * deterministic due-word/box logic in $lib/drill-algorithm never touches an
 * LLM, by design (see the PWA migration plan).
 */
export async function evaluate(request: EvaluateRequest) {
	const client = createClient();

	switch (request.mode) {
		case 'grade_answer': {
			const response = await client.messages.parse({
				model: MODEL,
				max_tokens: 1024,
				thinking: { type: 'disabled' },
				output_config: { effort: 'low', format: zodOutputFormat(GradeAnswerResult) },
				system:
					'You are grading a Japanese vocabulary spaced-repetition drill. Given the ' +
					"target word and the learner's answer, judge whether they demonstrated real " +
					'understanding of its meaning or correct usage — accept a correct meaning even ' +
					"if loosely phrased, or a sentence that correctly uses the word. If it's wrong, " +
					'give a short explanation suitable for teaching the word to the learner.',
				messages: [
					{
						role: 'user',
						content: `Word: ${request.word}\nLearner's answer: ${request.userAnswer}`
					}
				]
			});
			return GradeAnswerResult.parse(response.parsed_output);
		}

		case 'explain_word': {
			const response = await client.messages.parse({
				model: MODEL,
				max_tokens: 1024,
				thinking: { type: 'disabled' },
				output_config: { effort: 'low', format: zodOutputFormat(ExplainWordResult) },
				system:
					'Explain the meaning of this Japanese word concisely for a language learner ' +
					'who got it wrong on a vocabulary drill. Include the reading if it helps.',
				messages: [{ role: 'user', content: `Word: ${request.word}` }]
			});
			return ExplainWordResult.parse(response.parsed_output);
		}

		case 'evaluate_sentence': {
			const response = await client.messages.parse({
				model: MODEL,
				max_tokens: 1024,
				thinking: { type: 'disabled' },
				output_config: { effort: 'low', format: zodOutputFormat(EvaluateSentenceResult) },
				system:
					'Given a Japanese word and a sentence a learner wrote using it, judge whether ' +
					'the sentence uses the word correctly (grammar and meaning) and give brief, ' +
					'encouraging feedback.',
				messages: [
					{
						role: 'user',
						content: `Word: ${request.word}\nSentence: ${request.sentence}`
					}
				]
			});
			return EvaluateSentenceResult.parse(response.parsed_output);
		}
	}
}
