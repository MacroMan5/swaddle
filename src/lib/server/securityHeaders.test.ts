import { describe, it, expect } from 'vitest';
import { applySecurityHeaders } from './securityHeaders';

describe('applySecurityHeaders', () => {
	it('sets the sniffing, referrer and framing headers', () => {
		const res = applySecurityHeaders(new Response('{}'));
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('referrer-policy')).toBe('same-origin');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
		expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
	});

	it('makes a response without a cache policy non-cacheable', () => {
		expect(applySecurityHeaders(new Response('{}')).headers.get('cache-control')).toBe('no-store');
	});

	it('leaves an existing cache policy alone (the SSE stream picks its own)', () => {
		const stream = new Response('', { headers: { 'cache-control': 'no-cache' } });
		expect(applySecurityHeaders(stream).headers.get('cache-control')).toBe('no-cache');
	});
});
