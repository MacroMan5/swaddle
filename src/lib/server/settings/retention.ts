// Bounds the growth of application-created SQLite snapshots (#57): backups
// and pre-restore snapshots each accumulate under `DATA_DIR/backups` with a
// timestamp in their filename and are never rewritten, so without pruning the
// directory grows forever. Kept deliberately dumb: no configuration, a fixed
// number of newest snapshots per kind survives.
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DEFAULT_RETENTION = 10;

/**
 * Deletes the oldest snapshots of one kind (`backup-*.sqlite` or
 * `pre-restore-*.sqlite`) under `dir`, keeping the newest `keep`. Ordered by
 * mtime (filename as a tiebreaker for identical/close timestamps, so pruning
 * is deterministic even when two snapshots land in the same millisecond).
 *
 * `protectedPath`, when given, is never a deletion candidate regardless of
 * its mtime — it's the snapshot the caller just wrote, and a clock that runs
 * backward (or future-dated files dropped into the directory) must not make
 * pruning delete it out from under a caller that's about to read or report
 * it. Protecting it takes priority over the exact count: if it's among the
 * matching snapshots, the newest `keep - 1` *other* snapshots survive
 * alongside it, so at most `keep` files remain in the common case, but never
 * fewer than the protected file itself.
 *
 * Best-effort and silent otherwise: a missing directory, a file that
 * disappears or fails to stat/delete mid-scan, or a permission error is not
 * thrown — a snapshot that was just written successfully must never be
 * undone by a pruning failure, and the newest `keep` files are never
 * touched, so at worst an old snapshot survives a bit longer than intended.
 */
export function pruneSnapshots(
	dir: string,
	prefix: 'backup' | 'pre-restore',
	keep = DEFAULT_RETENTION,
	protectedPath?: string
): void {
	const pattern = new RegExp(`^${prefix}-.*\\.sqlite$`);
	const protectedResolved = protectedPath !== undefined ? resolve(protectedPath) : undefined;
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return; // no backups directory yet — nothing to prune
	}

	const snapshots: { name: string; path: string; mtimeMs: number }[] = [];
	let protectedIsMatch = false;
	for (const name of names) {
		if (!pattern.test(name)) continue; // leaves unrelated/temporary files untouched
		const path = join(dir, name);
		if (protectedResolved !== undefined && resolve(path) === protectedResolved) {
			protectedIsMatch = true;
			continue; // never a deletion candidate, regardless of its mtime
		}
		try {
			const stat = statSync(path);
			if (!stat.isFile()) continue;
			snapshots.push({ name, path, mtimeMs: stat.mtimeMs });
		} catch {
			// disappeared between readdir and stat — not this function's problem
		}
	}

	const otherKeep = protectedIsMatch ? Math.max(0, keep - 1) : keep;
	if (snapshots.length <= otherKeep) return;

	snapshots.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
	const victims = snapshots.slice(0, snapshots.length - otherKeep);
	for (const victim of victims) {
		try {
			unlinkSync(victim.path);
		} catch {
			// leave it: a stuck file is safer than risking a good recovery point
		}
	}
}
