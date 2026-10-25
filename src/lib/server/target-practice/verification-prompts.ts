import { NO_ROMAJI_NOTE, UNTRUSTED_INPUT_NOTE, tagUntrusted } from '$lib/server/claude-shared';
import type { GradeInput, GradeVerdict } from '$lib/target-practice/grade';
import type { Card, McItem } from '$lib/target-practice/types';
import { renderGradeItem } from './grade-prompts';

/**
 * Prompts for the two verification passes (see target-practice/verification.ts).
 * Both are written to make the checker DOUBT: the generator and the first grader
 * are the same kind of model, and their mistakes are the ones that get through.
 * Everything that came from the client or from another model call goes in
 * <untrusted> tags.
 */

// --- Contrast verification (generation time) ---------------------------------

const VERIFY_ROLE =
	'You check practice items for a Japanese learner. Each item is a "spot the error" question: ' +
	'four Japanese sentences, one MARKED as the faulty one (it should misuse the target pattern) and ' +
	'three claimed to be sound. A learner trusts these items completely and cannot tell a real error ' +
	'from something merely unusual, so a wrong item teaches something false.';

const VERIFY_RULES =
	'For each item set ok to true ONLY if BOTH hold: (a) a native speaker would clearly call the ' +
	'marked sentence wrong — ungrammatical, or a plain misuse of the target pattern, not merely ' +
	'unusual, awkward, odd in meaning, or acceptable in some context; and (b) every other sentence ' +
	'is natural, correct Japanese that a native speaker would accept without hesitation. When you ' +
	'have any real doubt about either, set ok to false and say in one short sentence what is ' +
	'doubtful. Do not rewrite the items. Return one result per item, with the id exactly as given.';

export function verifyContrastPrompt(
	card: Card,
	items: McItem[]
): { system: string; user: string } {
	const rendered = items.map((item) => {
		const options = item.options
			.map((o) => `- ${o.correct ? '[MARKED AS THE ERROR] ' : '[claimed sound] '}${o.text}`)
			.join('\n');
		return `Item id: ${item.id}\nQuestion: ${item.instruction ?? ''}\n${options}`;
	});
	return {
		system: [VERIFY_ROLE, VERIFY_RULES, NO_ROMAJI_NOTE, UNTRUSTED_INPUT_NOTE].join('\n\n'),
		user:
			`Target pattern card:\n${tagUntrusted(JSON.stringify({ target: card.target, rule: card.rule }))}\n\n` +
			`Items to check:\n${tagUntrusted(rendered.join('\n\n'))}\n\n` +
			`Return ${items.length} result${items.length === 1 ? '' : 's'}.`
	};
}

// --- Second look at a rejection ----------------------------------------------

const REVIEW_ROLE =
	"A first grader REJECTED a Japanese learner's answer. A false rejection is the worst thing a " +
	'practice tool can do — it tells a learner that correct Japanese is wrong — so you are the second ' +
	"look. For each item, decide INDEPENDENTLY whether a native speaker would accept the learner's " +
	"answer for the task. The first grader's reason may be wrong or based on a misreading of the " +
	'pattern; check it against the actual Japanese and the task, not against what the first grader or ' +
	"the item writer's examples say.";

const REVIEW_RULES =
	'Set acceptable to TRUE when the answer does what the task asks, is grammatical and natural enough ' +
	'for a native to accept, and uses the target correctly — even if it differs from the examples, adds ' +
	"a natural adverb or word the task's English calls for, or is not the form you would choose. Set it " +
	'to FALSE only when you can name a specific error you have verified (wrong grammar, wrong meaning, ' +
	'the target missing or misused). Style or politeness preferences alone never make it unacceptable. ' +
	'Write feedback for the learner in ENGLISH (Japanese only in script, to quote): if acceptable, one ' +
	'sentence on why it works; if not, state the real error and give the corrected Japanese. Comment ' +
	'only on words the learner actually wrote, and never call a word redundant or odd.';

export function reviewPrompt(
	card: Card,
	rejected: { input: GradeInput; first: GradeVerdict }[]
): { system: string; user: string } {
	const rendered = rejected.map(
		({ input, first }, i) =>
			`${renderGradeItem(input, i)}\nFirst grader: REJECTED. Its reason: ${first.feedback}`
	);
	return {
		system: [REVIEW_ROLE, REVIEW_RULES, NO_ROMAJI_NOTE, UNTRUSTED_INPUT_NOTE].join('\n\n'),
		user:
			`Target card:\n${tagUntrusted(JSON.stringify(card))}\n\n` +
			`Rejected answers to review:\n${tagUntrusted(rendered.join('\n\n'))}\n\n` +
			`Return ${rejected.length} result${rejected.length === 1 ? '' : 's'}, in order.`
	};
}
