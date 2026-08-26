import { describe, it, expect, vi } from 'vitest';
import { publishBabyUpdated, publishReset, subscribe, publish, type Change } from './broadcast';
import type { BabyDTO, EventDTO } from './types';

const change: Change = { kind: 'created', event: { id: 'e1' } as EventDTO };

describe('broadcast', () => {
	it('delivers changes to subscribers until unsubscribed', () => {
		const seen: Change[] = [];
		const unsubscribe = subscribe((c) => seen.push(c));
		publish(change);
		unsubscribe();
		publish(change);
		expect(seen).toHaveLength(1);
	});

	it('a throwing listener does not break the others', () => {
		const bad = subscribe(() => {
			throw new Error('boom');
		});
		const ok = vi.fn();
		const okUnsub = subscribe(ok);
		expect(() => publish(change)).not.toThrow();
		expect(ok).toHaveBeenCalledOnce();
		bad();
		okUnsub();
	});

	it('publishReset delivers a {kind: "reset"} change with no event payload', () => {
		const seen: Change[] = [];
		const unsubscribe = subscribe((c) => seen.push(c));
		publishReset();
		unsubscribe();
		expect(seen).toEqual([{ kind: 'reset' }]);
	});

	it('#46: publishBabyUpdated delivers a {kind: "baby"} change carrying the updated baby', () => {
		const baby: BabyDTO = {
			id: 'baby-1',
			name: 'Corrigée',
			birthdate: '2026-07-28',
			timezone: 'America/Toronto'
		};
		const seen: Change[] = [];
		const unsubscribe = subscribe((c) => seen.push(c));
		publishBabyUpdated(baby);
		unsubscribe();
		expect(seen).toEqual([{ kind: 'baby', baby }]);
	});
});
