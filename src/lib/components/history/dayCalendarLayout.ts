// Geometry for the day calendar grid: where each event sits on a 24 h column,
// and how simultaneous events share the width. Pure and DOM-free so the tricky
// parts (overlap packing, midnight clipping, DST) are testable without a
// browser.
import { wallClockMinutesOf } from './timelinePosition';
import { localDayKey } from '$lib/client/summaries';
import { effectiveEndMs, isPointEvent, startsBeforeDay } from './eventDisplay';
import type { EventDTO } from '$lib/client/types';

/**
 * 20 px per hour, so the whole day is 480 px: one screen, no scrolling inside
 * the grid. That is the point of this view — reading the *shape* of a day (the
 * night, the gaps between feeds, the long nap) in a single glance.
 *
 * The trade is deliberate: at this density a 20-minute feed is 7 px tall and
 * cannot hold text. Detail belongs to the chronological list right below, which
 * is also the reading that never depends on colour. A scale generous enough to
 * label every block (96 px/h) makes the day 2300 px tall, which is a different,
 * worse product: you can read each event but never see the day.
 */
export const HOUR_HEIGHT_PX = 20;
export const PX_PER_MIN = HOUR_HEIGHT_PX / 60;
export const DAY_HEIGHT_PX = 24 * HOUR_HEIGHT_PX;

/** Thinnest visible bar. It floors only sessions under 15 minutes, and by a
 * couple of pixels — small enough that the day's shape stays truthful. */
export const MIN_BLOCK_PX = 5;
const MIN_BLOCK_MIN = MIN_BLOCK_PX / PX_PER_MIN;

export type Placed = {
	event: EventDTO;
	topPx: number;
	heightPx: number;
	/** 0-based slot within the cluster of events this one overlaps. */
	column: number;
	/** Slots in that cluster; width is `100% / columns`. */
	columns: number;
	/** Started before `dayKey`: the block is cut off at the top of the grid. */
	clippedTop: boolean;
	/** Ends after `dayKey`: cut off at the bottom. */
	clippedBottom: boolean;
	/** Timer still running — the end shown is `nowMs`, not a recorded end. */
	open: boolean;
};

export type PlacedPoint = { event: EventDTO; topPx: number };

type Span = { event: EventDTO; startMin: number; endMin: number; drawnEndMin: number };

function spanOf(event: EventDTO, dayKey: string, nowMs: number): Span {
	const startMin = wallClockMinutesOf(Date.parse(event.startedAt), dayKey);
	const endMin = wallClockMinutesOf(effectiveEndMs(event, nowMs), dayKey);
	return {
		event,
		startMin,
		endMin,
		// Packing works on what is *drawn*, not on the raw duration: a block
		// widened to MIN_BLOCK_PX would otherwise be allowed to sit on top of
		// the next one.
		drawnEndMin: Math.max(endMin, startMin + MIN_BLOCK_MIN)
	};
}

/**
 * Places every durational event (nursing, pump, sleep) of `dayKey`, resolving
 * overlaps into side-by-side columns the way a calendar does: a nursing session
 * inside a nap becomes two half-width blocks instead of one hiding the other.
 *
 * Point events are excluded — see `placePoints`.
 */
export function placeBlocks(events: EventDTO[], dayKey: string, nowMs: number): Placed[] {
	const spans = events
		.filter((e) => !isPointEvent(e))
		.map((e) => spanOf(e, dayKey, nowMs))
		// Earliest first; on a tie the longer one takes the leftmost column, so
		// the enclosing nap stays on the left and the feed nests to its right.
		.sort((a, b) => a.startMin - b.startMin || b.drawnEndMin - a.drawnEndMin);

	const placed: Placed[] = [];
	// A cluster is a maximal run of events connected by overlap. Every member
	// shares the same column count, so widths line up across the whole run.
	let cluster: Placed[] = [];
	let columnEnds: number[] = [];
	let clusterEndMin = -1;

	const flush = () => {
		for (const p of cluster) p.columns = columnEnds.length;
		placed.push(...cluster);
		cluster = [];
		columnEnds = [];
		clusterEndMin = -1;
	};

	for (const span of spans) {
		if (span.startMin >= clusterEndMin) flush();

		let column = columnEnds.findIndex((end) => end <= span.startMin);
		if (column === -1) column = columnEnds.push(span.startMin) - 1;
		columnEnds[column] = span.drawnEndMin;
		clusterEndMin = Math.max(clusterEndMin, span.drawnEndMin);

		cluster.push({
			event: span.event,
			topPx: span.startMin * PX_PER_MIN,
			heightPx: Math.max(MIN_BLOCK_PX, (span.endMin - span.startMin) * PX_PER_MIN),
			column,
			columns: 1, // overwritten by flush() once the cluster is closed
			// wallClockMinutesOf clips a carry-over to 0 and a spillover to 1440,
			// which is also where a session that genuinely ran midnight-to-midnight
			// lands — so the real instants decide, not the clipped position.
			clippedTop: startsBeforeDay(span.event, dayKey),
			clippedBottom: localDayKey(new Date(effectiveEndMs(span.event, nowMs))) !== dayKey,
			open: span.event.endedAt === null
		});
	}
	flush();

	return placed;
}

/**
 * Bottle and diaper have no duration, so they get a position and nothing else.
 * They stay out of `placeBlocks`' packing on purpose: letting one diaper change
 * during a three-hour nap force that nap to half width would be a large visual
 * cost for a 2 px marker. The grid renders them in their own narrow rail.
 */
export function placePoints(events: EventDTO[], dayKey: string, nowMs: number): PlacedPoint[] {
	void nowMs; // a point event never runs; kept for a uniform call signature
	return events
		.filter(isPointEvent)
		.map((event) => ({
			event,
			topPx: wallClockMinutesOf(Date.parse(event.startedAt), dayKey) * PX_PER_MIN
		}))
		.sort((a, b) => a.topPx - b.topPx);
}
