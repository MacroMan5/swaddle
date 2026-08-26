// The shared half of the API contract (docs/api/events-api.md) lives in
// `$lib/shared/events` — one definition for client and server. This module only
// adds what is purely client-side: the request bodies the client sends and the
// SSE messages it receives. It re-exports the shared names so existing imports
// from `$lib/client/types` keep working.

export {
	EVENT_TYPES,
	TIMER_TYPES,
	POINT_TYPES,
	CATEGORY_OF,
	isTimerType,
	isPointType,
	isType,
	detailsOf
} from '$lib/shared/events';

export type {
	Category,
	EventType,
	TimerType,
	PointType,
	Side,
	PumpSide,
	MilkType,
	NursingSegment,
	NursingDetails,
	BottleDetails,
	PumpDetails,
	DiaperDetails,
	SleepDetails,
	DetailsByType,
	Details,
	EventDTO,
	TypedEvent
} from '$lib/shared/events';

import type { Details, EventDTO, EventType, PumpSide, Side } from '$lib/shared/events';

export type BabyDTO = { id: string; name: string; birthdate: string; timezone: string };

export type CaregiverDTO = { id: string; name: string; color: string };

export type Issue = { path: string; code: string; message: string };

export type CreateEventInput = {
	babyId: string;
	caregiverId?: string | null;
	type: EventType;
	startedAt: string;
	endedAt?: string | null;
	note?: string | null;
	details: Details;
};

export type StartTimerBody = {
	babyId: string;
	caregiverId?: string | null;
	side?: PumpSide;
	startedAt?: string;
};

export type StopTimerBody = { babyId: string; endedAt?: string; volumeMl?: number };

export type PatchEventInput = {
	caregiverId?: string | null;
	startedAt?: string;
	endedAt?: string;
	note?: string | null;
	details?: Details;
};

export type NursingActionBody = {
	babyId: string;
	action: 'pause' | 'resume' | 'switch-side';
	side?: Side;
};

export type SyncKind = 'created' | 'updated' | 'deleted' | 'restored';
export type SyncMessage = { kind: SyncKind; event: EventDTO; serverTime: string };
export type SnapshotMessage = { serverTime: string; activeTimers: EventDTO[] };
/** #46: a baby's name/birthdate was corrected on another device. */
export type BabyUpdateMessage = { baby: BabyDTO; serverTime: string };
