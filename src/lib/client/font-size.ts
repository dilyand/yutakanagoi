// Discrete steps rather than free-form scaling — simple to reason about and
// to render as a fixed set of +/- clicks. 16px floor matches the existing
// iOS zoom-on-input-focus threshold (see app.css).
export const FONT_SIZES_PX = [16, 18, 20, 22, 24] as const;
export const DEFAULT_FONT_SIZE_PX = 18;

const FONT_SIZE_STORAGE_KEY = 'yutakanagoi:font-size-px';

export function getStoredFontSize(): number {
	const stored = Number(localStorage.getItem(FONT_SIZE_STORAGE_KEY));
	return FONT_SIZES_PX.includes(stored as (typeof FONT_SIZES_PX)[number])
		? stored
		: DEFAULT_FONT_SIZE_PX;
}

export function setStoredFontSize(px: number): void {
	localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(px));
	document.documentElement.style.setProperty('--app-font-size', `${px}px`);
}

export function applyStoredFontSize(): void {
	document.documentElement.style.setProperty('--app-font-size', `${getStoredFontSize()}px`);
}
