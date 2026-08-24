// Baby age for the Today title strip. Pure: takes the clock, never reads it.

const MS_PER_DAY = 86_400_000;

/**
 * Short French age label from a `YYYY-MM-DD` birthdate:
 * under 14 days → "9 j", under 3 months → "7 sem", under 24 months →
 * "5 mois", then "2 ans" / "2 ans 3 mois". Clamped at zero for a
 * birthdate in the future.
 */
export function formatBabyAge(birthdate: string, nowMs: number): string {
	const [year, month, day] = birthdate.slice(0, 10).split('-').map(Number);
	const born = new Date(year, month - 1, day);
	const now = new Date(nowMs);
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const days = Math.max(0, Math.round((today.getTime() - born.getTime()) / MS_PER_DAY));
	if (days < 14) return `${days} j`;

	let months = (now.getFullYear() - born.getFullYear()) * 12 + (now.getMonth() - born.getMonth());
	if (now.getDate() < born.getDate()) months -= 1;
	months = Math.max(0, months);
	if (months < 3) return `${Math.floor(days / 7)} sem`;
	if (months < 24) return `${months} mois`;

	const years = Math.floor(months / 12);
	const rest = months % 12;
	return rest === 0 ? `${years} ans` : `${years} ans ${rest} mois`;
}
