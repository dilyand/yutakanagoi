export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'yutakanagoi:theme';

function systemPrefersDark(): boolean {
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function getStoredTheme(): Theme | null {
	const stored = localStorage.getItem(THEME_STORAGE_KEY);
	return stored === 'light' || stored === 'dark' ? stored : null;
}

// Falls back to the OS preference until the user explicitly picks a theme.
export function getEffectiveTheme(): Theme {
	return getStoredTheme() ?? (systemPrefersDark() ? 'dark' : 'light');
}

export function setStoredTheme(theme: Theme): void {
	localStorage.setItem(THEME_STORAGE_KEY, theme);
	document.documentElement.dataset.theme = theme;
}

export function applyStoredTheme(): void {
	const stored = getStoredTheme();
	if (stored) {
		document.documentElement.dataset.theme = stored;
	}
}
