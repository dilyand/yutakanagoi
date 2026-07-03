// localStorage key for the shared-secret passphrase gate. The UI that writes
// to this key (localStorage.setItem(APP_SECRET_STORAGE_KEY, passphrase)) is
// added in a later issue — this file just defines the contract so the drill
// UI's fetch calls already read from the right place.
export const APP_SECRET_STORAGE_KEY = 'yutakanagoi:app-secret';

export function getStoredAppSecret(): string | null {
	return localStorage.getItem(APP_SECRET_STORAGE_KEY);
}
