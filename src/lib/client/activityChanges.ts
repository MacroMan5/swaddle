import {
	createEvent,
	deleteEvent,
	nursingAction,
	patchEvent,
	restoreEvent,
	startTimer,
	stopTimer
} from './api';
import type {
	CreateEventInput,
	EventDTO,
	NursingActionBody,
	PatchEventInput,
	StartTimerBody,
	StopTimerBody,
	SyncKind,
	TimerType
} from './types';

export type ActivityChangeKind = SyncKind | 'adopted';
export type ConfirmedActivityChange = { kind: ActivityChangeKind; event: EventDTO };
export type ActivityChangeDelivery =
	| { source: 'http'; sseSequenceAtStart: number }
	| { source: 'sse'; sequence: number };

export type ActivityChangeTransport = {
	create(input: CreateEventInput): Promise<EventDTO>;
	patch(id: string, input: PatchEventInput): Promise<EventDTO>;
	delete(id: string): Promise<EventDTO>;
	restore(id: string): Promise<EventDTO>;
	startTimer(
		type: TimerType,
		body: StartTimerBody
	): Promise<{ created: boolean; event: EventDTO }>;
	stopTimer(type: TimerType, body: StopTimerBody): Promise<EventDTO>;
	nursingAction(body: NursingActionBody): Promise<EventDTO>;
};

export type ActivityChangeIntents = Pick<
	ActivityChanges,
	'create' | 'patch' | 'delete' | 'restore' | 'startTimer' | 'stopTimer' | 'nursingAction'
>;

export const httpActivityChangeTransport: ActivityChangeTransport = {
	create: (input) => createEvent(input),
	patch: (id, input) => patchEvent(id, input),
	delete: (id) => deleteEvent(id),
	restore: (id) => restoreEvent(id),
	startTimer: (type, body) => startTimer(type, body),
	stopTimer: (type, body) => stopTimer(type, body),
	nursingAction: (body) => nursingAction(body)
};

/**
 * The view-facing interface for confirmed Activity writes. Transport details
 * and local reconciliation stay behind this seam; presentation state remains
 * with the caller.
 */
export class ActivityChanges {
	#sseSequence = 0;
	#epoch = 0;

	constructor(
		private readonly transport: ActivityChangeTransport,
		private readonly confirm: (
			change: ConfirmedActivityChange,
			delivery: ActivityChangeDelivery
		) => void,
		private readonly recover: () => void
	) {}

	async create(input: CreateEventInput): Promise<EventDTO> {
		const epochAtStart = this.#epoch;
		const sseSequenceAtStart = this.#sseSequence;
		const event = await this.transport.create(input);
		this.#confirmHttp({ kind: 'created', event }, epochAtStart, sseSequenceAtStart);
		return event;
	}

	async delete(id: string): Promise<EventDTO> {
		const epochAtStart = this.#epoch;
		const sseSequenceAtStart = this.#sseSequence;
		const event = await this.transport.delete(id);
		this.#confirmHttp({ kind: 'deleted', event }, epochAtStart, sseSequenceAtStart);
		return event;
	}

	async patch(id: string, input: PatchEventInput): Promise<EventDTO> {
		const epochAtStart = this.#epoch;
		const sseSequenceAtStart = this.#sseSequence;
		const event = await this.transport.patch(id, input);
		this.#confirmHttp({ kind: 'updated', event }, epochAtStart, sseSequenceAtStart);
		return event;
	}

	async restore(id: string): Promise<EventDTO> {
		const epochAtStart = this.#epoch;
		const sseSequenceAtStart = this.#sseSequence;
		const event = await this.transport.restore(id);
		this.#confirmHttp({ kind: 'restored', event }, epochAtStart, sseSequenceAtStart);
		return event;
	}

	async startTimer(type: TimerType, body: StartTimerBody): Promise<EventDTO> {
		const epochAtStart = this.#epoch;
		const sseSequenceAtStart = this.#sseSequence;
		const result = await this.transport.startTimer(type, body);
		this.#confirmHttp(
			{ kind: result.created ? 'created' : 'adopted', event: result.event },
			epochAtStart,
			sseSequenceAtStart
		);
		return result.event;
	}

	async stopTimer(type: TimerType, body: StopTimerBody): Promise<EventDTO> {
		const epochAtStart = this.#epoch;
		const sseSequenceAtStart = this.#sseSequence;
		const event = await this.transport.stopTimer(type, body);
		this.#confirmHttp({ kind: 'updated', event }, epochAtStart, sseSequenceAtStart);
		return event;
	}

	async nursingAction(body: NursingActionBody): Promise<EventDTO> {
		const epochAtStart = this.#epoch;
		const sseSequenceAtStart = this.#sseSequence;
		const event = await this.transport.nursingAction(body);
		this.#confirmHttp({ kind: 'updated', event }, epochAtStart, sseSequenceAtStart);
		return event;
	}

	#confirmHttp(change: ConfirmedActivityChange, epochAtStart: number, sseSequenceAtStart: number): void {
		// The transport already committed successfully. Recovery owns state after
		// an epoch change; skip the stale incremental projection without turning a
		// confirmed write into a retryable failure that could duplicate a create.
		if (epochAtStart !== this.#epoch) {
			this.recover();
			return;
		}
		this.confirm(change, { source: 'http', sseSequenceAtStart });
	}

	/** Invalidates confirmations from writes begun before an authoritative reset. */
	invalidate(): void {
		this.#epoch++;
	}

	/** Entry used by the owned SSE adapter after it receives a confirmed change. */
	receive(change: ConfirmedActivityChange): void {
		this.confirm(change, { source: 'sse', sequence: ++this.#sseSequence });
	}
}
