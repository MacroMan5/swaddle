// Client-side mirror of the API contract (docs/api/events-api.md). Declared here
// on purpose: client code must never import from $lib/server/*.

export type EventType = 'nursing' | 'bottle' | 'pump' | 'diaper' | 'sleep';
export type TimerType = 'nursing' | 'pump' | 'sleep';
export type Side = 'left' | 'right';
export type PumpSide = Side | 'both';
export type MilkType = 'breast' | 'formula' | 'mixed';

export type NursingSegment = { side: Side; startedAt: string; endedAt: string | null };

export type NursingDetails = { segments: NursingSegment[] };
export type BottleDetails = { milkType: MilkType; volumeMl: number };
export type PumpDetails = { side: PumpSide; volumeMl: number | null };
export type DiaperDetails = { pee: boolean; poo: boolean };
export type SleepDetails = Record<string, never>;

export type Details =
	| NursingDetails
	| BottleDetails
	| PumpDetails
	| DiaperDetails
	| SleepDetails;

export type EventDTO = {
	id: string;
	babyId: string;
	caregiverId: string | null;
	type: EventType;
	startedAt: string;
	endedAt: string | null;
	note: string | null;
	details: Details;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
};

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

export type NursingActionBody = {
	babyId: string;
	action: 'pause' | 'resume' | 'switch-side';
	side?: Side;
};

export type SyncKind = 'created' | 'updated' | 'deleted' | 'restored';
export type SyncMessage = { kind: SyncKind; event: EventDTO; serverTime: string };
export type SnapshotMessage = { serverTime: string; activeTimers: EventDTO[] };

/** Narrowing helpers — the DTO is a union over `type`. */
export type TypedEvent<T extends EventType> = EventDTO & {
	type: T;
	details: T extends 'nursing'
		? NursingDetails
		: T extends 'bottle'
			? BottleDetails
			: T extends 'pump'
				? PumpDetails
				: T extends 'diaper'
					? DiaperDetails
					: SleepDetails;
};

export function isType<T extends EventType>(event: EventDTO, type: T): event is TypedEvent<T> {
	return event.type === type;
}
