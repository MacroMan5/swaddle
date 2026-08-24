# Events API — contract (slice 2)

All timestamps are ISO 8601 UTC strings. Server time is authoritative (RISK-001):
clients compute timer displays from `startedAt` and the latest `serverTime`,
clamped to ≥ 0. Every error uses the envelope `{ error: { code, message, issues? } }`.

Error codes: `validation_failed` (400), `not_found` / `no_active_timer` /
`unknown_timer_type` (404), `invalid_state` / `timer_conflict` (409).
`issues` is an array of `{ path, code, message }` (validation failures only).

## EventDTO

```ts
{
  id: string;
  babyId: string;
  caregiverId: string | null;
  type: 'nursing' | 'bottle' | 'pump' | 'diaper' | 'sleep';
  startedAt: string;
  endedAt: string | null;   // null = point event, or a timer still running
  note: string | null;
  details: Details;         // per-type, below
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null; // soft delete (FR-007)
}
```

### `details` per type

| Type | Shape |
|---|---|
| `nursing` | `{ segments: { side: 'left' \| 'right'; startedAt: string; endedAt: string \| null }[] }` |
| `bottle` | `{ milkType: 'breast' \| 'formula' \| 'mixed'; volumeMl: number }` |
| `pump` | `{ side: 'left' \| 'right' \| 'both'; volumeMl: number \| null }` |
| `diaper` | `{ pee: boolean; poo: boolean }` — at least one must be `true` |
| `sleep` | `{}` |

### Validation (FR-017)

- `volumeMl` ∈ [1, 1000] ml (bottle `details`, pump stop payload).
- `endedAt >= startedAt`.
- No timestamp more than 5 minutes in the future (`MAX_FUTURE_MS`).
- `details` must match the event type.
- Timer types (`nursing`, `pump`, `sleep`) require `endedAt` on `POST /api/events`
  (live sessions go through `/api/timers`); point types (`bottle`, `diaper`)
  must not carry an `endedAt`.

### Nursing pause model (DEC-001)

A nursing event is **active** while `endedAt === null`. It is **paused** when it
is active but no segment is open (every segment has an `endedAt`). Effective
duration = sum of segment durations, so paused time is excluded by construction.

## Endpoints

### `GET /api/babies`

→ `200 { babies: { id, name, birthdate, timezone }[] }`

### `GET /api/events?babyId=&from=&to=`

Non-deleted events for a baby, `startedAt` DESC. `from` is inclusive, `to` is
exclusive, both compared against `startedAt`. `babyId` is required.

→ `200 { events: EventDTO[] }` · `400 validation_failed` when `babyId` is missing.

### `POST /api/events`

Body: `{ babyId, caregiverId?, type, startedAt, endedAt?, note?, details }`.
Creates a completed or manual event.

→ `201 EventDTO` · `400 validation_failed` (with `issues`).

### `GET /api/events/[id]`

Returns the event even if soft-deleted (`deletedAt` set).

→ `200 EventDTO` · `404 not_found`.

### `PATCH /api/events/[id]`

Body (all optional, unknown fields rejected): `{ caregiverId, startedAt, endedAt, note, details }`.
`endedAt: null` is rejected — reopening a finished timer would bypass the
unique-timer invariant. The merged event is re-validated against FR-017 and the
per-type `details` schema.

→ `200 EventDTO` · `400 validation_failed` · `404 not_found`.

### `DELETE /api/events/[id]`

Soft delete (idempotent): the row stays in the DB with `deletedAt` set and
disappears from `GET /api/events`.

→ `200 EventDTO` · `404 not_found`.

### `POST /api/events/[id]/restore`

Undo a soft delete.

→ `200 EventDTO` · `404 not_found` · `409 timer_conflict` when the restored event
is an active timer and another active timer of the same type now exists for that
baby (point events are exempt).

## Timers (FR-013)

Timer types: `nursing`, `pump`, `sleep`. At most **one active timer per type per
baby**; different types coexist. `bottle` and `diaper` are point events.

### `GET /api/timers?babyId=`

→ `200 { serverTime: string, timers: EventDTO[] }` (AC-005 state recovery).
`babyId` is optional; omitted, it returns the active timers of every baby.

### `POST /api/timers/[type]/start`

Body: `{ babyId, caregiverId?, side?, startedAt? }`. `side` is `left`/`right` for
nursing (opens the first segment; `both` is rejected) and `left`/`right`/`both`
for pump; it defaults to `left` (nursing) / `both` (pump). `startedAt` defaults
to server time and must not be more than 5 minutes ahead.

Check-then-insert runs in a transaction, so a concurrent start never creates a
duplicate — it returns the existing session (AC-004).

→ `201 { created: true, event }` when a session was created ·
`200 { created: false, event }` when one was already running ·
`400 validation_failed` · `404 unknown_timer_type`.

### `POST /api/timers/[type]/stop`

Body: `{ babyId, endedAt?, volumeMl? }`. `endedAt` defaults to server time.
`volumeMl` ∈ [1, 1000] applies to pump. Stopping a nursing session closes its
open segment at `endedAt`.

→ `200 EventDTO` · `400 validation_failed` · `404 no_active_timer` /
`unknown_timer_type`.

### `POST /api/timers/nursing/action`

Body: `{ babyId, action: 'pause' | 'resume' | 'switch-side', side? }`.

- `pause` — closes the open segment; the event stays active.
- `resume` — opens a new segment on `side`, defaulting to the last side used.
- `switch-side` — closes the open segment (if any) and opens the other side.

→ `200 EventDTO` · `400 validation_failed` · `404 no_active_timer` ·
`409 invalid_state` (pause while paused, resume while running).

## SSE — `GET /api/stream`

`content-type: text/event-stream`. Two named events:

```
event: snapshot
data: { "serverTime": "…", "activeTimers": EventDTO[] }

event: sync
data: { "kind": "created" | "updated" | "deleted" | "restored", "event": EventDTO, "serverTime": "…" }
```

- `snapshot` is sent once on connect — reconnecting yields a fresh snapshot
  (FR-012 state recovery); clients refetch `/api/events` for list state.
- `sync` is broadcast on every mutation: event create/patch/delete/restore and
  timer start/stop/nursing action.
- A `:ping` comment heartbeat is sent every 25 s to keep the connection alive.
