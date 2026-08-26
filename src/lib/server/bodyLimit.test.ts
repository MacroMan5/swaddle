import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { MAX_BODY_BYTES } from '$lib/limits';
import {
	handleRepoError,
	isPayloadTooLarge,
	payloadTooLarge,
	PayloadTooLargeError,
	readJson
} from './api';

function read(path: string): string {
	return readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

describe('the 10 MiB body bound', () => {
	// server.js, the Dockerfile and the compose file cannot import
	// $lib/limits.ts — they run against the build output or aren't JavaScript
	// at all — so their copy of the number is checked here instead.
	const asAdapterValue = `${MAX_BODY_BYTES / 1024 / 1024}M`;

	it('is the value the production entrypoint defaults BODY_SIZE_LIMIT to', () => {
		expect(read('server.js')).toContain(`process.env.BODY_SIZE_LIMIT ??= '${asAdapterValue}'`);
	});

	it('is declared by the Docker image and the compose deployment', () => {
		expect(read('Dockerfile')).toContain(`BODY_SIZE_LIMIT=${asAdapterValue}`);
		expect(read('deploy/docker-compose.yml')).toContain(
			`BODY_SIZE_LIMIT=\${SWADDLE_BODY_SIZE_LIMIT:-${asAdapterValue}}`
		);
	});
});

describe('payloadTooLarge', () => {
	it('answers 413 with its own code', async () => {
		const res = payloadTooLarge();
		expect(res.status).toBe(413);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe('payload_too_large');
	});
});

describe('readJson', () => {
	it('reports malformed JSON as a validation issue', async () => {
		const result = await readJson(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{not json'
			})
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.issues[0].code).toBe('invalid_json');
	});

	it('rethrows the adapter 413 instead of calling an oversized body malformed', async () => {
		// What adapter-node does to the body stream past BODY_SIZE_LIMIT.
		const tooLarge = Object.assign(new Error('Payload Too Large'), { status: 413 });
		const request = {
			text: () => Promise.reject(tooLarge)
		} as unknown as Request;
		await expect(readJson(request)).rejects.toBe(tooLarge);
		expect(isPayloadTooLarge(tooLarge)).toBe(true);
	});

	// A chunked request announces no content-length, so nothing before the read
	// can size it: with no adapter limit in the way (vite dev, or an operator
	// who raised BODY_SIZE_LIMIT) the body has to be measured once read.
	it('throws for an oversized body that declared no content-length', async () => {
		const oversized = `{"pad":"${'x'.repeat(MAX_BODY_BYTES)}"}`;
		const request = { text: () => Promise.resolve(oversized) } as unknown as Request;
		await expect(readJson(request)).rejects.toBeInstanceOf(PayloadTooLargeError);
	});

	it('accepts a body just under the bound', async () => {
		const pad = MAX_BODY_BYTES - 32;
		const request = {
			text: () => Promise.resolve(`{"pad":"${'x'.repeat(pad)}"}`)
		} as unknown as Request;
		const result = await readJson(request);
		expect(result.ok).toBe(true);
	});
});

describe('handleRepoError', () => {
	// The pin route reads its body inside `run` (after the throttle), so its
	// oversized body reaches the skeleton's last catch, not its size handling.
	it('maps an oversized body to the 413 envelope rather than a 500', async () => {
		const res = handleRepoError(new PayloadTooLargeError());
		expect(res.status).toBe(413);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe('payload_too_large');
	});

	it('maps the adapter 413 the same way', async () => {
		const res = handleRepoError(Object.assign(new Error('Payload Too Large'), { status: 413 }));
		expect(res.status).toBe(413);
	});
});
