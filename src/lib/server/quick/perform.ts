import type Database from 'better-sqlite3';
import {
	detailsOf,
	nursingDurationMs,
	parseCreateEvent,
	type EventDTO,
	type Side,
	type TimerType
} from '../events/types';
import {
	createEvent,
	lastEventOfType,
	listActiveTimers,
	listBabies,
	RepoError,
	startTimer,
	stopTimer
} from '../events/repo';
import { publish, type Change } from '../events/broadcast';
import { SPOKEN_DIAPER, SPOKEN_SIDE, spokenDuration } from './speech';
import type { QuickIntent } from './types';

type DB = Database.Database;

/**
 * The one refusal this module owns. Everything else it can go wrong on is a
 * `RepoError` raised by the domain (FR-017 validation above all), which the
 * routes already map.
 */
export class QuickError extends Error {
	constructor(
		public code: 'ambiguous_baby',
		message: string
	) {
		super(message);
	}
}

export type QuickResult = {
	event: EventDTO;
	did: 'logged' | 'started' | 'stopped';
	/** French sentence a voice assistant reads back to the parent. */
	speech: string;
};

/** The bottle intent carries a volume and nothing else; the milk type has to
 * come from somewhere, and "breast" is what the Today sheet opens on. */
const DEFAULT_MILK_TYPE = 'breast';

/**
 * No id from the caller in the ordinary household: there is one baby, and the
 * whole point of a spoken shortcut is not having to name it. Anything else is
 * a refusal the client can answer with an explicit `babyId`.
 */
function resolveBaby(db: DB, explicit: string | undefined): string {
	if (explicit !== undefined) return explicit;
	const babies = listBabies(db);
	if (babies.length === 1) return babies[0].id;
	if (babies.length === 0)
		throw new QuickError('ambiguous_baby', 'no baby is configured; finish the setup first');
	throw new QuickError(
		'ambiguous_baby',
		'several babies exist; pass babyId to say which one this is for'
	);
}

/** Opposite of the side the last recorded session ended on; left by default. */
function defaultNursingSide(db: DB, babyId: string): Side {
	const last = lastEventOfType(db, babyId, 'nursing');
	if (!last) return 'left';
	const segments = detailsOf(last, 'nursing').segments;
	if (segments.length === 0) return 'left';
	return segments[segments.length - 1].side === 'left' ? 'right' : 'left';
}

/**
 * What to say a finished session lasted. Sleep is wall clock — it ran from
 * start to end. Nursing is not: a paused session keeps counting on the clock
 * while nobody is feeding, so the announced duration is the sum of its
 * segments (DEC-001), the same number the Today screen shows.
 */
function spokenLengthOf(event: EventDTO): string {
	const endedAt = Date.parse(event.endedAt ?? event.startedAt);
	if (event.type === 'nursing')
		return spokenDuration(nursingDurationMs(detailsOf(event, 'nursing').segments, endedAt));
	return spokenDuration(endedAt - Date.parse(event.startedAt));
}

type Outcome = { event: EventDTO; did: QuickResult['did']; speech: string };

function logPoint(
	db: DB,
	intent: Extract<QuickIntent, { action: 'bottle' | 'diaper' }>,
	babyId: string,
	caregiverId: string | null
): Outcome {
	const now = new Date();
	// A point event is zero-duration by the domain's convention: `endedAt` stays
	// null, exactly as one entered from the Today screen.
	const common = { babyId, caregiverId, startedAt: now.toISOString(), endedAt: null, note: null };
	const [input, speech] =
		intent.action === 'bottle'
			? ([
					{
						...common,
						type: 'bottle',
						details: { milkType: DEFAULT_MILK_TYPE, volumeMl: intent.volumeMl }
					},
					`Biberon ${intent.volumeMl} millilitres enregistré`
				] as const)
			: ([
					{
						...common,
						type: 'diaper',
						details: { pee: intent.kind !== 'dirty', poo: intent.kind !== 'wet' }
					},
					`Couche ${SPOKEN_DIAPER[intent.kind]} enregistrée`
				] as const);

	// The same FR-017 gate `POST /api/events` goes through, so a caller reaching
	// the module directly (a future MCP tool) cannot write what the HTTP route
	// would have refused.
	const parsed = parseCreateEvent(input, now);
	if (!parsed.ok) throw new RepoError('validation_failed', 'invalid quick intent', parsed.issues);
	return { event: createEvent(db, parsed.value), did: 'logged', speech };
}

/**
 * The heart of the surface: the same intent starts or stops, so a client never
 * has to know — and never sees a `timer_conflict`. Read and write happen inside
 * one transaction (the caller's), so "is one running?" and "start one" cannot
 * be split by a concurrent request.
 */
function toggleTimer(
	db: DB,
	type: TimerType,
	babyId: string,
	caregiverId: string | null,
	side: Side | undefined
): Outcome {
	const running = listActiveTimers(db, babyId).find((e) => e.type === type);
	const isSleep = type === 'sleep';

	if (running) {
		const event = stopTimer(db, { type, babyId });
		return {
			event,
			did: 'stopped',
			speech: `${isSleep ? 'Dodo terminé' : 'Tétée terminée'}, ${spokenLengthOf(event)}`
		};
	}

	const chosenSide = isSleep ? undefined : (side ?? defaultNursingSide(db, babyId));
	// `created` is always true here: the check above ran in the same
	// transaction, so nothing can have started a timer in between.
	const { event } = startTimer(db, { type, babyId, caregiverId, side: chosenSide });
	return {
		event,
		did: 'started',
		speech: isSleep
			? 'Dodo démarré'
			: `Tétée côté ${SPOKEN_SIDE[chosenSide as Side]} démarrée`
	};
}

/**
 * One intent in, one written and broadcast event out. Callers — the
 * `POST /api/quick` route today, Home Assistant and MCP adapters later — bring
 * a parsed intent and the caregiver the credential is linked to, and get back
 * the event plus what to say about it.
 */
export function performQuick(
	db: DB,
	intent: QuickIntent,
	ctx: { caregiverId: string | null }
): QuickResult {
	const babyId = resolveBaby(db, intent.babyId);
	const outcome = db.transaction((): Outcome => {
		switch (intent.action) {
			case 'bottle':
			case 'diaper':
				return logPoint(db, intent, babyId, ctx.caregiverId);
			case 'sleep':
				return toggleTimer(db, 'sleep', babyId, ctx.caregiverId, undefined);
			case 'nursing':
				return toggleTimer(db, 'nursing', babyId, ctx.caregiverId, intent.side);
		}
	})();

	// Published only once the transaction committed, so a connected Today
	// screen never sees an event a rollback took back.
	const change: Change =
		outcome.did === 'stopped'
			? { kind: 'updated', event: outcome.event }
			: { kind: 'created', event: outcome.event };
	publish(change);
	return outcome;
}
