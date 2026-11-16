import { apiGet, apiPost } from './api-client';
import type { FlagRequest } from '$lib/target-practice/flags';
import type { GenerateResponse, GenerationStage } from '$lib/target-practice/generation';
import type { GradeInput, GradeResponse } from '$lib/target-practice/grade';
import type { CandidatesResponse, CardResponse, RecentTarget } from '$lib/target-practice/lookup';
import type { Card, TargetType } from '$lib/target-practice/types';

/**
 * Typed wrappers over the /api/target routes (design doc §11). A usage-cap or
 * kill-switch hit comes back as a normal `{ status: 'limit' }` response, not an
 * error, so callers branch on `status` instead of catching.
 */

export function lookupCandidates(type: TargetType, input: string): Promise<CandidatesResponse> {
	return apiPost('/api/target/lookup/candidates', { type, input });
}

export function lookupCard(body: {
	type: TargetType;
	target: string;
	reading?: string;
	gloss?: string;
}): Promise<CardResponse> {
	return apiPost('/api/target/lookup/card', body);
}

export async function fetchRecents(): Promise<RecentTarget[]> {
	const { recents } = await apiGet<{ recents: RecentTarget[] }>('/api/target/history');
	return recents;
}

export function deleteRecent(type: TargetType, targetKey: string): Promise<{ ok: true }> {
	return apiPost('/api/target/history/delete', { type, targetKey });
}

export function generate(body: {
	stage: GenerationStage;
	type: TargetType;
	card: Card;
	retry?: boolean;
	avoid?: string[];
}): Promise<GenerateResponse> {
	return apiPost('/api/target/generate', body);
}

export function grade(type: TargetType, card: Card, items: GradeInput[]): Promise<GradeResponse> {
	return apiPost('/api/target/grade', { type, card, items });
}

export function sendFlag(flag: FlagRequest): Promise<{ ok: true }> {
	return apiPost('/api/target/flag', flag);
}
