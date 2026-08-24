// Shared helpers for EventEditSheet and ManualAddSheet: `datetime-local` input
// conversion, so both forms treat the field the same way (local wall time, no
// timezone maths leaking into either component).

/** `Date` → the value a `datetime-local` input expects, in local time. */
export function toLocalInputValue(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` input's value → ISO UTC, for the API. */
export function fromLocalInputValue(value: string): string {
	return new Date(value).toISOString();
}
