# API de saisie rapide — contrat (`/api/quick`)

Complète `docs/api/events-api.md` : même enveloppe d'erreur
`{ error: { code, message, issues? } }`, mêmes horodatages ISO 8601 UTC, même
`EventDTO`. La surface est décidée par l'ADR 0004 et conçue pour des clients
« bêtes » : un raccourci Siri, un `rest_command` Home Assistant, un futur outil
MCP. Toute la logique (bascule des minuteurs, résolution du bébé, phrases
françaises) vit côté serveur, dans `src/lib/server/quick/`.

Codes d'erreur additionnels : `ambiguous_baby` (409, le foyer ne compte pas
exactement un bébé et l'appel n'a pas dit lequel), `unrecognized_phrase` et
`missing_volume` (422, dictée non résolue), `duplicate_word` (409, mot de
vocabulaire déjà pris).

## Authentification

Comme tout `/api/*` : session PIN par cookie **ou**
`Authorization: Bearer swd_…` (voir `docs/api/settings-api.md` § Tokens API).
Sans l'une des deux, la porte (`hooks.server.ts`) répond `401 pin_required`
avant que la route ne soit atteinte.

## `POST /api/quick`

Corps : une **intention**, union discriminée sur `action`. Toutes acceptent un
`babyId` optionnel.

```ts
{ action: 'bottle';  volumeMl: number;               babyId?: string }  // entier, [1, 1000] ml
{ action: 'diaper';  kind: 'wet' | 'dirty' | 'both'; babyId?: string }
{ action: 'sleep';                                   babyId?: string }
{ action: 'nursing'; side?: 'left' | 'right';        babyId?: string }
{ action: 'phrase';  text: string;                   babyId?: string }  // 200 caractères max
```

→ `200 { event: EventDTO, did: 'logged' | 'started' | 'stopped', speech: string }`
· `400 validation_failed` · `409 ambiguous_baby` ·
`422 unrecognized_phrase | missing_volume` · `401 pin_required`.

### Effets

| Intention | Effet | `did` |
|---|---|---|
| `bottle` | événement ponctuel (`endedAt` null, comme toute saisie ponctuelle) ; `details = { milkType: 'breast', volumeMl }` | `logged` |
| `diaper` | événement ponctuel ; `kind` devient `details = { pee, poo }` (`wet` → pipi seul, `dirty` → caca seul, `both` → les deux) | `logged` |
| `sleep` | **bascule** : minuteur `sleep` actif → arrêt, sinon démarrage | `stopped` / `started` |
| `nursing` | **bascule** ; au démarrage, `side` explicite, sinon l'opposé du dernier côté connu du bébé (`left` si aucune tétée enregistrée) | `stopped` / `started` |
| `phrase` | résolue en l'une des intentions ci-dessus contre le vocabulaire du foyer, puis traitée à l'identique | selon l'intention résolue |

`milkType` n'est pas une donnée que la voix apporte : la saisie rapide écrit
`breast` (le défaut de la feuille « Biberon »), à corriger dans l'historique si
besoin.

La bascule est atomique : lecture du minuteur actif et écriture ont lieu dans
une même transaction, appuyée sur l'unicité du minuteur (FR-013). Un client ne
voit donc jamais `timer_conflict` ni `no_active_timer` sur cette surface.

Chaque écriture est publiée sur le bus SSE (`/api/stream`) : `created` pour une
saisie ponctuelle ou un démarrage, `updated` pour un arrêt. L'écran
« Aujourd'hui » ouvert sur un autre appareil reflète la saisie vocale en
direct.

### Résolution du bébé

Sans `babyId`, le module résout le bébé unique du foyer — un raccourci vocal
n'a aucun identifiant à connaître. Si le foyer compte plusieurs bébés (ou
aucun), la réponse est `409 ambiguous_baby` ; l'appelant recommence en passant
`babyId`.

### Attribution

L'événement est attribué à l'aidant lié au token porteur
(`caregiverId` du token, `null` si le token n'est lié à personne ou si l'appel
vient d'une session PIN). Le corps ne peut pas choisir l'aidant.

### Validation

La même que `POST /api/events` (FR-017) : l'intention est traduite en
`CreateEventInput` puis validée par le domaine. Un volume hors bornes, une
action inconnue ou un champ manquant renvoient `400 validation_failed` avec le
tableau `issues`.

### `speech`

Phrase française prête à être lue à voix haute par l'assistant. Exemples :

| Cas | `speech` |
|---|---|
| `bottle` 120 ml | `Biberon 120 millilitres enregistré` |
| `diaper` `wet` / `dirty` / `both` | `Couche pipi enregistrée` / `Couche caca enregistrée` / `Couche pipi et caca enregistrée` |
| `sleep` démarrage / arrêt | `Dodo démarré` / `Dodo terminé, 40 minutes` |
| `nursing` démarrage / arrêt | `Tétée côté droit démarrée` / `Tétée terminée, 12 minutes` |

Les durées sont arrondies à la minute : `moins d'une minute`, `12 minutes`,
`1 heure`, `2 heures 1 minute`.

La durée annoncée à l'arrêt d'une **tétée** est la durée effective (DEC-001) :
la somme des segments, pauses exclues — 10 min au sein gauche, 30 min de pause
puis 5 min à droite s'annoncent « 15 minutes », pas 45. Le **dodo**, lui, est
bien l'écart entre le début et la fin.

### Exemple

```sh
curl -X POST http://swaddle.home/api/quick \
  -H 'authorization: Bearer swd_…' \
  -H 'content-type: application/json' \
  -d '{"action":"sleep"}'
# {"event":{…},"did":"started","speech":"Dodo démarré"}
```

## L'intention `phrase`

Une dictée libre — « néné droite », « biberon 120 », « caca » — résolue côté
serveur contre le vocabulaire du foyer, puis exécutée comme l'intention
structurée qu'elle est devenue. Un seul raccourci Siri générique suffit donc,
et ajouter un synonyme ne touche aucun téléphone.

Le parsing (`src/lib/server/quick/phrase.ts`, fonction pure) :

1. **Normalisation** : minuscules, accents retirés, ponctuation ignorée
   (« Néné ! » → `nene`).
2. **Mot déclencheur** : le premier mot du vocabulaire rencontré **dans l'ordre
   du texte** (pas dans l'ordre du vocabulaire), en correspondance mot entier —
   « cacahuète » n'est pas « caca ». Il fixe l'action.
3. **Modificateurs**, fixes et non configurables : le premier nombre de la
   phrase (`120`, `120 ml`, `120 millilitres`) devient `volumeMl` ;
   `gauche` / `droite` (ou `droit`) devient `side`. Un modificateur sans objet
   est ignoré (« dodo gauche » reste un dodo).

Le vocabulaire est relu à chaque appel : un mot ajouté est reconnu à la dictée
suivante, sans cache ni redémarrage.

### Refus

| Cas | Réponse |
|---|---|
| « biberon » sans nombre | `422 missing_volume` |
| aucun mot du vocabulaire reconnu | `422 unrecognized_phrase` |

Les deux portent, **à la racine du corps**, un `speech` lisible par
l'assistant — un client vocal lit le même champ quel que soit le statut :

```json
{ "error": { "code": "missing_volume", "message": "…" },
  "speech": "Il me faut le volume du biberon" }
```

`unrecognized_phrase` répète ce qui a été entendu :
`Je n'ai pas compris “bonjour”`.

Un volume hors bornes FR-017 (« biberon 5000 ») reste un
`400 validation_failed`, comme la même intention envoyée structurée.

## Vocabulaire — `/api/quick/words`

Les mots sont stockés **normalisés** (minuscules, sans accents, un seul mot) :
« Néné » saisi dans les réglages et `nene` dicté sont la même entrée. Un mot
porte un gabarit d'intention **sans modificateur** — « biberon » veut dire « un
biberon », la quantité vient de la phrase ; tout champ en trop est ignoré.

- `GET /api/quick/words` → `200 { words: { id, word, intent }[] }`.
- `POST /api/quick/words` `{ word, intent }` → `201 { id, word, intent }` ·
  `400 validation_failed` (mot vide, deux mots, intention inconnue) ·
  `409 duplicate_word` si le mot normalisé est déjà pris.
- `DELETE /api/quick/words/[id]` → `204` · `404 not_found`.

`intent` prend l'une de ces formes : `{ action: 'bottle' }`,
`{ action: 'diaper', kind: 'wet' | 'dirty' | 'both' }`, `{ action: 'sleep' }`,
`{ action: 'nursing' }`.

Le vocabulaire est semé à la migration v3 (`biberon`, `pipi`, `caca`, `couche`,
`dodo`, `sieste`, `tetee`, `teton`, `nene`), s'édite dans « Mots vocaux » des
réglages, et suit l'export/restauration JSON comme le reste de la configuration
du foyer (`docs/api/settings-api.md`).

### Exemple

```sh
curl -X POST http://swaddle.home/api/quick \
  -H 'authorization: Bearer swd_…' \
  -H 'content-type: application/json' \
  -d '{"action":"phrase","text":"néné droite"}'
# {"event":{…},"did":"started","speech":"Tétée côté droit démarrée"}
```
