import { authorizedPost } from './api-client';

export interface GradeAnswerResult {
	correct: boolean;
	explanation: string;
}

export interface ExplainWordResult {
	meaning: string;
}

export interface EvaluateSentenceResult {
	feedback: string;
	acceptable: boolean;
}

export function gradeAnswer(word: string, userAnswer: string): Promise<GradeAnswerResult> {
	return authorizedPost('/api/evaluate', { mode: 'grade_answer', word, userAnswer });
}

export function explainWord(word: string): Promise<ExplainWordResult> {
	return authorizedPost('/api/evaluate', { mode: 'explain_word', word });
}

export function evaluateSentence(word: string, sentence: string): Promise<EvaluateSentenceResult> {
	return authorizedPost('/api/evaluate', { mode: 'evaluate_sentence', word, sentence });
}
