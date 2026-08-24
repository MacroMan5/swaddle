// Pure derivations for the Today screen. The formulas used to live inside
// FeedCard/DiaperCard/SleepCard; the status strip needs them at page level,
// so they moved here unchanged. No DOM, no store — testable with plain data.

import type { EventDTO, EventType } from '$lib/client/types';
import { isType } from '$lib/client/types';
import { formatElapsed } from '$lib/client/format';

export type Category = 'feed' | 'diaper' | 'sleep';

export const CATEGORY_OF: Record<EventType, Category> = {
	nursing: 'feed',
	bottle: 'feed',
	pump: 'feed',
	diaper: 'diaper',
	sleep: 'sleep'
};

/**
 * Latest event of a category, given events sorted newest-first (SyncStore
 * order). Sleep only counts finished sessions: the running one lives in the
 * timer banner, "since last sleep" reads from the last completed night.
 */
export function lastOfCategory(events: EventDTO[], category: Category): EventDTO | null {
	return (
		events.find(
			(e) => CATEGORY_OF[e.type] === category && (category !== 'sleep' || e.endedAt !== null)
		) ?? null
	);
}

/** Status-strip value: elapsed time since the event started, or an em dash. */
export function elapsedSinceLabel(event: EventDTO | null, nowMs: number): string {
	if (!event) return '—';
	return formatElapsed(nowMs - Date.parse(event.startedAt));
}

/** Categories that currently have a running timer. */
export function activeCategories(timers: EventDTO[]): Set<Category> {
	return new Set(timers.map((t) => CATEGORY_OF[t.type]));
}

/** Volume of the most recent bottle, for the quick-action tile hint. */
export function lastBottleVolumeMl(events: EventDTO[]): number | null {
	const bottle = events.find((e) => isType(e, 'bottle'));
	return bottle && isType(bottle, 'bottle') ? bottle.details.volumeMl : null;
}
