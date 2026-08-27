// Swaddle is served over plain HTTP on the LAN (http://swaddle.home), which is not a
// secure context in the browser's eyes — `navigator.clipboard` (the Async Clipboard API)
// simply does not exist there. The `document.execCommand('copy')` fallback below is
// deprecated but remains the only copy mechanism available in that setting.

/** Copies `text` to the clipboard, returning whether it succeeded. */
export async function copyText(text: string): Promise<boolean> {
	if (typeof navigator !== 'undefined' && navigator.clipboard) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Fall through to the execCommand fallback below.
		}
	}

	if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
		return false;
	}

	const textarea = document.createElement('textarea');
	textarea.value = text;
	textarea.setAttribute('readonly', '');
	textarea.style.position = 'fixed';
	textarea.style.left = '-9999px';
	document.body.appendChild(textarea);
	// iOS Safari ignores select() on its own: without an explicit setSelectionRange
	// there is no selection and execCommand('copy') copies nothing.
	textarea.focus();
	textarea.select();
	textarea.setSelectionRange(0, text.length);

	let succeeded = false;
	try {
		succeeded = document.execCommand('copy');
	} catch {
		succeeded = false;
	}

	textarea.remove();
	return succeeded;
}
