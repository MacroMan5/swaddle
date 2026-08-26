import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { MAX_BODY_BYTES } from '$lib/limits';
import { isPayloadTooLarge, payloadTooLarge, readJson } from './api';

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
			json: () => Promise.reject(tooLarge)
		} as unknown as Request;
		await expect(readJson(request)).rejects.toBe(tooLarge);
		expect(isPayloadTooLarge(tooLarge)).toBe(true);
	});
});
