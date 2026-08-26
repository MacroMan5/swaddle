import { describe, expect, it } from 'vitest';
import { BufferedFetch } from './bufferedFetch';

describe('BufferedFetch', () => {
	it('buffers changes recorded while the run is in flight and exposes them for replay', () => {
		const fetch = new BufferedFetch<string>();
		const run = fetch.begin();
		fetch.record('a');
		fetch.record('b');
		expect(run.current).toBe(true);
		expect([...run.buffered]).toEqual(['a', 'b']);
		expect(run.end()).toBe(true);
	});

	it('ignores changes recorded while no run is in flight', () => {
		const fetch = new BufferedFetch<string>();
		fetch.record('before');
		const run = fetch.begin();
		run.end();
		fetch.record('after');
		const next = fetch.begin();
		expect([...next.buffered]).toEqual([]);
	});

	it('a newer begin() supersedes the run in flight', () => {
		const fetch = new BufferedFetch<string>();
		const stale = fetch.begin();
		fetch.record('for-stale');
		const fresh = fetch.begin();
		fetch.record('for-fresh');
		expect(stale.current).toBe(false);
		expect(fresh.current).toBe(true);
		expect([...fresh.buffered]).toEqual(['for-fresh']);
	});

	it('end() on a superseded run reports false and leaves the newer run untouched', () => {
		const fetch = new BufferedFetch<string>();
		const stale = fetch.begin();
		const fresh = fetch.begin();
		fetch.record('kept');
		expect(stale.end()).toBe(false);
		expect(fresh.current).toBe(true);
		expect([...fresh.buffered]).toEqual(['kept']);
		expect(fetch.inFlight).toBe(true);
	});

	it('invalidate() supersedes the run in flight and stops recording', () => {
		const fetch = new BufferedFetch<string>();
		const run = fetch.begin();
		fetch.invalidate();
		fetch.record('dropped');
		expect(run.current).toBe(false);
		expect(run.end()).toBe(false);
		expect(fetch.inFlight).toBe(false);
	});

	it('inFlight is false once the current run ended', () => {
		const fetch = new BufferedFetch<string>();
		const run = fetch.begin();
		expect(fetch.inFlight).toBe(true);
		run.end();
		expect(fetch.inFlight).toBe(false);
		fetch.record('dropped');
		expect([...fetch.begin().buffered]).toEqual([]);
	});
});
