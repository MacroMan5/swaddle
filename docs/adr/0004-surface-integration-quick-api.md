# 0004 — Surface d'intégration : tokens API et endpoint quick

- **Date** : 2026-08-26
- **Statut** : proposée

## Contexte

La saisie des événements (biberon, couche, sommeil, tétée) passe aujourd'hui
uniquement par l'UI web, derrière une session PIN par cookie. L'objectif est
une saisie sans friction — par la voix ou via un assistant IA — sans
manipulation du téléphone au-delà d'une phrase.

La recherche (`docs/research/2026-08-26-integrations-voix-ia.md`) établit que :

- les Raccourcis iOS savent faire un POST JSON et se déclencher par
  « Hey Siri, <nom du raccourci> » sans app native ;
- Google Assistant/Home est une impasse pour du self-host LAN-only
  (Conversational Actions arrêtées en juin 2023, Gemini for Home 100 % cloud) ;
- Home Assistant (`rest_command` + Assist) et un serveur MCP sont des surfaces
  futures crédibles, à condition d'avoir une authentification par token et un
  point d'entrée simple ;
- quatre pistes sur cinq dépendent d'un même socle : un token d'API porteur
  (Bearer), absent aujourd'hui.

## Décision

1. **Tokens API nommés** : table `api_token` (migration v3), tokens
   `swd_<32 octets aléatoires base64url>`, stockés hachés en SHA-256 (entropie
   forte, pas un secret humain — scrypt reste réservé au PIN), liés à un
   aidant optionnel, révocables, gérés dans `/settings`. La porte
   (`gateDecision`) accepte `Authorization: Bearer …` comme alternative à la
   session PIN **pour `/api/*` uniquement** — jamais pour les pages.
2. **Module `quick`** (`src/lib/server/quick/`) : une fonction
   `performQuick(db, intent, ctx)` derrière un vocabulaire d'intentions zod
   (`bottle`, `diaper`, `sleep`, `nursing`, `phrase`), avec sémantique de
   **bascule** pour les minuteurs (sommeil/tétée) et réponse `speech` en
   français lisible par Siri. La route `POST /api/quick` en est le premier
   adaptateur ; Home Assistant (`rest_command`) et une future route MCP
   consomment la même couture sans redesign.
3. **Vocabulaire configurable côté serveur** : l'intention `phrase` parse une
   dictée libre (« néné droite », « biberon 120 ») contre une table de mots
   configurée par l'utilisateur dans `/settings` (mots par défaut fournis).
   Un seul raccourci Siri générique suffit ; ajouter un synonyme ne touche
   aucun téléphone.

Google Home est écarté. MCP et Home Assistant sont des tranches futures
s'appuyant sur cette surface, pas des objectifs de cette décision.

## Conséquences

- Un secret longue durée circule en HTTP clair sur le LAN (même posture que le
  cookie de session, ADR 0001) ; la révocation par token nommé limite le rayon
  d'une fuite à un appareil.
- La logique métier de saisie rapide (bascule, résolution du bébé, phrases
  françaises) vit en un seul endroit côté serveur ; les clients (raccourcis,
  `rest_command`, outils MCP) restent des adaptateurs bêtes.
- Le contrat `/api/quick` devient une surface publique de plus à documenter et
  à maintenir (`docs/api/`), avec ses tests.
- La table de vocabulaire introduit de l'état de configuration en base
  (migration v3, valeurs par défaut semées) inclus dans l'export/restauration.
- Le comportement des Raccourcis en HTTP-sur-LAN et téléphone verrouillé n'est
  pas documenté par Apple : validation manuelle requise avant de finaliser le
  guide.
