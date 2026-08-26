import type {
	BabyDTO,
	CaregiverDTO,
	CreateEventInput,
	EventDTO,
	Issue,
	NursingActionBody,
	PatchEventInput,
	StartTimerBody,
	StopTimerBody,
	TimerType
} from './types';
import { todayRangeIso } from './format';
import { userMessage } from '../errors';

/**
 * Thrown for every non-2xx response, carrying the `{ error }` envelope.
 * `message` is the raw English server text (useful in the console);
 * `userMessage` is the French text to show, derived from `code`.
 */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly issues: Issue[];
	readonly userMessage: string;

	constructor(status: number, code: string, message: string, issues: Issue[] = []) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.issues = issues;
		this.userMessage = userMessage(code, issues);
	}
}

async function parse<T>(response: Response): Promise<T> {
	const text = await response.text();
	let body: unknown = null;
	try {
		body = text === '' ? null : JSON.parse(text);
	} catch {
		body = null;
	}
	if (!response.ok) {
		const envelope = (body as { error?: { code?: string; message?: string; issues?: Issue[] } })
			?.error;
		throw new ApiError(
			response.status,
			envelope?.code ?? 'unknown_error',
			envelope?.message ?? `La requête a échoué (${response.status}).`,
			envelope?.issues ?? []
		);
	}
	return body as T;
}

export async function getJson<T>(url: string): Promise<T> {
	return parse<T>(await fetch(url));
}

export async function sendJson<T>(method: string, url: string, body?: unknown): Promise<T> {
	return parse<T>(
		await fetch(url, {
			method,
			headers: { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		})
	);
}

export async function listBabies(): Promise<BabyDTO[]> {
	return (await getJson<{ babies: BabyDTO[] }>('/api/babies')).babies;
}

export async function listCaregivers(): Promise<CaregiverDTO[]> {
	return (await getJson<{ caregivers: CaregiverDTO[] }>('/api/caregivers')).caregivers;
}

/** Overlap mode (review item 1): a midnight-crossing session started
 * yesterday must still be fetched, or Today's summary would miss it even
 * though SyncStore's own retention (#isToday) now keeps it. */
export async function listTodayEvents(babyId: string, now = new Date()): Promise<EventDTO[]> {
	const { from, to } = todayRangeIso(now);
	const query = new URLSearchParams({ babyId, from, to, overlap: '1' });
	return (await getJson<{ events: EventDTO[] }>(`/api/events?${query}`)).events;
}

/** History/timeline fetches: window overlap (see `docs/api/events-api.md`) so a
 * midnight-crossing event stays visible from either day it touches (AC-006). */
export async function listEvents(
	babyId: string,
	from: string,
	to: string,
	overlap = true
): Promise<EventDTO[]> {
	const query = new URLSearchParams({ babyId, from, to });
	if (overlap) query.set('overlap', '1');
	return (await getJson<{ events: EventDTO[] }>(`/api/events?${query}`)).events;
}

/** "Recently deleted" recovery list (issue #50): soft-deleted events only,
 * most recently deleted first, unbounded by from/to (see events-api.md). */
export async function listDeletedEvents(babyId: string): Promise<EventDTO[]> {
	const query = new URLSearchParams({ babyId, deleted: '1' });
	return (await getJson<{ events: EventDTO[] }>(`/api/events?${query}`)).events;
}

export async function createEvent(input: CreateEventInput): Promise<EventDTO> {
	return sendJson<EventDTO>('POST', '/api/events', input);
}

export async function patchEvent(id: string, patch: PatchEventInput): Promise<EventDTO> {
	return sendJson<EventDTO>('PATCH', `/api/events/${id}`, patch);
}

export async function deleteEvent(id: string): Promise<EventDTO> {
	return sendJson<EventDTO>('DELETE', `/api/events/${id}`);
}

export async function restoreEvent(id: string): Promise<EventDTO> {
	return sendJson<EventDTO>('POST', `/api/events/${id}/restore`);
}

export async function getTimers(
	babyId: string
): Promise<{ serverTime: string; timers: EventDTO[] }> {
	return getJson(`/api/timers?babyId=${encodeURIComponent(babyId)}`);
}

export async function startTimer(
	type: TimerType,
	body: StartTimerBody
): Promise<{ created: boolean; event: EventDTO }> {
	return sendJson(`POST`, `/api/timers/${type}/start`, body);
}

export async function stopTimer(type: TimerType, body: StopTimerBody): Promise<EventDTO> {
	return sendJson<EventDTO>('POST', `/api/timers/${type}/stop`, body);
}

export async function nursingAction(body: NursingActionBody): Promise<EventDTO> {
	return sendJson<EventDTO>('POST', '/api/timers/nursing/action', body);
}
