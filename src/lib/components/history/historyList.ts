// Pure list-update helpers for the History day/week lists. Extracted so the
// direct-merge path (a confirmed HTTP response applied straight into the
// visible list — the slice-3 pattern, see EventEditSheet/ManualAddSheet) is
// unit-testable without a Svelte component harness. `+page.svelte` uses these
// to update `dayEvents`/`weekEvents` synchronously, independent of any
// refetch: a slow or racing background refetch must never be the only way a
// confirmed write becomes visible.
import type { EventDTO } from '$lib/client/types';

/** Insert-or-replace `event` by id. Used for create/update/restore responses. */
export function upsertById(list: EventDTO[], event: EventDTO): EventDTO[] {
	return [...list.filter((e) => e.id !== event.id), event];
}

/** Remove an id. Used for a confirmed delete, ahead of any refetch. */
export function removeById(list: EventDTO[], id: string): EventDTO[] {
	return list.filter((e) => e.id !== id);
}
