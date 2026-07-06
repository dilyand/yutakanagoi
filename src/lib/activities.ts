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
	}
];

export function getActivity(id: string): ActivityDescriptor | undefined {
	return ACTIVITIES.find((activity) => activity.id === id);
}
