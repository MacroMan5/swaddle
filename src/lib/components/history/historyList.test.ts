import { describe, it, expect } from 'vitest';
import { removeById, upsertById } from './historyList';
import type { EventDTO } from '$lib/client/types';

function bottle(over: Partial<EventDTO> = {}): EventDTO {
	const at = '2026-08-24T09:00:00.000Z';
	return {
		id: 'e1',
		babyId: 'baby-1',
		caregiverId: null,
		type: 'bottle',
		startedAt: at,
		endedAt: null,
		note: null,
		details: { milkType: 'formula', volumeMl: 120 },
		createdAt: at,
		updatedAt: at,
		deletedAt: null,
		...over
	};
}

describe('upsertById (direct-merge path for confirmed create/edit/restore responses)', () => {
	it('inserts a new event not already in the list', () => {
		const result = upsertById([], bottle());
		expect(result.map((e) => e.id)).toEqual(['e1']);
	});

	it('replaces an existing event by id instead of duplicating it', () => {
		const original = bottle({ details: { milkType: 'formula', volumeMl: 120 } });
		const edited = bottle({ details: { milkType: 'formula', volumeMl: 150 } });
		const result = upsertById([original], edited);
		expect(result).toHaveLength(1);
		expect(result[0].details).toEqual({ milkType: 'formula', volumeMl: 150 });
	});

	it('leaves other events untouched', () => {
		const other = bottle({ id: 'e2' });
		const edited = bottle({ details: { milkType: 'formula', volumeMl: 150 } });
		const result = upsertById([other, bottle()], edited);
		expect(result.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
		expect(result.find((e) => e.id === 'e1')?.details).toEqual({ milkType: 'formula', volumeMl: 150 });
	});
});

describe('removeById (direct-merge path for a confirmed delete, ahead of any refetch)', () => {
	it('removes the matching event', () => {
		const result = removeById([bottle(), bottle({ id: 'e2' })], 'e1');
		expect(result.map((e) => e.id)).toEqual(['e2']);
	});

	it('is a no-op when the id is absent', () => {
		const list = [bottle()];
		expect(removeById(list, 'missing')).toEqual(list);
	});
});
