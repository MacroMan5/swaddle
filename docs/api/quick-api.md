# API de saisie rapide — contrat (`/api/quick`)

Complète `docs/api/events-api.md` : même enveloppe d'erreur
`{ error: { code, message, issues? } }`, mêmes horodatages ISO 8601 UTC, même
`EventDTO`. La surface est décidée par l'ADR 0004 et conçue pour des clients
« bêtes » : un raccourci Siri, un `rest_command` Home Assistant, un futur outil
MCP. Toute la logique (bascule des minuteurs, résolution du bébé, phrases
françaises) vit côté serveur, dans `src/lib/server/quick/`.

Code d'erreur additionnel : `ambiguous_baby` (409, le foyer ne compte pas
exactement un bébé et l'appel n'a pas dit lequel).

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
```

→ `200 { event: EventDTO, did: 'logged' | 'started' | 'stopped', speech: string }`
· `400 validation_failed` · `409 ambiguous_baby` · `401 pin_required`.

### Effets

| Intention | Effet | `did` |
|---|---|---|
| `bottle` | événement ponctuel (`endedAt` null, comme toute saisie ponctuelle) ; `details = { milkType: 'breast', volumeMl }` | `logged` |
| `diaper` | événement ponctuel ; `kind` devient `details = { pee, poo }` (`wet` → pipi seul, `dirty` → caca seul, `both` → les deux) | `logged` |
| `sleep` | **bascule** : minuteur `sleep` actif → arrêt, sinon démarrage | `stopped` / `started` |
| `nursing` | **bascule** ; au démarrage, `side` explicite, sinon l'opposé du dernier côté connu du bébé (`left` si aucune tétée enregistrée) | `stopped` / `started` |

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

## Hors périmètre

L'intention `phrase` (dictée libre parsée contre un vocabulaire configurable,
ADR 0004 § 3) et les routes `/api/quick/words` arrivent dans une tranche
ultérieure ; l'union d'intentions est faite pour les accueillir sans changer
ce contrat.
