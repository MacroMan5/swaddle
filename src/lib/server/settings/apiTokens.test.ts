import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '$lib/server/db/migrations';
import { createApiToken, listApiTokens, revokeApiToken, verifyBearer } from './apiTokens';

let db: Database.Database;

beforeEach(() => {
	db = new Database(':memory:');
	migrate(db);
	db.prepare('INSERT INTO caregiver (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
		'cg-1',
		'Papa',
		'#0284C7',
		'2026-08-26T00:00:00.000Z'
	);
});

describe('createApiToken', () => {
	it('returns a swd_-prefixed plaintext carrying 32 random bytes in base64url', () => {
		const { plaintext, token } = createApiToken(db, { name: 'iPhone Émile' });

		expect(plaintext.startsWith('swd_')).toBe(true);
		const secret = plaintext.slice('swd_'.length);
		expect(secret).toMatch(/^[A-Za-z0-9_-]+$/); // base64url: no '+', '/', '='
		expect(Buffer.from(secret, 'base64url')).toHaveLength(32);

		expect(token).toMatchObject({ name: 'iPhone Émile', caregiverId: null, revokedAt: null });
		expect(token.lastUsedAt).toBeNull();
		expect(Date.parse(token.createdAt)).not.toBeNaN();
	});

	it('never repeats a plaintext', () => {
		const plaintexts = new Set(
			Array.from({ length: 20 }, (_, i) => createApiToken(db, { name: `t${i}` }).plaintext)
		);
		expect(plaintexts.size).toBe(20);
	});

	it('stores the SHA-256 of the plaintext, never the plaintext itself', () => {
		const { plaintext, token } = createApiToken(db, { name: 'iPad' });
		const row = db.prepare('SELECT token_hash FROM api_token WHERE id = ?').get(token.id) as {
			token_hash: string;
		};
		expect(row.token_hash).toBe(createHash('sha256').update(plaintext).digest('hex'));
		const dump = JSON.stringify(db.prepare('SELECT * FROM api_token').all());
		expect(dump).not.toContain(plaintext);
	});

	it('links an optional caregiver', () => {
		const { token } = createApiToken(db, { name: 'Tablette', caregiverId: 'cg-1' });
		expect(token.caregiverId).toBe('cg-1');
	});
});

describe('listApiTokens', () => {
	it('never exposes the plaintext nor the hash', () => {
		const { plaintext } = createApiToken(db, { name: 'iPhone' });
		const listed = listApiTokens(db);
		expect(listed).toHaveLength(1);
		expect(Object.keys(listed[0]).sort()).toEqual([
			'caregiverId',
			'createdAt',
			'id',
			'lastUsedAt',
			'name',
			'revokedAt'
		]);
		expect(JSON.stringify(listed)).not.toContain(plaintext);
	});

	it('keeps revoked tokens visible, in creation order', () => {
		const first = createApiToken(db, { name: 'a' }).token;
		const second = createApiToken(db, { name: 'b' }).token;
		revokeApiToken(db, first.id);
		const listed = listApiTokens(db);
		expect(listed.map((t) => t.name)).toEqual(['a', 'b']);
		expect(listed[0].revokedAt).not.toBeNull();
		expect(listed[1].id).toBe(second.id);
	});
});

describe('verifyBearer', () => {
	it('accepts a valid header and reports the token and its caregiver', () => {
		const { plaintext, token } = createApiToken(db, { name: 'iPhone', caregiverId: 'cg-1' });
		expect(verifyBearer(db, `Bearer ${plaintext}`)).toEqual({
			tokenId: token.id,
			caregiverId: 'cg-1'
		});
	});

	it('accepts the scheme case-insensitively (RFC 7235)', () => {
		const { plaintext, token } = createApiToken(db, { name: 'iPhone' });
		expect(verifyBearer(db, `bearer ${plaintext}`)?.tokenId).toBe(token.id);
	});

	it('rejects a missing, malformed or wrong-scheme header', () => {
		const { plaintext } = createApiToken(db, { name: 'iPhone' });
		for (const header of [
			null,
			'',
			'Bearer',
			'Bearer ',
			plaintext, // no scheme
			`Basic ${plaintext}`,
			`Bearer ${plaintext} extra`
		]) {
			expect(verifyBearer(db, header)).toBeNull();
		}
	});

	it('rejects an unknown plaintext', () => {
		createApiToken(db, { name: 'iPhone' });
		expect(verifyBearer(db, 'Bearer swd_notatoken')).toBeNull();
	});

	it('rejects a revoked token', () => {
		const { plaintext, token } = createApiToken(db, { name: 'iPhone' });
		expect(verifyBearer(db, `Bearer ${plaintext}`)).not.toBeNull();
		revokeApiToken(db, token.id);
		expect(verifyBearer(db, `Bearer ${plaintext}`)).toBeNull();
	});

	it('records last_used_at rounded to the day, writing at most once per day', () => {
		const { plaintext, token } = createApiToken(db, { name: 'iPhone' });

		verifyBearer(db, `Bearer ${plaintext}`, new Date('2026-08-26T14:32:09.123Z'));
		const afterFirst = listApiTokens(db)[0].lastUsedAt;
		expect(afterFirst).toBe('2026-08-26T00:00:00.000Z');

		// A second call the same day must not rewrite the row.
		const before = db.prepare('SELECT last_used_at FROM api_token WHERE id = ?').get(token.id);
		verifyBearer(db, `Bearer ${plaintext}`, new Date('2026-08-26T23:59:59.999Z'));
		expect(db.prepare('SELECT last_used_at FROM api_token WHERE id = ?').get(token.id)).toEqual(
			before
		);

		// The next day advances it.
		verifyBearer(db, `Bearer ${plaintext}`, new Date('2026-08-27T00:00:01.000Z'));
		expect(listApiTokens(db)[0].lastUsedAt).toBe('2026-08-27T00:00:00.000Z');
	});
});

describe('revokeApiToken', () => {
	it('is scoped to one token: the others keep working', () => {
		const a = createApiToken(db, { name: 'a' });
		const b = createApiToken(db, { name: 'b' });
		revokeApiToken(db, a.token.id);
		expect(verifyBearer(db, `Bearer ${a.plaintext}`)).toBeNull();
		expect(verifyBearer(db, `Bearer ${b.plaintext}`)?.tokenId).toBe(b.token.id);
	});

	it('is idempotent and keeps the first revocation timestamp', () => {
		const { token } = createApiToken(db, { name: 'a' });
		revokeApiToken(db, token.id);
		const first = listApiTokens(db)[0].revokedAt;
		revokeApiToken(db, token.id);
		expect(listApiTokens(db)[0].revokedAt).toBe(first);
	});

	it('raises not_found for an unknown id', () => {
		expect(() => revokeApiToken(db, 'nope')).toThrowError(/no api token nope/);
	});
});
