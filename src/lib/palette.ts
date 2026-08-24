// Fixed palette offered when picking a caregiver's color (onboarding wizard
// and settings). Not a design token itself (a caregiver's color is free-form
// user data), but kept in one place so both UIs stay in sync.
export const CAREGIVER_COLORS: string[] = [
	'#DB2777',
	'#0284C7',
	'#F59E0B',
	'#14B8A6',
	'#6366F1',
	'#DC2626',
	'#059669',
	'#7C3AED'
];

// French display names for the palette, used as accessible labels on the
// swatch buttons (a raw hex code means nothing to a screen reader).
export const CAREGIVER_COLOR_NAMES: Record<string, string> = {
	'#DB2777': 'Rose',
	'#0284C7': 'Bleu',
	'#F59E0B': 'Ambre',
	'#14B8A6': 'Turquoise',
	'#6366F1': 'Indigo',
	'#DC2626': 'Rouge',
	'#059669': 'Vert',
	'#7C3AED': 'Violet'
};

export function caregiverColorName(color: string): string {
	return CAREGIVER_COLOR_NAMES[color.toUpperCase()] ?? color;
}
