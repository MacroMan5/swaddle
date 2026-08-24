import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lastBackupAt, serverInfo } from './serverInfo';

let dir: string | null = null;

function tempDataDir(): string {
	dir = mkdtempSync(join(tmpdir(), 'swaddle-serverinfo-'));
	return dir;
}

afterEach(() => {
	if (dir !== null) rmSync(dir, { recursive: true, force: true });
	dir = null;
});

describe('lastBackupAt', () => {
	it('returns null when no backups directory exists', () => {
		expect(lastBackupAt(tempDataDir())).toBeNull();
	});

	it('returns null when the directory has no snapshot', () => {
		const dataDir = tempDataDir();
		mkdirSync(join(dataDir, 'backups'));
		writeFileSync(join(dataDir, 'backups', 'notes.txt'), 'not a backup');
		expect(lastBackupAt(dataDir)).toBeNull();
	});

	it('returns the mtime of the newest snapshot', () => {
		const dataDir = tempDataDir();
		const backups = join(dataDir, 'backups');
		mkdirSync(backups);
		const older = join(backups, 'backup-2026-08-20.sqlite');
		const newer = join(backups, 'backup-2026-08-24.sqlite');
		writeFileSync(older, 'a');
		writeFileSync(newer, 'b');
		const oldTime = new Date('2026-08-20T10:00:00.000Z');
		const newTime = new Date('2026-08-24T09:12:31.000Z');
		utimesSync(older, oldTime, oldTime);
		utimesSync(newer, newTime, newTime);
		expect(lastBackupAt(dataDir)).toBe('2026-08-24T09:12:31.000Z');
	});
});

describe('serverInfo', () => {
	it('assembles address, device count and last backup', () => {
		const dataDir = tempDataDir();
		expect(serverInfo({ origin: 'http://bebe.home:3010', dataDir, devices: 2 })).toEqual({
			address: 'http://bebe.home:3010',
			connectedDevices: 2,
			lastBackupAt: null
		});
	});
});
