// Form model behind EventEditSheet's nursing section (#119). The session is
// edited as an anchor (its start) plus rows of side + duration + pause — not
// raw segment timestamps — so changing "time on the left" is one field, and a
// single-segment session can be split by adding a row. Rules that keep the
// data honest:
//   - untouched rows keep their stored millisecond precision (the rendered
//     minutes are rounded, but building reuses the exact values, and an
//     unshifted row re-emits its original ISO strings verbatim);
//   - editing a duration shifts the rows after it by the delta, preserving
//     their pauses;
//   - only the last row may be open (running timer); it has no duration.
import type { NursingSegment, Side } from '$lib/client/types';

export type SegmentRow = {
	side: Side;
	/** Minutes input as rendered/typed; '' for an open row. */
	minutes: string;
	/** Pause before this row in minutes; '' counts as zero. */
	pause: string;
	/** Stored duration (ms) while `minutes` is untouched; null once edited or when open. */
	exactDurationMs: number | null;
	/** Stored gap (ms) while `pause` is untouched; null once edited. */
	exactGapMs: number | null;
	/** The stored segment this row came from; null for rows added in the form. */
	original: NursingSegment | null;
	open: boolean;
	error: string | null;
};

export type BuildResult =
	| { ok: true; segments: NursingSegment[] }
	| { ok: false; errors: (string | null)[] };

const MINUTE_MS = 60_000;

function roundedMinutes(ms: number): string {
	return String(Math.round(ms / MINUTE_MS));
}

/** Stored segments → editable rows plus the session anchor (first start). */
export function rowsFromSegments(segments: NursingSegment[]): {
	anchorIso: string;
	rows: SegmentRow[];
} {
	const rows = segments.map((s, i): SegmentRow => {
		const gapMs = i === 0 ? 0 : Date.parse(s.startedAt) - Date.parse(segments[i - 1].endedAt ?? s.startedAt);
		const durationMs = s.endedAt === null ? null : Date.parse(s.endedAt) - Date.parse(s.startedAt);
		return {
			side: s.side,
			minutes: durationMs === null ? '' : roundedMinutes(durationMs),
			pause: roundedMinutes(gapMs),
			exactDurationMs: durationMs,
			exactGapMs: gapMs,
			original: s,
			open: s.endedAt === null,
			error: null
		};
	});
	return { anchorIso: segments[0]?.startedAt ?? new Date().toISOString(), rows };
}

/** Type what the duration field now reads; the stored precision is forfeited. */
export function setMinutes(rows: SegmentRow[], index: number, minutes: string): SegmentRow[] {
	return rows.map((r, i) => (i === index ? { ...r, minutes, exactDurationMs: null } : r));
}

/** Type what the pause field now reads; the stored precision is forfeited. */
export function setPause(rows: SegmentRow[], index: number, pause: string): SegmentRow[] {
	return rows.map((r, i) => (i === index ? { ...r, pause, exactGapMs: null } : r));
}

/** '' is invalid for a duration: a closed segment must last something. */
function durationMsOf(row: SegmentRow): number | null {
	if (row.exactDurationMs !== null)
		return Number.isFinite(row.exactDurationMs) ? row.exactDurationMs : null;
	const minutes = Number(row.minutes);
	if (row.minutes.trim() === '' || !Number.isFinite(minutes) || minutes <= 0) return null;
	return Math.round(minutes * MINUTE_MS);
}

/** '' is a zero pause; negatives and garble are invalid. */
function gapMsOf(row: SegmentRow): number | null {
	if (row.exactGapMs !== null) return Number.isFinite(row.exactGapMs) ? row.exactGapMs : null;
	if (row.pause.trim() === '') return 0;
	const minutes = Number(row.pause);
	if (!Number.isFinite(minutes) || minutes < 0) return null;
	return Math.round(minutes * MINUTE_MS);
}

/**
 * Walk the rows from the anchor and rebuild the segments. Per-row messages
 * come back instead when a duration or pause does not parse.
 */
export function buildSegments(anchorIso: string, rows: SegmentRow[]): BuildResult {
	const errors: (string | null)[] = rows.map(() => null);
	let failed = false;
	const segments: NursingSegment[] = [];
	let cursorMs = Date.parse(anchorIso);
	for (const [i, row] of rows.entries()) {
		const gapMs = gapMsOf(row);
		if (gapMs === null) {
			errors[i] = 'Pause invalide.';
			failed = true;
			continue;
		}
		const startMs = cursorMs + gapMs;
		const startMatches = row.original !== null && Date.parse(row.original.startedAt) === startMs;
		const startedAt = startMatches
			? (row.original as NursingSegment).startedAt
			: new Date(startMs).toISOString();
		if (row.open) {
			segments.push({ side: row.side, startedAt, endedAt: null });
			continue;
		}
		const durationMs = durationMsOf(row);
		if (durationMs === null) {
			errors[i] = 'Indiquez une durée en minutes.';
			failed = true;
			continue;
		}
		const endedAt =
			startMatches && row.exactDurationMs !== null
				? ((row.original as NursingSegment).endedAt as string)
				: new Date(startMs + durationMs).toISOString();
		segments.push({ side: row.side, startedAt, endedAt });
		cursorMs = startMs + durationMs;
	}
	return failed ? { ok: false, errors } : { ok: true, segments };
}

/** Append a row to split the session: opposite side, right after the last end. */
export function addRow(rows: SegmentRow[]): SegmentRow[] {
	const last = rows[rows.length - 1];
	return [
		...rows,
		{
			side: last?.side === 'left' ? 'right' : 'left',
			minutes: '',
			pause: '0',
			exactDurationMs: null,
			exactGapMs: 0,
			original: null,
			open: false,
			error: null
		}
	];
}

/**
 * Remove one row while keeping every other row at its recorded wall-clock
 * position: the follower absorbs the hole as pause, and removing the first
 * row re-anchors the session on the next one.
 */
export function removeRow(
	anchorIso: string,
	rows: SegmentRow[],
	index: number
): { anchorIso: string; rows: SegmentRow[] } {
	// Absolute positions under the current (possibly edited) values. A row
	// holding an unparseable duration or pause walks as NaN; every use below
	// checks finiteness and falls back to not moving anything, so removal
	// always succeeds and the remaining rows' own errors surface at build time.
	const starts: number[] = [];
	const ends: number[] = [];
	let cursorMs = Date.parse(anchorIso);
	for (const row of rows) {
		const startMs = cursorMs + (gapMsOf(row) ?? NaN);
		starts.push(startMs);
		const endMs = row.open ? startMs : startMs + (durationMsOf(row) ?? NaN);
		ends.push(endMs);
		cursorMs = endMs;
	}

	const kept = rows.filter((_, i) => i !== index);
	if (kept.length === 0) return { anchorIso, rows: kept };

	const isoAt = (ms: number, row: SegmentRow): string =>
		row.original !== null && Date.parse(row.original.startedAt) === ms
			? row.original.startedAt
			: new Date(ms).toISOString();

	if (index === 0) {
		const next = rows[1];
		return {
			// If the removed row's values did not parse, its end is unknowable:
			// keep the current anchor rather than crash re-anchoring on NaN.
			anchorIso: Number.isFinite(starts[1]) ? isoAt(starts[1], next) : anchorIso,
			rows: kept.map((r, i) => (i === 0 ? { ...r, pause: '0', exactGapMs: 0 } : r))
		};
	}
	const follower = index + 1 < rows.length ? rows[index + 1] : null;
	if (follower === null) return { anchorIso, rows: kept };
	const gapMs = starts[index + 1] - ends[index - 1];
	// Same fallback: an unknowable hole is not absorbed — the follower keeps
	// its own pause, and whatever is still invalid errors at build time.
	if (!Number.isFinite(gapMs)) return { anchorIso, rows: kept };
	return {
		anchorIso,
		rows: kept.map((r, i) =>
			i === index ? { ...r, pause: roundedMinutes(gapMs), exactGapMs: gapMs } : r
		)
	};
}
