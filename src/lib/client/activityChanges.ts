import { createEvent, deleteEvent } from './api';
import type { CreateEventInput, EventDTO, SyncKind } from './types';

export type ConfirmedActivityChange = { kind: SyncKind; event: EventDTO };

export type ActivityChangeTransport = {
	create(input: CreateEventInput): Promise<EventDTO>;
	delete(id: string): Promise<EventDTO>;
};

export const httpActivityChangeTransport: ActivityChangeTransport = {
	create: (input) => createEvent(input),
	delete: (id) => deleteEvent(id)
};

/**
 * The view-facing interface for confirmed Activity writes. Transport details
 * and local reconciliation stay behind this seam; presentation state remains
 * with the caller.
 */
export class ActivityChanges {
	constructor(
		private readonly transport: ActivityChangeTransport,
		private readonly confirm: (change: ConfirmedActivityChange) => void
	) {}

	async create(input: CreateEventInput): Promise<EventDTO> {
		const event = await this.transport.create(input);
		this.receive({ kind: 'created', event });
		return event;
	}

	async delete(id: string): Promise<EventDTO> {
		const event = await this.transport.delete(id);
		this.receive({ kind: 'deleted', event });
		return event;
	}

	/** Entry used by the owned SSE adapter after it receives a confirmed change. */
	receive(change: ConfirmedActivityChange): void {
		this.confirm(change);
	}
}
