import { createEvent, deleteEvent, nursingAction, startTimer, stopTimer } from './api';
import type {
	CreateEventInput,
	EventDTO,
	NursingActionBody,
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
	delete(id: string): Promise<EventDTO>;
	startTimer(
		type: TimerType,
		body: StartTimerBody
	): Promise<{ created: boolean; event: EventDTO }>;
	stopTimer(type: TimerType, body: StopTimerBody): Promise<EventDTO>;
	nursingAction(body: NursingActionBody): Promise<EventDTO>;
};

export const httpActivityChangeTransport: ActivityChangeTransport = {
	create: (input) => createEvent(input),
	delete: (id) => deleteEvent(id),
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

	constructor(
		private readonly transport: ActivityChangeTransport,
		private readonly confirm: (
			change: ConfirmedActivityChange,
			delivery: ActivityChangeDelivery
		) => void
	) {}

	async create(input: CreateEventInput): Promise<EventDTO> {
		const sseSequenceAtStart = this.#sseSequence;
		const event = await this.transport.create(input);
		this.confirm({ kind: 'created', event }, { source: 'http', sseSequenceAtStart });
		return event;
	}

	async delete(id: string): Promise<EventDTO> {
		const sseSequenceAtStart = this.#sseSequence;
		const event = await this.transport.delete(id);
		this.confirm({ kind: 'deleted', event }, { source: 'http', sseSequenceAtStart });
		return event;
	}

	async startTimer(type: TimerType, body: StartTimerBody): Promise<EventDTO> {
		const sseSequenceAtStart = this.#sseSequence;
		const result = await this.transport.startTimer(type, body);
		this.confirm(
			{ kind: result.created ? 'created' : 'adopted', event: result.event },
			{ source: 'http', sseSequenceAtStart }
		);
		return result.event;
	}

	async stopTimer(type: TimerType, body: StopTimerBody): Promise<EventDTO> {
		const sseSequenceAtStart = this.#sseSequence;
		const event = await this.transport.stopTimer(type, body);
		this.confirm({ kind: 'updated', event }, { source: 'http', sseSequenceAtStart });
		return event;
	}

	async nursingAction(body: NursingActionBody): Promise<EventDTO> {
		const sseSequenceAtStart = this.#sseSequence;
		const event = await this.transport.nursingAction(body);
		this.confirm({ kind: 'updated', event }, { source: 'http', sseSequenceAtStart });
		return event;
	}

	/** Entry used by the owned SSE adapter after it receives a confirmed change. */
	receive(change: ConfirmedActivityChange): void {
		this.confirm(change, { source: 'sse', sequence: ++this.#sseSequence });
	}
}
