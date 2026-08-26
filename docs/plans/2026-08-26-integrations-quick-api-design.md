# Surface d'intégration — tokens API, `/api/quick` et vocabulaire vocal

- **Date** : 2026-08-26
- **Statut** : design validé (ADR 0004) ; recherche source :
  `docs/research/2026-08-26-integrations-voix-ia.md`
- **Objectif** : enregistrer biberon / couche / sommeil / tétée par la voix
  (« Hey Siri, Swaddle » → dictée) ou par tout client HTTP, sans manipulation
  de l'UI. Première marche d'une surface qui servira aussi Home Assistant
  (`rest_command`) et un serveur MCP, sans redesign.

## Vue d'ensemble

```
Raccourci Siri ──┐
HA rest_command ─┤→ POST /api/quick ─┐          (adaptateurs minces)
curl / n8n ──────┘                    │
route MCP (futur) ────────────────────┤
                                      ▼
                    performQuick(db, intent, ctx)        ← module « quick »
                      │        │            │
                      │        │            └─ parsePhrase(text, words)  (pur)
                      ▼        ▼
            repo événements/minuteurs   publish() SSE  → UI « Aujourd'hui »
```

Deux modules serveur, une couture partagée :

- **`apiTokens`** — authentification Bearer, prérequis commun ;
- **`quick`** — traduction d'intentions simples vers le domaine existant,
  avec vocabulaire vocal configurable.

La route `/api/quick` est le premier adaptateur de la couture ; la route MCP
future en sera le deuxième. Home Assistant n'exige aucun code serveur
supplémentaire : son `rest_command` frappe le même endpoint.

## Module 1 — `apiTokens` (`src/lib/server/settings/apiTokens.ts`)

### Interface

```ts
createApiToken(db, { name, caregiverId? })
  → { plaintext: string, token: ApiTokenDTO }   // clair retourné UNE fois
verifyBearer(db, authorizationHeader: string | null)
  → { tokenId: string, caregiverId: string | null } | null
listApiTokens(db) → ApiTokenDTO[]               // jamais le clair ni le hash
revokeApiToken(db, id) → void
```

`ApiTokenDTO = { id, name, caregiverId, createdAt, lastUsedAt, revokedAt }`.

### Implémentation (cachée derrière l'interface)

- **Format** : `swd_` + 32 octets `crypto.randomBytes` en base64url. Le
  préfixe rend le token identifiable dans un scan de secrets.
- **Stockage** : SHA-256 du clair, hex. Contrairement au PIN (secret humain
  faible → scrypt), 256 bits d'entropie n'ont pas besoin d'un KDF coûteux, et
  `verifyBearer` tourne à chaque requête API. Comparaison timing-safe.
- **`verifyBearer`** cache : parsing du header (`Bearer <clair>`), hachage,
  recherche, rejet des révoqués, mise à jour de `last_used_at` (arrondie au
  jour pour éviter une écriture par requête).
- **Migration v3** :

```sql
CREATE TABLE api_token (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  caregiver_id  TEXT REFERENCES caregiver(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT
);
```

Pas de champ `scopes` : YAGNI tant qu'aucun besoin de token en lecture seule ;
une migration l'ajoutera si besoin.

### Couture à la porte

`gateDecision` reste **pure**. `src/hooks.server.ts` appelle `verifyBearer`
et passe le résultat :

- nouvelle entrée `hasBearerAuth: boolean` dans `gateDecision` ; un bearer
  valide vaut session PIN **pour `/api/*` seulement** — un token ne
  déverrouille jamais les pages ;
- le `caregiverId` du token est posé dans `event.locals` pour l'attribution
  des événements créés via l'API.

## Module 2 — `quick` (`src/lib/server/quick/`)

### Interface

```ts
performQuick(db, intent: QuickIntent, ctx: { caregiverId: string | null })
  → QuickResult

QuickIntent =                                   // union discriminée zod
  | { action: 'bottle';  volumeMl: number }
  | { action: 'diaper';  kind: 'wet' | 'dirty' | 'both' }
  | { action: 'sleep' }                          // bascule start/stop
  | { action: 'nursing'; side?: 'left' | 'right' }  // bascule
  | { action: 'phrase';  text: string }          // dictée libre

QuickResult = {
  event: EventDTO,
  did: 'logged' | 'started' | 'stopped',
  speech: string          // phrase française que Siri lit
}
```

### Comportement

| Intention | Effet | `speech` (exemples) |
|---|---|---|
| `bottle` | événement ponctuel (`startedAt = endedAt = now`), `details.volumeMl` | « Biberon 120 millilitres enregistré » |
| `diaper` | événement ponctuel, `details.kind` | « Couche pipi enregistrée » |
| `sleep` | minuteur actif ? `stopTimer` : `startTimer` | « Dodo démarré » / « Dodo terminé, 40 minutes » |
| `nursing` | bascule ; au démarrage, `side` explicite ou opposé du dernier côté connu | « Tétée côté droit démarrée » |
| `phrase` | `parsePhrase` → une des intentions ci-dessus, puis même traitement | selon l'intention résolue |

Ce que l'appelant obtient sans le connaître (profondeur du module) :

- **résolution du bébé** : foyer mono-bébé → aucun ID à fournir ; plusieurs
  bébés → `409 ambiguous_baby` avec `babyId?` optionnel en échappatoire ;
- **attribution** au `caregiverId` du token ;
- **bascule** des minuteurs, appuyée sur l'atomicité existante du repo
  (FR-013) — jamais de doublon, jamais de `timer_conflict` exposé ;
- **validation** FR-017 via le repo (les erreurs remontent en
  `validation_failed`) ;
- **publication SSE** (`publish`) : l'UI « Aujourd'hui » reflète la saisie
  vocale en direct, comme n'importe quelle écriture.

### `parsePhrase` (`src/lib/server/quick/phrase.ts`, fonction pure)

```ts
parsePhrase(text: string, words: QuickWord[])
  → QuickIntent (jamais 'phrase') | { error: 'unrecognized' | 'missing_volume' }
```

- Normalisation : minuscules, accents retirés, ponctuation ignorée.
- Correspondance du **mot déclencheur** contre le vocabulaire (mot entier,
  premier trouvé dans l'ordre du texte).
- Extraction des **modificateurs** fixes : nombre (`120`, `120 ml`) →
  `volumeMl` ; `gauche` / `droite` → `side`.
- `bottle` sans nombre → `missing_volume` ; aucun mot reconnu →
  `unrecognized`. Les deux produisent un `speech` d'erreur lisible par Siri
  (« Il me faut le volume du biberon », « Je n'ai pas compris “…” »).

Pure et synchrone : testable exhaustivement sans base ni horloge.

### Vocabulaire configurable (migration v3, même version que `api_token`)

```sql
CREATE TABLE quick_word (
  id      TEXT PRIMARY KEY,
  word    TEXT NOT NULL UNIQUE,       -- stocké normalisé (minuscules, sans accents)
  intent  TEXT NOT NULL               -- JSON : gabarit d'intention sans modificateurs
);
```

Semé à la migration avec les défauts français :
`biberon → bottle` · `pipi → diaper wet` · `caca → diaper dirty` ·
`couche → diaper both` · `dodo`/`sieste` → `sleep` ·
`tétée`/`téton`/`néné` → `nursing`. L'utilisateur ajoute, renomme ou supprime
des mots dans `/settings` ; ajouter « nini » ne touche aucun téléphone.
Les mots (config du foyer) entrent dans l'export/restauration comme les autres
tables.

## Contrats API (à consigner dans `docs/api/quick-api.md`)

Toutes ces routes exigent session PIN **ou** Bearer valide.

### `POST /api/quick`

Corps : `QuickIntent` (+ `babyId?` optionnel). →
`200 { event, did, speech }` ·
`400 validation_failed` · `409 ambiguous_baby` ·
`422 unrecognized_phrase | missing_volume` (avec `speech` d'erreur) ·
`401 pin_required` sans auth.

### Tokens — `/api/tokens`

- `POST /api/tokens` `{ name, caregiverId? }` → `201 { plaintext, token }`
  (seule réponse contenant le clair).
- `GET /api/tokens` → `200 ApiTokenDTO[]`.
- `DELETE /api/tokens/[id]` → révocation (`revoked_at`), `204`.

### Vocabulaire — `/api/quick/words`

- `GET` → liste ; `POST` `{ word, intent }` → `201` ;
  `DELETE /api/quick/words/[id]` → `204`.
- `409 duplicate_word` si le mot normalisé existe déjà.

## UI `/settings`

Deux sections nouvelles, dans les patrons existants de la page :

- **« Accès API »** : liste (nom, aidant lié, dernière utilisation), création
  via dialogue — le clair est affiché une seule fois avec bouton copier —,
  révocation avec confirmation.
- **« Mots vocaux »** : liste des mots par action, ajout d'un synonyme,
  suppression. Libellés français, mêmes tuiles/feuilles que le reste.

## Côté iPhone (guide `docs/guides/raccourcis-ios.md`)

Un raccourci générique **« Swaddle »** : « Hey Siri, Swaddle » → action
« Dicter le texte » → « Obtenir le contenu de l'URL » (POST
`http://swaddle.home/api/quick`, header `Authorization`, corps
`{ action: "phrase", text: <dictée> }`) → lire `speech` à voix haute.
Optionnel pour les gestes ultra-fréquents : raccourcis dédiés en un temps
(« Hey Siri, dodo » → `{ action: "sleep" }`).

**Validation manuelle préalable** (inconnues non documentées par Apple) :
HTTP-sur-LAN accepté par « Obtenir le contenu de l'URL » ? Fonctionnement
téléphone verrouillé ? À vérifier avec un raccourci de test avant de finaliser
le guide.

## Tests

- **`apiTokens`** : unitaires par l'interface (base en mémoire, comme
  `db.test.ts`) — création/format, `verifyBearer` (valide, révoqué, header
  malformé, clair inconnu), révocation.
- **`gateDecision`** : cas bearer — API ok, page refusée, bearer invalide.
- **`parsePhrase`** : table exhaustive — mots par défaut, synonymes, accents,
  nombre avec/sans « ml », côté, erreurs.
- **`performQuick`** : chaque action, bascules (démarrer puis arrêter),
  mono-bébé vs `ambiguous_baby`, attribution aidant, publication SSE (spy).
- **e2e** : un spec — créer un token via l'API, POST `/api/quick` biberon avec
  Bearer sans cookie → 200, l'événement apparaît dans `GET /api/events`.

## Découpage en tranches

1. **Socle tokens** : migration v3 (les deux tables), module `apiTokens`,
   porte, routes `/api/tokens`, section « Accès API » de `/settings`.
2. **Quick** : module `quick` + `parsePhrase`, route `/api/quick`, routes
   vocabulaire, section « Mots vocaux », `docs/api/quick-api.md`.
3. **Raccourcis** : validation manuelle HTTP-LAN/verrouillé, guide
   `docs/guides/raccourcis-ios.md`, recettes (générique + dédiés).

Tranches futures hors périmètre (mêmes coutures, zéro redesign) : Home
Assistant (`rest_command` + Assist), serveur MCP (`log_*`, `query_summary`).
Google Home : écarté (ADR 0004).
