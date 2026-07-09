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

export interface ConjugationHintResult {
	hint: string;
}

export interface ConjugationExampleResult {
	sentence: string;
	meaning: string;
}

export interface ConjugationLeniencyResult {
	acceptable: boolean;
	explanation: string;
}

export function getConjugationHint(
	word: string,
	wordClass: string,
	formId: string,
	userAnswer: string,
	canonicalAnswer: string
): Promise<ConjugationHintResult> {
	return authorizedPost('/api/evaluate', {
		mode: 'conjugation_hint',
		word,
		wordClass,
		formId,
		userAnswer,
		canonicalAnswer
	});
}

export function getConjugationExample(
	word: string,
	meaning: string,
	conjugatedForm: string
): Promise<ConjugationExampleResult> {
	return authorizedPost('/api/evaluate', {
		mode: 'conjugation_example',
		word,
		meaning,
		conjugatedForm
	});
}

export function checkConjugationLeniency(
	canonicalAnswer: string,
	userAnswer: string
): Promise<ConjugationLeniencyResult> {
	return authorizedPost('/api/evaluate', {
		mode: 'conjugation_leniency_check',
		canonicalAnswer,
		userAnswer
	});
}
