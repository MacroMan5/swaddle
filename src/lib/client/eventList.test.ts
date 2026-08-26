import { describe, expect, it } from 'vitest';
import { isDeletion, sortByDeletedAtDesc } from './eventList';
import type { EventDTO } from './types';

const AT = '2026-08-24T14:00:00.000Z';

function makeEvent(over: Partial<EventDTO> = {}): EventDTO {
	return {
		id: 'ev-1',
		babyId: 'baby-1',
		caregiverId: 'cg-1',
		type: 'diaper',
		startedAt: AT,
		endedAt: null,
		note: null,
		details: { pee: true, poo: false },
		createdAt: AT,
		updatedAt: AT,
		deletedAt: null,
		...over
	};
}

describe('isDeletion', () => {
	it('a deleted change kind means deletion even if the event carries no tombstone', () => {
		expect(isDeletion({ kind: 'deleted', event: makeEvent() })).toBe(true);
	});

	it('a deletedAt tombstone means deletion whatever the change kind says', () => {
		expect(isDeletion({ kind: 'updated', event: makeEvent({ deletedAt: AT }) })).toBe(true);
	});

	it('a live event under a non-deleted kind is not a deletion', () => {
		expect(isDeletion({ kind: 'restored', event: makeEvent() })).toBe(false);
		expect(isDeletion({ kind: 'created', event: makeEvent() })).toBe(false);
	});
});

describe('sortByDeletedAtDesc', () => {
	it('orders most recently deleted first, falling back to updatedAt when deletedAt is null', () => {
		const older = makeEvent({ id: 'older', deletedAt: '2026-08-24T10:00:00.000Z' });
		const newer = makeEvent({ id: 'newer', deletedAt: '2026-08-24T12:00:00.000Z' });
		const noTombstone = makeEvent({ id: 'fallback', updatedAt: '2026-08-24T11:00:00.000Z' });
		expect(sortByDeletedAtDesc([older, noTombstone, newer]).map((e) => e.id)).toEqual([
			'newer',
			'fallback',
			'older'
		]);
	});

	it('does not mutate its input', () => {
		const input = [
			makeEvent({ id: 'a', deletedAt: '2026-08-24T10:00:00.000Z' }),
			makeEvent({ id: 'b', deletedAt: '2026-08-24T12:00:00.000Z' })
		];
		sortByDeletedAtDesc(input);
		expect(input.map((e) => e.id)).toEqual(['a', 'b']);
	});
});
