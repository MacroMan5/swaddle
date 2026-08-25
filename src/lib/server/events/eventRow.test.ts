import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { EventDTO } from '$lib/shared/events';
import { migrate } from '$lib/server/db/migrations';
import { dtoToRow, EVENT_COLUMNS, rowToDto } from './eventRow';

function dto(overrides: Partial<EventDTO>): EventDTO {
	return {
		id: 'e1',
		babyId: 'b1',
		caregiverId: 'c1',
		type: 'sleep',
		startedAt: '2026-08-23T01:00:00.000Z',
		endedAt: null,
		note: null,
		details: {},
		createdAt: '2026-08-23T01:00:00.000Z',
		updatedAt: '2026-08-23T01:00:00.000Z',
		deletedAt: null,
		...overrides
	} as EventDTO;
}

const samples: EventDTO[] = [
	dto({
		type: 'nursing',
		endedAt: '2026-08-23T01:20:00.000Z',
		note: 'a, "b"\nc',
		details: {
			segments: [
				{ side: 'left', startedAt: '2026-08-23T01:00:00.000Z', endedAt: '2026-08-23T01:10:00.000Z' },
				{ side: 'right', startedAt: '2026-08-23T01:10:00.000Z', endedAt: null }
			]
		}
	}),
	dto({ type: 'bottle', caregiverId: null, details: { milkType: 'mixed', volumeMl: 90 } }),
	dto({ type: 'pump', details: { side: 'both', volumeMl: null } }),
	dto({ type: 'diaper', details: { pee: true, poo: false } }),
	dto({ type: 'sleep', deletedAt: '2026-08-23T02:00:00.000Z', details: {} })
];

describe('eventRow', () => {
	it('round-trips every event type through the row mapping', () => {
		for (const event of samples) expect(rowToDto(dtoToRow(event))).toEqual(event);
	});

	it('lists exactly the columns of the migrated event table, in order', () => {
		const db = new Database(':memory:');
		migrate(db);
		const columns = (db.prepare('PRAGMA table_info(event)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect([...EVENT_COLUMNS]).toEqual(columns);
	});
});
