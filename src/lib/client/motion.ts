// Svelte's transition: directive doesn't honor prefers-reduced-motion on its
// own — callers must shorten the duration themselves when the OS asks for it.
export function transitionDuration(ms: number): number {
	if (typeof window === 'undefined') return ms;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
}
