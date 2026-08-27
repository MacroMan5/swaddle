// Pure form model behind EventEditSheet's nursing section (#119): rows of
// side + duration + pause, anchored on the session start. Untouched rows must
// round-trip verbatim; an edited duration shifts later rows while keeping
// their pauses.
import { describe, expect, it } from 'vitest';
import type { NursingSegment } from '$lib/client/types';
import {
	addRow,
	buildSegments,
	removeRow,
	rowsFromSegments,
	setMinutes,
	setPause
} from './nursingSegmentsForm';

/** A realistic session: left 8 min 37 s, pause 4 min 12 s, right 6 min 3 s. */
function session(): NursingSegment[] {
	return [
		{
			side: 'left',
			startedAt: '2026-08-27T10:00:00.000Z',
			endedAt: '2026-08-27T10:08:37.000Z'
		},
		{
			side: 'right',
			startedAt: '2026-08-27T10:12:49.000Z',
			endedAt: '2026-08-27T10:18:52.000Z'
		}
	];
}

describe('rowsFromSegments', () => {
	it('renders rounded minutes and pauses but keeps the exact milliseconds', () => {
		const { anchorIso, rows } = rowsFromSegments(session());
		expect(anchorIso).toBe('2026-08-27T10:00:00.000Z');
		expect(rows[0]).toMatchObject({ side: 'left', minutes: '9', pause: '0', open: false });
		expect(rows[0].exactDurationMs).toBe(8 * 60_000 + 37_000);
		expect(rows[1]).toMatchObject({ side: 'right', minutes: '6', pause: '4', open: false });
		expect(rows[1].exactGapMs).toBe(4 * 60_000 + 12_000);
	});

	it('marks a running last segment open with no duration to edit', () => {
		const segments: NursingSegment[] = [
			{ side: 'left', startedAt: '2026-08-27T10:00:00.000Z', endedAt: null }
		];
		const { rows } = rowsFromSegments(segments);
		expect(rows[0].open).toBe(true);
		expect(rows[0].minutes).toBe('');
	});
});

describe('buildSegments', () => {
	it('round-trips an untouched session verbatim', () => {
		const original = session();
		const { anchorIso, rows } = rowsFromSegments(original);
		const built = buildSegments(anchorIso, rows);
		expect(built).toEqual({ ok: true, segments: original });
	});

	it('round-trips an open segment verbatim', () => {
		const original: NursingSegment[] = [
			{ side: 'right', startedAt: '2026-08-27T10:00:30.500Z', endedAt: null }
		];
		const { anchorIso, rows } = rowsFromSegments(original);
		expect(buildSegments(anchorIso, rows)).toEqual({ ok: true, segments: original });
	});

	it('shifts later segments by the delta when a duration is edited, keeping pauses', () => {
		const { anchorIso, rows } = rowsFromSegments(session());
		const edited = setMinutes(rows, 0, '10');
		const built = buildSegments(anchorIso, edited);
		if (!built.ok) throw new Error('expected ok');
		// Left becomes exactly 10 min…
		expect(built.segments[0].startedAt).toBe('2026-08-27T10:00:00.000Z');
		expect(built.segments[0].endedAt).toBe('2026-08-27T10:10:00.000Z');
		// …and the right segment keeps its exact 4 min 12 s pause and duration.
		expect(built.segments[1].startedAt).toBe('2026-08-27T10:14:12.000Z');
		expect(built.segments[1].endedAt).toBe('2026-08-27T10:20:15.000Z');
	});

	it('re-anchors the whole session when the anchor changes', () => {
		const { rows } = rowsFromSegments(session());
		const built = buildSegments('2026-08-27T09:00:00.000Z', rows);
		if (!built.ok) throw new Error('expected ok');
		expect(built.segments[0].startedAt).toBe('2026-08-27T09:00:00.000Z');
		expect(built.segments[1].startedAt).toBe('2026-08-27T09:12:49.000Z');
	});

	it('applies an edited pause without moving earlier rows', () => {
		const { anchorIso, rows } = rowsFromSegments(session());
		const edited = setPause(rows, 1, '1');
		const built = buildSegments(anchorIso, edited);
		if (!built.ok) throw new Error('expected ok');
		expect(built.segments[0].endedAt).toBe('2026-08-27T10:08:37.000Z');
		expect(built.segments[1].startedAt).toBe('2026-08-27T10:09:37.000Z');
	});

	it('accepts the French decimal comma in durations and pauses (Codex review P2)', () => {
		const { anchorIso, rows } = rowsFromSegments(session());
		const built = buildSegments(anchorIso, setPause(setMinutes(rows, 0, '7,5'), 1, '2,5'));
		if (!built.ok) throw new Error('expected ok');
		expect(built.segments[0].endedAt).toBe('2026-08-27T10:07:30.000Z');
		expect(built.segments[1].startedAt).toBe('2026-08-27T10:10:00.000Z');
	});

	it('rejects a missing, zero or garbled duration with a row error', () => {
		const { anchorIso, rows } = rowsFromSegments(session());
		for (const bad of ['', '0', 'abc', '-3', '1000000000']) {
			const built = buildSegments(anchorIso, setMinutes(rows, 1, bad));
			expect(built.ok).toBe(false);
			if (built.ok) throw new Error('expected errors');
			expect(built.errors[1]).toMatch(/durée/i);
			expect(built.errors[0]).toBeNull();
		}
	});

	it('rejects a negative or garbled pause but accepts an empty one as zero', () => {
		const { anchorIso, rows } = rowsFromSegments(session());
		const empty = buildSegments(anchorIso, setPause(rows, 1, ''));
		if (!empty.ok) throw new Error('expected ok');
		expect(empty.segments[1].startedAt).toBe('2026-08-27T10:08:37.000Z');
		for (const bad of ['abc', '-2']) {
			const built = buildSegments(anchorIso, setPause(rows, 1, bad));
			expect(built.ok).toBe(false);
		}
	});
});

describe('addRow', () => {
	it('splits a single-segment session: opposite side, starting at the previous end', () => {
		const original: NursingSegment[] = [
			{ side: 'left', startedAt: '2026-08-27T10:00:00.000Z', endedAt: '2026-08-27T10:08:00.000Z' }
		];
		const { anchorIso, rows } = rowsFromSegments(original);
		const added = setMinutes(addRow(rows), 1, '5');
		const built = buildSegments(anchorIso, added);
		if (!built.ok) throw new Error('expected ok');
		expect(built.segments).toEqual([
			original[0],
			{ side: 'right', startedAt: '2026-08-27T10:08:00.000Z', endedAt: '2026-08-27T10:13:00.000Z' }
		]);
	});
});

describe('removeRow', () => {
	it('keeps the remaining rows at their recorded times when a middle row goes', () => {
		const original: NursingSegment[] = [
			...session(),
			{ side: 'left', startedAt: '2026-08-27T10:20:00.000Z', endedAt: '2026-08-27T10:25:00.000Z' }
		];
		const { anchorIso, rows } = rowsFromSegments(original);
		const removed = removeRow(anchorIso, rows, 1);
		const built = buildSegments(removed.anchorIso, removed.rows);
		if (!built.ok) throw new Error('expected ok');
		expect(built.segments).toEqual([original[0], original[2]]);
	});

	it('does not throw when the removed first row holds an unparseable duration', () => {
		const original = session();
		const { anchorIso, rows } = rowsFromSegments(original);
		// The user clears the first duration, then decides to remove the row
		// instead (Codex review P2): the walk hits NaN, so re-anchoring must
		// fall back to the current anchor rather than crash. A pasted duration
		// beyond any valid Date is the same story.
		for (const bad of ['', '1000000000']) {
			expect(removeRow(anchorIso, setMinutes(rows, 0, bad), 0).anchorIso).toBe(anchorIso);
		}
		const removed = removeRow(anchorIso, setMinutes(rows, 0, ''), 0);
		const built = buildSegments(removed.anchorIso, removed.rows);
		if (!built.ok) throw new Error('expected ok');
		expect(built.segments[0]).toMatchObject({ side: 'right' });
		expect(built.segments[0].startedAt).toBe(anchorIso);
	});

	it('does not absorb an unknowable hole when a garbled middle row goes', () => {
		const original: NursingSegment[] = [
			...session(),
			{ side: 'left', startedAt: '2026-08-27T10:20:00.000Z', endedAt: '2026-08-27T10:25:00.000Z' }
		];
		const { anchorIso, rows } = rowsFromSegments(original);
		const removed = removeRow(anchorIso, setMinutes(rows, 1, 'abc'), 1);
		expect(removed.rows).toHaveLength(2);
		// The follower keeps its own pause (1 min 8 s before the removed row's
		// recorded start), instead of inheriting NaN.
		expect(removed.rows[1].exactGapMs).toBe(68_000);
	});

	it('re-anchors on the next row when the first row goes', () => {
		const original = session();
		const { anchorIso, rows } = rowsFromSegments(original);
		const removed = removeRow(anchorIso, rows, 0);
		expect(removed.anchorIso).toBe('2026-08-27T10:12:49.000Z');
		const built = buildSegments(removed.anchorIso, removed.rows);
		if (!built.ok) throw new Error('expected ok');
		expect(built.segments).toEqual([original[1]]);
	});
});
