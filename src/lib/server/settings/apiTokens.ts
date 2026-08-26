import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { RepoError } from '$lib/server/events/repo';

type DB = Database.Database;

export type ApiTokenDTO = {
	id: string;
	name: string;
	caregiverId: string | null;
	createdAt: string;
	lastUsedAt: string | null;
	revokedAt: string | null;
};

type ApiTokenRow = {
	id: string;
	name: string;
	caregiver_id: string | null;
	created_at: string;
	last_used_at: string | null;
	revoked_at: string | null;
};

/** Identifies a Swaddle token at a glance — in a log, a shortcut, a secret scan. */
const TOKEN_PREFIX = 'swd_';
const TOKEN_BYTES = 32;

const SELECT_COLUMNS = 'id, name, caregiver_id, created_at, last_used_at, revoked_at';

function rowToDto(row: ApiTokenRow): ApiTokenDTO {
	return {
		id: row.id,
		name: row.name,
		caregiverId: row.caregiver_id,
		createdAt: row.created_at,
		lastUsedAt: row.last_used_at,
		revokedAt: row.revoked_at
	};
}

/**
 * SHA-256 hex, not scrypt. The PIN is a weak human secret that has to survive a
 * stolen database file, so it pays for a slow KDF; a token is 256 bits of
 * machine entropy, unguessable by construction, and `verifyBearer` runs on
 * every single API request — a per-request scrypt would be the wrong trade.
 */
function hashToken(plaintext: string): string {
	return createHash('sha256').update(plaintext).digest('hex');
}

/** Midnight UTC of `now`, the granularity `last_used_at` is kept at. */
function dayStartIso(now: Date): string {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function getToken(db: DB, id: string): ApiTokenDTO {
	const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM api_token WHERE id = ?`).get(id) as
		| ApiTokenRow
		| undefined;
	if (!row) throw new RepoError('not_found', `no api token ${id}`);
	return rowToDto(row);
}

/**
 * Mints a token. The plaintext is returned here and nowhere else — only its
 * hash is stored, so a lost token is recreated, never recovered.
 */
export function createApiToken(
	db: DB,
	input: { name: string; caregiverId?: string | null }
): { plaintext: string; token: ApiTokenDTO } {
	const plaintext = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
	const id = randomUUID();
	const caregiverId = input.caregiverId ?? null;
	db.prepare(
		'INSERT INTO api_token (id, name, token_hash, caregiver_id, created_at) VALUES (?, ?, ?, ?, ?)'
	).run(id, input.name, hashToken(plaintext), caregiverId, new Date().toISOString());
	return { plaintext, token: getToken(db, id) };
}

/** Every token, revoked ones included — the settings list shows their state. */
export function listApiTokens(db: DB): ApiTokenDTO[] {
	return (
		// rowid breaks the tie: two tokens minted in the same millisecond share a
		// created_at, and a random UUID would order them arbitrarily.
		db.prepare(`SELECT ${SELECT_COLUMNS} FROM api_token ORDER BY created_at, rowid`).all() as ApiTokenRow[]
	).map(rowToDto);
}

/**
 * Revocation is a timestamp, not a delete: the row stays in the list so a
 * parent can see the device was cut off, and the hash stays taken so the same
 * plaintext can never come back to life.
 */
export function revokeApiToken(db: DB, id: string): void {
	getToken(db, id); // 404 for an unknown id, before writing anything
	// `revoked_at IS NULL` keeps a second revocation from moving the timestamp.
	db.prepare('UPDATE api_token SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(
		new Date().toISOString(),
		id
	);
}

/** `Bearer <plaintext>` → the secret, or null for anything else. */
function parseBearer(header: string | null): string | null {
	if (!header) return null;
	const parts = header.split(' ');
	if (parts.length !== 2) return null;
	if (parts[0].toLowerCase() !== 'bearer') return null;
	return parts[1] === '' ? null : parts[1];
}

/**
 * The gate's Bearer half: resolves an `Authorization` header to a live token,
 * or null (unknown, malformed, revoked). `now` is injected so tests don't
 * depend on the wall clock.
 *
 * Side effect by design: it stamps `last_used_at`, rounded to the day, so the
 * settings list can say when a device was last heard from without turning
 * every API call into a write.
 */
export function verifyBearer(
	db: DB,
	header: string | null,
	now: Date = new Date()
): { tokenId: string; caregiverId: string | null } | null {
	const plaintext = parseBearer(header);
	if (plaintext === null) return null;

	const expected = hashToken(plaintext);
	const row = db
		.prepare('SELECT id, token_hash, caregiver_id, last_used_at, revoked_at FROM api_token')
		.all() as {
		id: string;
		token_hash: string;
		caregiver_id: string | null;
		last_used_at: string | null;
		revoked_at: string | null;
	}[];

	// Scanned and compared with timingSafeEqual rather than looked up by hash in
	// SQL: a household holds a handful of tokens, and this keeps the comparison
	// off SQLite's early-exit string compare. Both digests are fixed-length hex,
	// so the lengths always match.
	const expectedBuf = Buffer.from(expected, 'hex');
	const match = row.find((r) => {
		const actual = Buffer.from(r.token_hash, 'hex');
		return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf);
	});
	if (!match || match.revoked_at !== null) return null;

	const today = dayStartIso(now);
	if (match.last_used_at !== today)
		db.prepare('UPDATE api_token SET last_used_at = ? WHERE id = ?').run(today, match.id);

	return { tokenId: match.id, caregiverId: match.caregiver_id };
}
