// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/**
			 * Set by `hooks.server.ts` from a valid `Authorization: Bearer`
			 * header (issue #97), null otherwise. Its `caregiverId` is what a
			 * later slice attributes API-made writes to.
			 */
			apiToken: { tokenId: string; caregiverId: string | null } | null;
		}
		// The root layout load puts the household's volume unit (issue #44) on
		// every page's data, so components can read `page.data.volumeUnit`.
		interface PageData {
			volumeUnit: import('$lib/client/volume').VolumeUnit;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
