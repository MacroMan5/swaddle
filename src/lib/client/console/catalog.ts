/**
 * The API console's endpoint catalog (issue #115): one entry per call shape a
 * person would want to fire by hand, prefilled so debugging a shortcut takes
 * seconds. Pure data — the markdown contracts under `docs/api/` remain the
 * source of truth; `doc` names the one describing each entry.
 */

export type ConsoleMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type ConsoleEndpoint = {
	/** Stable identifier, also the `data-testid` suffix in the page. */
	id: string;
	/** Display group, in French like the rest of the UI. */
	group: string;
	method: ConsoleMethod;
	/**
	 * Path template, editable as-is in the console: `[id]` placeholders and
	 * empty query values (`?babyId=`) are meant to be filled by hand.
	 */
	path: string;
	summary: string;
	/** Pretty-printed JSON body template, absent for bodyless calls. */
	body?: string;
	/** Asks for confirmation before sending — the call destroys or replaces. */
	danger?: boolean;
	/** A Bearer never reaches this path (gate rule): PIN session only. */
	pinOnly?: boolean;
	/** Contract file under docs/api/. */
	doc: string;
};

const body = (value: unknown): string => JSON.stringify(value, null, 2);

export const CONSOLE_ENDPOINTS: ConsoleEndpoint[] = [
	// Santé
	{
		id: 'health',
		group: 'Santé',
		method: 'GET',
		path: '/api/health',
		summary: 'État du serveur et de la configuration (public).',
		doc: 'settings-api.md'
	},
	{
		id: 'server-info',
		group: 'Santé',
		method: 'GET',
		path: '/api/server-info',
		summary: 'Bloc « Ce serveur » : version, adresse, données.',
		doc: 'settings-api.md'
	},

	// Saisie rapide
	{
		id: 'quick-phrase',
		group: 'Saisie rapide',
		method: 'POST',
		path: '/api/quick',
		summary: 'Dictée libre, résolue contre le vocabulaire du foyer.',
		body: body({ action: 'phrase', text: 'néné droite' }),
		doc: 'quick-api.md'
	},
	{
		id: 'quick-bottle',
		group: 'Saisie rapide',
		method: 'POST',
		path: '/api/quick',
		summary: 'Biberon structuré (volume entier en ml, 1–1000).',
		body: body({ action: 'bottle', volumeMl: 120 }),
		doc: 'quick-api.md'
	},
	{
		id: 'quick-diaper',
		group: 'Saisie rapide',
		method: 'POST',
		path: '/api/quick',
		summary: 'Couche (kind : wet, dirty ou both).',
		body: body({ action: 'diaper', kind: 'wet' }),
		doc: 'quick-api.md'
	},
	{
		id: 'quick-sleep',
		group: 'Saisie rapide',
		method: 'POST',
		path: '/api/quick',
		summary: 'Dodo — bascule démarrer/arrêter.',
		body: body({ action: 'sleep' }),
		doc: 'quick-api.md'
	},
	{
		id: 'quick-nursing',
		group: 'Saisie rapide',
		method: 'POST',
		path: '/api/quick',
		summary: 'Tétée — bascule ; side optionnel (left/right).',
		body: body({ action: 'nursing', side: 'left' }),
		doc: 'quick-api.md'
	},
	{
		id: 'quick-words-list',
		group: 'Saisie rapide',
		method: 'GET',
		path: '/api/quick/words',
		summary: 'Vocabulaire du foyer.',
		doc: 'quick-api.md'
	},
	{
		id: 'quick-words-add',
		group: 'Saisie rapide',
		method: 'POST',
		path: '/api/quick/words',
		summary: 'Ajoute un mot de vocabulaire (un seul mot une fois tokenisé).',
		body: body({ word: 'nono', intent: { action: 'sleep' } }),
		doc: 'quick-api.md'
	},
	{
		id: 'quick-words-delete',
		group: 'Saisie rapide',
		method: 'DELETE',
		path: '/api/quick/words/[id]',
		summary: 'Supprime un mot de vocabulaire.',
		doc: 'quick-api.md'
	},

	// Événements
	{
		id: 'events-list',
		group: 'Événements',
		method: 'GET',
		path: '/api/events?babyId=&from=&to=&overlap=&deleted=',
		summary: 'Événements d’un bébé (babyId obligatoire ; from/to ISO 8601).',
		doc: 'events-api.md'
	},
	{
		id: 'events-create',
		group: 'Événements',
		method: 'POST',
		path: '/api/events',
		summary: 'Crée un événement terminé ou saisi manuellement.',
		body: body({
			babyId: '',
			type: 'bottle',
			startedAt: new Date().toISOString(),
			details: { milkType: 'breast', volumeMl: 120 }
		}),
		doc: 'events-api.md'
	},
	{
		id: 'events-get',
		group: 'Événements',
		method: 'GET',
		path: '/api/events/[id]',
		summary: 'Un événement, même supprimé en douceur.',
		doc: 'events-api.md'
	},
	{
		id: 'events-patch',
		group: 'Événements',
		method: 'PATCH',
		path: '/api/events/[id]',
		summary: 'Corrige un événement (champs optionnels, inconnus rejetés).',
		body: body({ note: 'corrigé depuis la console' }),
		doc: 'events-api.md'
	},
	{
		id: 'events-delete',
		group: 'Événements',
		method: 'DELETE',
		path: '/api/events/[id]',
		summary: 'Suppression douce (annulable via restore).',
		doc: 'events-api.md'
	},
	{
		id: 'events-restore',
		group: 'Événements',
		method: 'POST',
		path: '/api/events/[id]/restore',
		summary: 'Annule une suppression douce.',
		doc: 'events-api.md'
	},

	// Minuteurs
	{
		id: 'timers-active',
		group: 'Minuteurs',
		method: 'GET',
		path: '/api/timers?babyId=',
		summary: 'Minuteurs actifs et heure serveur (babyId optionnel).',
		doc: 'events-api.md'
	},
	{
		id: 'timers-start',
		group: 'Minuteurs',
		method: 'POST',
		path: '/api/timers/[type]/start',
		summary: 'Démarre nursing, pump ou sleep pour un bébé.',
		body: body({ babyId: '' }),
		doc: 'events-api.md'
	},
	{
		id: 'timers-stop',
		group: 'Minuteurs',
		method: 'POST',
		path: '/api/timers/[type]/stop',
		summary: 'Arrête le minuteur actif (volumeMl requis pour pump).',
		body: body({ babyId: '' }),
		doc: 'events-api.md'
	},
	{
		id: 'timers-nursing-action',
		group: 'Minuteurs',
		method: 'POST',
		path: '/api/timers/nursing/action',
		summary: 'pause, resume ou switch-side sur la tétée en cours.',
		body: body({ babyId: '', action: 'switch-side' }),
		doc: 'events-api.md'
	},

	// Foyer
	{
		id: 'babies-list',
		group: 'Foyer',
		method: 'GET',
		path: '/api/babies',
		summary: 'Bébés du foyer.',
		doc: 'settings-api.md'
	},
	{
		id: 'caregivers-list',
		group: 'Foyer',
		method: 'GET',
		path: '/api/caregivers',
		summary: 'Aidants du foyer.',
		doc: 'settings-api.md'
	},
	{
		id: 'household-get',
		group: 'Foyer',
		method: 'GET',
		path: '/api/household',
		summary: 'Réglages du foyer (unité de volume, thème…).',
		doc: 'settings-api.md'
	},
	{
		id: 'household-patch',
		group: 'Foyer',
		method: 'PATCH',
		path: '/api/household',
		summary: 'Modifie les réglages du foyer.',
		body: body({ volumeUnit: 'ml' }),
		doc: 'settings-api.md'
	},

	// Transfert
	{
		id: 'export-json',
		group: 'Transfert',
		method: 'GET',
		path: '/api/export/json',
		summary: 'Export JSON complet du foyer.',
		doc: 'settings-api.md'
	},
	{
		id: 'export-csv',
		group: 'Transfert',
		method: 'GET',
		path: '/api/export/csv',
		summary: 'Export CSV des événements.',
		doc: 'settings-api.md'
	},
	{
		id: 'restore',
		group: 'Transfert',
		method: 'POST',
		path: '/api/restore',
		summary: 'REMPLACE toutes les données par un export JSON.',
		body: body({}),
		danger: true,
		doc: 'settings-api.md'
	},

	// Jetons (session PIN seulement — un Bearer est refusé par la porte)
	{
		id: 'tokens-list',
		group: 'Jetons API',
		method: 'GET',
		path: '/api/tokens',
		summary: 'Jetons émis (le clair n’est jamais relu).',
		pinOnly: true,
		doc: 'settings-api.md'
	},
	{
		id: 'tokens-create',
		group: 'Jetons API',
		method: 'POST',
		path: '/api/tokens',
		summary: 'Émet un jeton nommé (clair rendu une seule fois).',
		body: body({ name: 'Console' }),
		pinOnly: true,
		doc: 'settings-api.md'
	},
	{
		id: 'tokens-revoke',
		group: 'Jetons API',
		method: 'DELETE',
		path: '/api/tokens/[id]',
		summary: 'Révoque un jeton.',
		danger: true,
		pinOnly: true,
		doc: 'settings-api.md'
	}
];
