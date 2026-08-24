import { describe, expect, it } from 'vitest';
import type { Details, EventDTO, EventType } from '$lib/client/types';
import {
	activeCategories,
	elapsedSinceLabel,
	lastBottleVolumeMl,
	lastOfCategory
} from './todayDerivations';

const NOW = Date.parse('2026-08-24T12:00:00.000Z');

function ev(
	id: string,
	type: EventType,
	startedAt: string,
	overrides: Partial<EventDTO> = {}
): EventDTO {
	const details: Details =
		type === 'nursing'
			? { segments: [{ side: 'left', startedAt, endedAt: null }] }
			: type === 'bottle'
				? { milkType: 'breast', volumeMl: 90 }
				: type === 'pump'
					? { side: 'both', volumeMl: null }
					: type === 'diaper'
						? { pee: true, poo: false }
						: {};
	return {
		id,
		babyId: 'baby-1',
		caregiverId: null,
		type,
		startedAt,
		endedAt: null,
		note: null,
		details,
		createdAt: startedAt,
		updatedAt: startedAt,
		deletedAt: null,
		...overrides
	};
}

describe('lastOfCategory', () => {
	it('returns the first matching event in newest-first order', () => {
		const events = [
			ev('e1', 'diaper', '2026-08-24T11:00:00.000Z'),
			ev('e2', 'bottle', '2026-08-24T10:00:00.000Z'),
			ev('e3', 'nursing', '2026-08-24T08:00:00.000Z')
		];
		expect(lastOfCategory(events, 'feed')?.id).toBe('e2');
		expect(lastOfCategory(events, 'diaper')?.id).toBe('e1');
	});

	it('treats nursing, bottle and pump as one feed category', () => {
		const events = [ev('e1', 'pump', '2026-08-24T11:00:00.000Z')];
		expect(lastOfCategory(events, 'feed')?.id).toBe('e1');
	});

	it('ignores a still-running sleep: only finished sessions count', () => {
		const events = [
			ev('e1', 'sleep', '2026-08-24T11:00:00.000Z'),
			ev('e2', 'sleep', '2026-08-24T06:00:00.000Z', { endedAt: '2026-08-24T09:00:00.000Z' })
		];
		expect(lastOfCategory(events, 'sleep')?.id).toBe('e2');
	});

	it('returns null when the category has nothing', () => {
		expect(lastOfCategory([], 'feed')).toBeNull();
	});
});

describe('elapsedSinceLabel', () => {
	it('formats the elapsed time since the event started', () => {
		const event = ev('e1', 'diaper', '2026-08-24T10:55:00.000Z');
		expect(elapsedSinceLabel(event, NOW)).toBe('1 h 05');
	});

	it('returns an em dash when there is no event', () => {
		expect(elapsedSinceLabel(null, NOW)).toBe('—');
	});
});

describe('activeCategories', () => {
	it('maps running timers to their categories', () => {
		const timers = [
			ev('t1', 'nursing', '2026-08-24T11:00:00.000Z'),
			ev('t2', 'sleep', '2026-08-24T11:30:00.000Z')
		];
		expect(activeCategories(timers)).toEqual(new Set(['feed', 'sleep']));
	});

	it('is empty with no timers', () => {
		expect(activeCategories([])).toEqual(new Set());
	});
});

describe('lastBottleVolumeMl', () => {
	it('reads the most recent bottle volume', () => {
		const events = [
			ev('e1', 'diaper', '2026-08-24T11:00:00.000Z'),
			ev('e2', 'bottle', '2026-08-24T10:00:00.000Z')
		];
		expect(lastBottleVolumeMl(events)).toBe(90);
	});

	it('returns null when no bottle exists', () => {
		expect(lastBottleVolumeMl([ev('e1', 'diaper', '2026-08-24T11:00:00.000Z')])).toBeNull();
	});
});
