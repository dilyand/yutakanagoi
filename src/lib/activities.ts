export interface ActivityDescriptor {
	id: string;
	label: string;
	description?: string;
}

export const ACTIVITIES: ActivityDescriptor[] = [
	{
		id: 'vocab-drill',
		label: 'Vocabulary drill',
		description: 'Spaced-repetition Japanese vocab practice.'
	},
	{
		id: 'conjugation-drill',
		label: 'Conjugation drill',
		description: 'Practice verb, adjective, and copula conjugation patterns.'
	},
	{
		id: 'target-practice',
		label: 'Target practice drill',
		description: 'Name one grammar pattern or word and drill it in a short generated session.'
	},
	{
		id: 'shadowing-drill',
		label: 'Shadowing drill',
		description: 'Listen to real Japanese speech and repeat it back.'
	}
];

export function getActivity(id: string): ActivityDescriptor | undefined {
	return ACTIVITIES.find((activity) => activity.id === id);
}
