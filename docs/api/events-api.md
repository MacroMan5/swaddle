# API des événements — contrat (slice 2)

Voir aussi `docs/api/settings-api.md` (slice 5) pour les réglages, le code
PIN, l'export/restauration et les portes serveur.

Tous les horodatages sont des chaînes ISO 8601 UTC. L'heure du serveur fait foi
(RISK-001) : les clients calculent l'affichage des minuteurs à partir de
`startedAt` et du dernier `serverTime`, borné à ≥ 0. Toutes les erreurs utilisent
l'enveloppe `{ error: { code, message, issues? } }`.

Codes d'erreur : `validation_failed` (400), `not_found` / `no_active_timer` /
`unknown_timer_type` (404), `invalid_state` / `timer_conflict` (409).
`issues` est un tableau de `{ path, code, message }` (échecs de validation
uniquement). Un corps JSON malformé, comme un `babyId` ou un `caregiverId`
inconnu, renvoie lui aussi `400 validation_failed` — jamais une erreur SQLite
brute.

## En-têtes de sécurité (toutes les réponses)

Posés par `hooks.server.ts` (`src/lib/server/securityHeaders.ts`) sur tout ce
que l'application sert — pages, JSON, SSE, téléchargements :
`x-content-type-options: nosniff`, `referrer-policy: same-origin`,
`x-frame-options: DENY`, `cross-origin-opener-policy: same-origin`,
`cross-origin-resource-policy: same-origin`, et `cache-control: no-store`
sauf si la réponse a déjà choisi sa politique (`/api/stream` garde
`no-cache`). Les assets immuables `/_app/immutable/` sont servis par
adapter-node avant le hook et conservent leur cache long.

Les pages HTML portent en plus une `content-security-policy` same-origin
(configurée dans `vite.config.ts`) : `script-src 'self' 'nonce-…'` — le nonce
par requête couvre l'amorce de thème inline de `src/app.html` —,
`style-src 'self' 'unsafe-inline'` (attributs `style` du SSR et `<style>` des
transitions Svelte), `frame-ancestors 'none'`, `object-src 'none'`,
`connect-src 'self'` (SSE compris).

## EventDTO

```ts
{
  id: string;
  babyId: string;
  caregiverId: string | null;
  type: 'nursing' | 'bottle' | 'pump' | 'diaper' | 'sleep';
  startedAt: string;
  endedAt: string | null;   // null = événement ponctuel, ou minuteur en cours
  note: string | null;
  details: Details;         // par type, ci-dessous
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null; // suppression douce (FR-007)
}
```

### `details` par type

| Type | Forme |
|---|---|
| `nursing` | `{ segments: { side: 'left' \| 'right'; startedAt: string; endedAt: string \| null }[] }` |
| `bottle` | `{ milkType: 'breast' \| 'formula' \| 'mixed'; volumeMl: number }` |
| `pump` | `{ side: 'left' \| 'right' \| 'both'; volumeMl: number \| null }` |
| `diaper` | `{ pee: boolean; poo: boolean }` — au moins l'un des deux à `true` |
| `sleep` | `{}` |

### Validation (FR-017)

- `volumeMl` ∈ [1, 1000] ml (`details` d'un biberon, charge utile d'arrêt d'un tire-lait).
- `endedAt >= startedAt`.
- Aucun horodatage à plus de 5 minutes dans le futur (`MAX_FUTURE_MS`).
- `details` doit correspondre au type de l'événement.
- Les types à minuteur (`nursing`, `pump`, `sleep`) exigent `endedAt` sur
  `POST /api/events` (les sessions en cours passent par `/api/timers`) ; les
  types ponctuels (`bottle`, `diaper`) ne doivent pas porter d'`endedAt`.

Règles dépendant de l'état d'achèvement, appliquées à la création comme à la
modification :

- **Segments d'allaitement** : au moins un segment ; `endedAt >= startedAt` pour
  chaque segment fermé ; seul le dernier segment peut être ouvert (donc jamais
  plusieurs segments ouverts) ; une session terminée ne peut conserver aucun
  segment ouvert.
- **Volume du tire-lait (FR-004)** : le volume est saisi à la fin, donc
  `volumeMl` est obligatoire dès que `endedAt` est renseigné ; `null` n'est
  toléré que tant que le minuteur tourne.

### Modèle de pause de l'allaitement (DEC-001)

Un allaitement est **actif** tant que `endedAt === null`. Il est **en pause**
lorsqu'il est actif mais qu'aucun segment n'est ouvert (tous les segments ont un
`endedAt`). La durée effective est la somme des durées de segments : le temps de
pause est donc exclu par construction.

## Points d'entrée

### `GET /api/babies`

→ `200 { babies: { id, name, birthdate, timezone }[] }`

### `GET /api/events?babyId=&from=&to=&overlap=`

Événements non supprimés d'un bébé, `startedAt` décroissant. `from` est inclusif,
`to` est exclusif. `babyId` est obligatoire.

Par défaut, la fenêtre est comparée à `startedAt` seul (un événement commencé
avant `from` n'apparaît pas, même s'il se termine dans la fenêtre). Avec
`overlap=1`, la fenêtre sélectionne les événements qui **chevauchent**
`[from, to)` — nécessaire pour l'historique (slice 4, AC-006) : un allaitement
ou sommeil 23 h 30→01 h 30 doit rester visible dans la vue du jour suivant même
s'il a commencé la veille. En mode chevauchement, un minuteur actif
(`endedAt: null` sur `nursing`/`pump`/`sleep`) est traité comme toujours en
cours et chevauche toute fenêtre à partir de son début ; les événements
ponctuels (`bottle`, `diaper`), qui ont toujours `endedAt: null` par nature,
continuent de suivre la règle « `startedAt` dans la fenêtre ».

→ `200 { events: EventDTO[] }` · `400 validation_failed` si `babyId` manque.

### `POST /api/events`

Corps : `{ babyId, caregiverId?, type, startedAt, endedAt?, note?, details }`.
Crée un événement terminé ou saisi manuellement.

→ `201 EventDTO` · `400 validation_failed` (avec `issues`).

### `GET /api/events/[id]`

Renvoie l'événement même s'il est supprimé en douceur (`deletedAt` renseigné).

→ `200 EventDTO` · `404 not_found`.

### `PATCH /api/events/[id]`

Corps (tous les champs optionnels, champs inconnus rejetés) :
`{ caregiverId, startedAt, endedAt, note, details }`. `endedAt: null` est rejeté —
rouvrir un minuteur terminé contournerait l'invariant d'unicité. La lecture, la
fusion, la validation (FR-017 et schéma `details` du type) et l'écriture ont lieu
dans une seule transaction : deux modifications concurrentes ne peuvent pas
valider contre la même ligne périmée.

→ `200 EventDTO` · `400 validation_failed` · `404 not_found`.

### `DELETE /api/events/[id]`

Suppression douce (idempotente) : la ligne reste en base avec `deletedAt`
renseigné et disparaît de `GET /api/events`.

→ `200 EventDTO` · `404 not_found`.

### `POST /api/events/[id]/restore`

Annule une suppression douce.

→ `200 EventDTO` · `404 not_found` · `409 timer_conflict` si l'événement restauré
est un minuteur actif et qu'un autre minuteur actif du même type existe désormais
pour ce bébé (les événements ponctuels sont exemptés).

## Minuteurs (FR-013)

Types à minuteur : `nursing`, `pump`, `sleep`. Au plus **un minuteur actif par
type et par bébé** ; les types différents coexistent. `bottle` et `diaper` sont
des événements ponctuels. Cette unicité est aussi garantie au niveau du schéma
par un index UNIQUE partiel sur `event (baby_id, type)` (migration v2, restreint
aux types à minuteur non terminés et non supprimés) : les gardes applicatives
restent la source des erreurs métier, l'index est le filet de dernier ressort.

### `GET /api/timers?babyId=`

→ `200 { serverTime: string, timers: EventDTO[] }` (reprise d'état, AC-005).
`babyId` est optionnel ; omis, la réponse couvre tous les bébés.

### `POST /api/timers/[type]/start`

Corps : `{ babyId, caregiverId?, side?, startedAt? }`. `side` vaut `left`/`right`
pour l'allaitement (ouvre le premier segment ; `both` est rejeté) et
`left`/`right`/`both` pour le tire-lait ; par défaut `left` (allaitement) /
`both` (tire-lait). `startedAt` vaut l'heure du serveur par défaut et ne peut
dépasser 5 minutes dans le futur.

La vérification puis l'insertion se font dans une transaction : un démarrage
concurrent ne crée jamais de doublon, il renvoie la session existante (AC-004).

→ `201 { created: true, event }` si une session a été créée ·
`200 { created: false, event }` si une session tournait déjà ·
`400 validation_failed` · `404 unknown_timer_type`.

### `POST /api/timers/[type]/stop`

Corps : `{ babyId, endedAt?, volumeMl? }`. `endedAt` vaut l'heure du serveur par
défaut. `volumeMl` ∈ [1, 1000] et devient **obligatoire** pour un tire-lait
(FR-004). L'arrêt d'un allaitement ferme son segment ouvert à `endedAt`.

L'événement fusionné est revalidé avant écriture : un `endedAt` antérieur au
`startedAt` de la session est refusé et rien n'est persisté (la session reste
ouverte).

→ `200 EventDTO` · `400 validation_failed` · `404 no_active_timer` /
`unknown_timer_type`.

### `POST /api/timers/nursing/action`

Corps : `{ babyId, action: 'pause' | 'resume' | 'switch-side', side? }`.

- `pause` — ferme le segment ouvert ; l'événement reste actif.
- `resume` — ouvre un nouveau segment sur `side`, par défaut le dernier côté utilisé.
- `switch-side` — ferme le segment ouvert (s'il y en a un) et ouvre `side` ;
  sans `side`, le côté opposé au dernier segment. Avec un `side` explicite,
  l'action est idempotente : si ce côté tourne déjà (un autre appareil a
  basculé entre-temps), la session est renvoyée inchangée au lieu d'être
  rebasculée — indispensable en multi-appareils.

→ `200 EventDTO` · `400 validation_failed` · `404 no_active_timer` ·
`409 invalid_state` (pause alors que déjà en pause, reprise alors que la session
tourne, session sans aucun segment).

## SSE — `GET /api/stream`

`content-type: text/event-stream`. Deux événements nommés :

```
event: snapshot
data: { "serverTime": "…", "activeTimers": EventDTO[] }

event: sync
data: { "kind": "created" | "updated" | "deleted" | "restored", "event": EventDTO, "serverTime": "…" }

event: reset
data: { "serverTime": "…" }
```

- `snapshot` est envoyé une fois à la connexion — une reconnexion produit un
  nouveau snapshot (reprise d'état, FR-012) ; les clients rechargent
  `/api/events` pour l'état des listes.
- `sync` est diffusé à chaque mutation : création, modification, suppression et
  restauration d'événement, démarrage et arrêt de minuteur, actions
  d'allaitement.
- `reset` est diffusé à la fin d'une restauration réussie (slice 5,
  `POST /api/restore`) : une restauration remplace tout le jeu de données sous
  les clients connectés, sans qu'un `EventDTO` unique puisse décrire le
  changement. Les clients doivent recharger `/api/timers` **et**
  `/api/events` — pas seulement appliquer une synchronisation incrémentale.
- Un battement de cœur `:ping` (commentaire SSE) est envoyé toutes les 25 s pour
  maintenir la connexion.
