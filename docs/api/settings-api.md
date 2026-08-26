# API des réglages — contrat (slice 5)

Complète `docs/api/events-api.md` : même enveloppe d'erreur
`{ error: { code, message, issues? } }`, mêmes horodatages ISO 8601 UTC.
Codes d'erreur additionnels : `in_use` (409, aidant référencé par un
événement), `forbidden` (403, code PIN actuel manquant ou incorrect),
`pin_required` (401, appel API sans session PIN valide — posé par
`hooks.server.ts`, jamais par une route elle-même).

## HouseholdDTO

```ts
{ volumeUnit: 'ml' | 'oz'; theme: 'light' | 'dark' | 'auto'; pinEnabled: boolean }
```

Ligne singleton (`id = 1`), créée paresseusement au premier accès
(`ensureHousehold`) avec les valeurs par défaut `volumeUnit: 'ml'`,
`theme: 'auto'`.

## CaregiverDTO

```ts
{ id: string; name: string; color: string } // color: /^#[0-9a-fA-F]{6}$/
```

## Bébés et aidants

### `POST /api/babies`

Corps : `{ name (1–100 caractères), birthdate (YYYY-MM-DD, pas dans le
futur), timezone? }`. `timezone` par défaut le fuseau du serveur
(`Intl.DateTimeFormat().resolvedOptions().timeZone`).

→ `201 BabyDTO` · `400 validation_failed`.

### `GET /api/caregivers`

→ `200 { caregivers: CaregiverDTO[] }`.

### `POST /api/caregivers`

Corps : `{ name (1–100), color }`.

→ `201 CaregiverDTO` · `400 validation_failed`.

### `PATCH /api/caregivers/[id]`

Corps (champs optionnels, inconnus rejetés) : `{ name?, color? }`.

→ `200 CaregiverDTO` · `400 validation_failed` · `404 not_found`.

### `DELETE /api/caregivers/[id]`

Refusée si l'aidant est référencé par un événement (peu importe qu'il soit
supprimé en douceur ou non).

→ `204` · `404 not_found` · `409 in_use`.

## Réglages du foyer

### `GET /api/household`

→ `200 HouseholdDTO` (crée la ligne si elle n'existe pas encore).

### `PATCH /api/household`

Corps (champs optionnels, inconnus rejetés) : `{ volumeUnit?, theme? }`.

→ `200 HouseholdDTO` · `400 validation_failed`.

## Code PIN et session (FR-015, DEC-003)

Le cookie de session (`swaddle_session`, `httpOnly`, `sameSite: 'lax'`,
`path: '/'`, 1 an) est un HMAC-SHA256 du message fixe `'swaddle-session-v1'`
dont la clé est le `pin_hash` courant : changer ou désactiver le code PIN
invalide donc automatiquement toutes les sessions existantes. Le hash lui-même
est `scrypt(pin, sel 16 octets)`, stocké en hex `sel:hash` dans
`household.pin_hash`. Sans le code, la seule réinitialisation possible est la
procédure serveur documentée dans `docs/runbooks/pin-reset.md`.

### `PUT /api/household/pin`

Définit ou change le code. Corps : `{ pin (4–8 chiffres), currentPin? }`.
Si un code existe déjà, `currentPin` doit le vérifier, sinon `403 forbidden`.
En cas de succès, une nouvelle session est posée immédiatement (l'appareil qui
définit/change le code reste connecté).

→ `200 { ok: true }` · `400 validation_failed` · `403 forbidden`.

### `DELETE /api/household/pin`

Désactive le code. Corps : `{ currentPin }` (vérifié si un code est actif).
Efface le hash et le cookie de session.

→ `200 { ok: true }` · `400 validation_failed` · `403 forbidden`.

### `POST /api/auth/pin`

Déverrouille l'appareil courant. Corps : `{ pin }`.

→ `200 { ok: true }` (pose le cookie de session) · `403 forbidden` (code
incorrect ou aucun code actif — dans ce dernier cas l'appel n'a pas lieu
d'être, l'app est ouverte).

## Export, sauvegarde et restauration (FR-014)

### `GET /api/export/json`

Export versionné complet, y compris les événements supprimés en douceur
(`deletedAt` conservé) pour que la restauration soit sans perte.

```ts
{
  format: 'swaddle-export';
  version: 1;
  exportedAt: string;
  household: { volumeUnit: 'ml' | 'oz'; theme: 'light' | 'dark' | 'auto' };
  babies: BabyDTO[];
  caregivers: CaregiverDTO[];
  events: EventDTO[];
}
```

→ `200` avec `content-disposition: attachment;
filename="swaddle-export-<date>.json"`.

### `GET /api/export/csv`

Événements à plat (y compris supprimés en douceur), une ligne par événement,
en-tête `id,babyId,caregiverId,type,startedAt,endedAt,note,details,createdAt,
updatedAt,deletedAt`, quoting RFC 4180 strict : séparateur d'enregistrement
CRLF (pas un simple `\n`), champ entre guillemets dès qu'il contient une
virgule, un guillemet, ou un retour chariot/saut de ligne (`\r` seul inclus),
`"` doublé à l'intérieur d'un champ cité. `details` en JSON.

→ `200 text/csv; charset=utf-8`, `content-disposition: attachment`.

### `GET /api/backup`

Télécharge un instantané SQLite cohérent, produit par `VACUUM INTO` (jamais
une copie à chaud du fichier — RISK-002) dans
`DATA_DIR/backups/backup-<date ISO, ':' remplacés par '-'>.sqlite`. Une fois
l'instantané écrit, seuls les 10 fichiers `backup-*.sqlite` les plus récents
sont conservés — les plus anciens sont supprimés (#57). L'échec de cet élagage
n'affecte jamais la sauvegarde qui vient d'être créée ni ne supprime les
instantanés déjà conservés.

→ `200 application/octet-stream`, `content-disposition: attachment`.

### `POST /api/restore`

Corps : un export JSON tel que produit par `GET /api/export/json` (restaurer
un instantané SQLite brut est une opération manuelle côté serveur, pas un
point d'entrée web — cela garde l'échange de fichier de base de données hors
de la surface exposée). Un instantané automatique de l'état courant est
toujours pris en premier (`VACUUM INTO`,
`DATA_DIR/backups/pre-restore-<date ISO>.sqlite`), avant de vider et
réimporter les données en une seule transaction. Comme pour `/api/backup`,
seuls les 10 fichiers `pre-restore-*.sqlite` les plus récents sont conservés
juste après cet instantané, avant que le remplacement des données ne se
poursuive (#57). En cas de payload invalide, rien n'est écrit (ni l'instantané
préalable n'est perdu : il reste sur disque même si la restauration échoue
ensuite).

Taille : le corps est borné à 10 Mo (`MAX_BODY_BYTES`, `src/lib/limits.ts`).
Au-delà, la requête est refusée **avant** l'instantané et avant tout parsing —
sur le `content-length` annoncé, ou en cours de flux par l'adaptateur
(`BODY_SIZE_LIMIT=10M`, déclaré dans le `Dockerfile`, `deploy/docker-compose.yml`
et par défaut dans `server.js`). Un export volumineux mais valide n'est donc
jamais signalé comme JSON invalide (#45).

→ `200 { restored: { babies: number; caregivers: number; events: number };
snapshot: string }` · `400 validation_failed` · `413 payload_too_large`.

`413 payload_too_large` s'applique en réalité à toute route `/api` qui lit un
corps JSON ; seule la restauration peut l'atteindre en pratique.

## Portes serveur — `hooks.server.ts` (FR-015, FR-016)

Deux portes s'appliquent à chaque requête, **le code PIN évalué en premier** :

1. **Code PIN** : si un code est actif et qu'aucune session valide n'est
   présente, les pages sont redirigées vers `/pin` (303) ; les appels API
   reçoivent `401 pin_required` (FR-015 : le code protège l'ensemble de
   l'application, y compris l'API) — sauf `/pin` lui-même et
   `POST /api/auth/pin`, toujours accessibles pour que le déverrouillage soit
   possible.
2. **Configuration** : tant qu'aucun bébé et aucun aidant n'existent, les
   pages sont redirigées vers `/setup` (303) — sauf `/setup` lui-même et les
   routes API dont l'assistant a besoin (`/api/babies`, `/api/caregivers`,
   `/api/household`). Cette porte ne bloque **jamais** `/api/*` : les autres
   appels API restent disponibles même avant la fin de la configuration.

Le code PIN passe avant la configuration : sinon, un appel API pourrait
contourner la protection PIN dès que la configuration est également
incomplète (la porte configuration ne bloque jamais `/api/*`), et les pages
boucleraient (`/setup` → `/pin` → `/setup` → …) puisqu'aucune des deux portes
ne reconnaît le chemin d'exemption de l'autre.

`/api/health` reste **volontairement public** (`ALWAYS_OK_EXACT` dans
`gate.ts`, correspondance exacte) : le healthcheck Docker et la CI l'appellent
sans session, et il ne renvoie aucune donnée sensible. Les ressources
`/_app/*` (préfixe, seule exception à la correspondance exacte) et
`/favicon.ico` sont également toujours accessibles.

## Informations du serveur

### `GET /api/server-info`

Bloc « Ce serveur » de l'écran Réglages. Derrière la porte PIN, comme le reste
de l'API.

```json
{
	"address": "192.168.1.20:3000",
	"connectedDevices": 2,
	"lastBackupAt": "2026-08-24T09:12:31.000Z"
}
```

- `address` — l'hôte de la requête (`url.host`), donc l'adresse par laquelle
  l'appareil joint réellement le serveur (sans protocole : derrière un serveur
  non-TLS, le protocole vu par le SSR n'est pas fiable).
- `connectedDevices` — nombre de flux SSE ouverts (`/api/stream`). Deux
  onglets comptent pour deux « appareils » : c'est un ordre de grandeur, pas
  un inventaire.
- `lastBackupAt` — `mtime` du plus récent instantané `*.sqlite` sous
  `DATA_DIR/backups`, ou `null` si aucune sauvegarde n'a jamais été prise.

→ `200` toujours (les champs dégradent en `null`/`0`, jamais d'erreur métier).
