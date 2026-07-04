// localStorage key remembering which user was last selected, so returning
// users skip straight to list selection instead of re-picking every visit.
const USER_ID_STORAGE_KEY = 'yutakanagoi:user-id';

export function getStoredUserId(): number | null {
	const stored = localStorage.getItem(USER_ID_STORAGE_KEY);
	return stored ? Number(stored) : null;
}

export function setStoredUserId(userId: number): void {
	localStorage.setItem(USER_ID_STORAGE_KEY, String(userId));
}

export function clearStoredUserId(): void {
	localStorage.removeItem(USER_ID_STORAGE_KEY);
}
