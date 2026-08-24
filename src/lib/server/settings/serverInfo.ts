// "Ce serveur" block (settings): address, connected devices, last backup.
// Pure assembly — the route and the settings page loader both call it, so the
// SSR block and the API can never disagree.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type ServerInfoDTO = {
	/** Host the request came in on, e.g. "bebe.home:3010" — the protocol is
	 * not guessed (SSR behind no TLS misreports it). */
	address: string;
	/** Open SSE streams right now — two tabs count as two devices. */
	connectedDevices: number;
	/** ISO mtime of the newest snapshot under `<dataDir>/backups`, or null. */
	lastBackupAt: string | null;
};

export function lastBackupAt(dataDir: string): string | null {
	const dir = join(dataDir, 'backups');
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return null; // no backup was ever taken — the directory doesn't exist yet
	}
	let newestMs = 0;
	for (const name of names) {
		if (!name.endsWith('.sqlite')) continue;
		try {
			const ms = statSync(join(dir, name)).mtimeMs;
			if (ms > newestMs) newestMs = ms;
		} catch {
			// a file disappearing mid-scan is not an error
		}
	}
	return newestMs === 0 ? null : new Date(newestMs).toISOString();
}

export function serverInfo(opts: {
	host: string;
	dataDir: string;
	devices: number;
}): ServerInfoDTO {
	return {
		address: opts.host,
		connectedDevices: opts.devices,
		lastBackupAt: lastBackupAt(opts.dataDir)
	};
}
