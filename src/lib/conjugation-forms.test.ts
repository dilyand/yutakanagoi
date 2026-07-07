import { describe, expect, it } from 'vitest';
import { cellId, COPULA_FORMS, I_ADJECTIVE_FORMS, VERB_FORMS } from './conjugation-forms';

describe('conjugation forms registry', () => {
	it('has the expected form counts', () => {
		expect(VERB_FORMS).toHaveLength(25);
		expect(I_ADJECTIVE_FORMS).toHaveLength(10);
		expect(COPULA_FORMS).toHaveLength(9);
	});

	it('has no duplicate form ids within each registry', () => {
		for (const forms of [VERB_FORMS, I_ADJECTIVE_FORMS, COPULA_FORMS]) {
			const ids = forms.map((f) => f.id);
			expect(new Set(ids).size).toBe(ids.length);
		}
	});

	it('builds a stable, splittable cell id', () => {
		expect(cellId('godan_mu', 'causative_passive_past')).toBe('godan_mu:causative_passive_past');
	});
});
