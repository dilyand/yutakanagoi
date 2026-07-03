// localStorage key for the shared-secret passphrase gate.
export const APP_SECRET_STORAGE_KEY = 'yutakanagoi:app-secret';

export function getStoredAppSecret(): string | null {
	return localStorage.getItem(APP_SECRET_STORAGE_KEY);
}

export function setStoredAppSecret(secret: string): void {
	localStorage.setItem(APP_SECRET_STORAGE_KEY, secret);
}

export function clearStoredAppSecret(): void {
	localStorage.removeItem(APP_SECRET_STORAGE_KEY);
}
