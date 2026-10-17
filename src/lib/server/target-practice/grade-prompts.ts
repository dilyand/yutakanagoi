import { NO_ROMAJI_NOTE, UNTRUSTED_INPUT_NOTE, tagUntrusted } from '$lib/server/claude-shared';
import type { GradeInput } from '$lib/target-practice/grade';
import type { Card } from '$lib/target-practice/types';

/**
 * Prompt for the grade route (design doc §7): the typed-answer fallback and
 * Use-phase grading, list-shaped. The card is the grounding (so "uses the
 * target correctly" is judged against it, not the model's recall); the card,
 * the task text and the learner's answer all come from the client, so all of
 * it goes in <untrusted> tags.
 */

const ROLE =
	"You grade a Japanese learner's answers in a practice session on ONE target. The confirmed " +
	'target card is the only source of truth about the target. Grade each numbered item on its own ' +
	'and return exactly one result per item, in the same order. "correct" is true only when the ' +
	'answer is acceptable for the task; "feedback" is one or two sentences of English for the learner. ' +
	'Write the feedback in ENGLISH even though the learner answers in Japanese — never reply to the ' +
	'learner in Japanese; use Japanese script only to quote or correct their words, never romaji. ' +
	'Comment only on words the learner actually wrote: do not mention a particle or word that is not in their answer.';

const TYPED_RULES =
	'TYPED items: the learner typed an answer that did NOT exactly match the accepted answers. ' +
	'Decide whether it is nevertheless a correct answer to the task: same meaning, grammatical, natural, ' +
	'and using the target as the task requires. Accept legitimate variation (kana versus kanji spelling, ' +
	'politeness level, a synonym that fits, a different but valid word order). Reject an answer that is ' +
	'ungrammatical, changes the meaning, leaves out what the task asks for, or avoids the target. ' +
	'When rejecting, say in one sentence what is off WITHOUT writing out the full correct answer. ' +
	'When accepting, say in one sentence why it works.';

const USE_RULES =
	'USE items: the learner wrote a reply or sentence. It is correct when it does what the task asks, ' +
	'uses the target in its correct form and sense (judged against the card), and is grammatical and ' +
	'natural enough that a Japanese speaker would not object. The "example answers" are examples, not the ' +
	'only valid answers. For a "free" item (write your own sentence) any natural sentence that uses the ' +
	'target correctly is correct. Overlook small stylistic choices and typos that do not affect the ' +
	'target. When it is not correct, say what is wrong and give a corrected version in Japanese script.';

export function gradePrompt(card: Card, inputs: GradeInput[]): { system: string; user: string } {
	const modes = new Set(inputs.map((i) => i.mode));
	const system = [
		ROLE,
		...(modes.has('typed') ? [TYPED_RULES] : []),
		...(modes.has('use') ? [USE_RULES] : []),
		NO_ROMAJI_NOTE,
		UNTRUSTED_INPUT_NOTE
	].join('\n\n');

	const lines = inputs.map((input, i) => {
		const task = [
			input.instruction && `Task: ${input.instruction}`,
			input.sentence && `Sentence: ${input.sentence}`
		].filter(Boolean);
		if (input.mode === 'typed') {
			if (input.cue) task.push(`Cue: ${input.cue}`);
			task.push(`Accepted answers: ${input.accepted.join(' / ')}`);
		} else {
			task.push(input.free ? 'This is a free "write your own sentence" item.' : '');
			if (input.expected.length > 0) task.push(`Example answers: ${input.expected.join(' / ')}`);
		}
		task.push(`Learner's answer: ${input.learnerAnswer}`);
		return `Item ${i + 1} (${input.mode.toUpperCase()}):\n${task.filter(Boolean).join('\n')}`;
	});

	const user =
		`Target card:\n${tagUntrusted(JSON.stringify(card))}\n\n` +
		`Items to grade:\n${tagUntrusted(lines.join('\n\n'))}\n\n` +
		`Return ${inputs.length} result${inputs.length === 1 ? '' : 's'}.`;
	return { system, user };
}
