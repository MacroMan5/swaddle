# Intégrations voix / IA pour Swaddle : saisie sans friction

**Date :** 2026-08-26
**Question de recherche :** Quelles pistes d'intégration (voix ou assistant IA)
permettraient d'enregistrer un événement Swaddle (biberon, tétée, couche, sommeil)
sans ouvrir l'app et taper — et à quel coût d'implémentation côté serveur Swaddle ?

## Comment lire cette note

- **Sourced fact** : affirmation directement adossée à une source primaire (doc
  officielle, spec, code source first-party), citée en lien inline.
- **Constat Swaddle** : fait déjà vérifié sur le dépôt (rappelé en préambule de la
  mission, non re-vérifié ici).
- **Inference** : interprétation ou combinaison de faits sourcés.
- **Recommandation** : proposition d'ingénierie, pas un fait sourcé.

## Prérequis commun : Swaddle n'a aucun mécanisme de token aujourd'hui

**Constat Swaddle** (vérifié en préambule de mission, repris tel quel) : la porte
d'accès de `src/hooks.server.ts` / `src/lib/server/settings/gate.ts` exige un cookie
de session HMAC né du flux PIN web sur toute route `/api/*` sauf `/api/health` et
`/api/auth/pin`. Il n'existe **aucun** en-tête `Authorization: Bearer` vérifié nulle
part dans le code. C'est donc un prérequis structurel : Home Assistant, un Raccourci
iOS, ou un serveur MCP devront soit voler/rejouer le cookie de session (fragile, il
expire), soit qu'on ajoute un mécanisme de token complémentaire au cookie dans le
hook. Ce constat revient dans quatre des cinq pistes ci-dessous ; il est traité en
détail dans la piste 2.

---

## 1. Home Assistant

### `rest_command` : la façon la plus simple d'appeler une API REST externe

**Sourced fact :** l'intégration `rest_command` s'ajoute par `configuration.yaml`,
expose une action nommée (ex. `rest_command.example_request`) appelable depuis une
automatisation ou un script, avec `url` (template autorisé), `method`
(`get`/`post`/`put`/`delete`, défaut `get`), `payload` (template), authentification
HTTP basique, et un `timeout` par défaut de 10 s. La réponse (code, corps, en-têtes)
est accessible via `response_variable`.
[Home Assistant — RESTful Command](https://www.home-assistant.io/integrations/rest_command/)

**Inference :** pour Swaddle, `rest_command` est effectivement le chemin le plus
simple — un `POST` avec un `payload` JSON template vers `http://swaddle.home/api/events`
suffit, sans écrire d'intégration custom ni monter un broker MQTT. C'est strictement
plus simple qu'une intégration custom (nécessite Python, un manifest, publication ou
installation manuelle) ou que MQTT (nécessite un broker MQTT tournant en plus, et
Swaddle ne parle pas MQTT nativement). `rest_command` est donc la bonne primitive de
base pour toutes les pistes HA ci-dessous.

**Prérequis Swaddle :** une route acceptant `Authorization: Bearer <token>` (le
`payload` peut porter un en-tête custom si nécessaire) et joignable en HTTP simple
sur le LAN — déjà le cas (`swaddle.home`).

### Assist : phrases personnalisées + `intent_script` vers `rest_command`

**Sourced fact :** les phrases personnalisées vivent dans
`config/custom_sentences/<langue>/*.yaml`. La syntaxe autorise des slots nommés par
liste (`{nom_liste}`), des wildcards (`wildcard: true` sur une liste), des plages
numériques inline (`{0..1000:volume}` capture aussi bien "120" que "cent vingt") et
des éléments optionnels entre crochets. Le nom du slot dans la sentence peut différer
du nom de la liste via `{nom_liste:nom_slot}`.
[Home Assistant — Setting up custom sentences in configuration.yaml](https://www.home-assistant.io/voice_control/custom_sentences_yaml/),
[HA Developer Docs — Template sentence syntax](https://developers.home-assistant.io/docs/voice/intent-recognition/template-sentence-syntax/)

**Sourced fact :** `intent_script` définit, pour un nom d'intent donné, une `action`
(ex. appeler un service Home Assistant) et un `speech.text` de réponse ; les valeurs
de slot capturées sont exposées comme variables de template dans l'action et la
réponse. [Home Assistant — Intent Script](https://www.home-assistant.io/integrations/intent_script/)

**Inference — donc oui, « biberon 120 millilitres » est réalisable :** une sentence
`"[un] biberon [de] {0..1000:volume} (millilitres|ml)"` capture `volume=120`, un
`intent_script` nommé en conséquence peut ensuite appeler
`action: rest_command.swaddle_biberon` avec `data: { volume: "{{ volume }}" }`.
La documentation officielle consultée ne fournit **aucun exemple concret complet**
combinant un slot numérique de phrase personnalisée avec un appel `rest_command`
dans le même `intent_script` — la mécanique se déduit en combinant les deux pages
(slot → variable de template → `data` d'action), mais ce n'est pas un chemin
"documenté bout en bout" par une seule page HA ; à valider par un prototype avant de
s'y fier en production vocale.

**Prérequis Swaddle :** identiques à `rest_command` — un token Bearer stocké dans le
`payload`/en-têtes du `rest_command` HA, configuration YAML côté HA (pas de
changement Swaddle supplémentaire).

### Matériel voix : HA Voice Preview Edition, Wyoming, français

**Sourced fact :** le HA Voice Preview Edition est un appareil matériel dédié à
Assist, à 69 USD / 59 EUR, basé sur un SoC ESP32-S3 et une puce audio XMOS XU316 ;
il supporte plus de 60 langues réparties sur trois chemins de traitement : reconnaissance
locale limitée à des phrases prédéfinies (Speech-to-Phrase), reconnaissance locale
complète (Whisper, nécessite un matériel puissant type Intel N100+), ou Home Assistant
Cloud. [Home Assistant Voice Preview Edition](https://www.home-assistant.io/voice-pe/)

**Sourced fact :** le protocole Wyoming définit un jeu de messages standard pour
parler à des services de reconnaissance/synthèse vocale, streaming audio compris ; HA
peut se connecter à tout service STT/TTS compatible Wyoming.
[Home Assistant — Wyoming Protocol](https://www.home-assistant.io/integrations/wyoming/)

**Sourced fact — support FR confirmé :** Speech-to-Phrase (annoncé février 2025)
génère et affine automatiquement, 100 % localement, un modèle basé sur les appareils,
zones et phrases déclenchées configurées dans HA. Le lancement couvre l'anglais, le
français, l'allemand, le néerlandais, l'espagnol et l'italien (~70 % des utilisateurs
HA). Il transcrit en moins d'une seconde sur un Home Assistant Green ou un Raspberry
Pi 4 (contre au moins 5 s pour Whisper sur un Pi 4), mais reconnaît uniquement un jeu
de phrases pré-entraînées, pas de la parole libre.
[Home Assistant — Speech-to-Phrase brings voice home](https://www.home-assistant.io/blog/2025/02/13/voice-chapter-9-speech-to-phrase/)

**Inference :** pour Swaddle sur un Pi 4 (le même matériel que le déploiement de
production), Speech-to-Phrase est le chemin STT français réaliste — Whisper complet
en français local exigerait un matériel plus puissant que le Pi 4 déjà utilisé pour
héberger Swaddle. Speech-to-Phrase convient bien à des phrases fixes courtes
("biberon 120 millilitres") mais mal à de la parole libre ou variable ; c'est une
limite acceptable pour ce cas d'usage précis.

### App companion : Assist déclenchable par la voix, mais sans confirmation d'usage hors domicile

**Sourced fact :** l'app companion permet de lancer Assist via un raccourci Siri
("Hey Siri, Assist"), un widget écran d'accueil/verrouillage, ou une commande
personnalisée type "Okay Nabu" qui déclenche le raccourci Assist en app.
[Companion docs — Apple App Intents / Siri Shortcuts](https://companion.home-assistant.io/docs/integrations/siri-shortcuts/)

**Sourced fact :** la page officielle Assist sur Apple liste comme prérequis « avoir
un assistant configuré : soit cloud (recommandé, plus performant), soit local » —
sans trancher explicitement si le déclenchement vocal fonctionne hors du réseau
domicile. [Home Assistant — Assist on Apple devices](https://www.home-assistant.io/voice_control/apple/)

**Inference :** la doc officielle ne confirme ni n'infirme explicitement l'usage
d'Assist par la voix loin du domicile ; la mention « cloud recommandé, plus
performant » suggère que la voie cloud (Nabu Casa) est celle prévue pour un accès
distant fiable, ce qui impliquerait une inscription payante Nabu Casa — hors du
périmètre auto-hébergé/LAN-only actuel de Swaddle. **À vérifier manuellement** avant
de compter dessus.

---

## 2. API publique à tokens Bearer

Ce n'est pas une piste avec une doc officielle unique, mais une pratique
d'ingénierie appuyée sur des références faisant autorité.

**Sourced fact (transport) :** RFC 6750 spécifie que le client DOIT envoyer le jeton
via l'en-tête `Authorization: Bearer <token>` (méthode que tout serveur ressource DOIT
supporter), et que les jetons ne DEVRAIENT PAS transiter dans une URL/query string —
ils doivent passer par en-tête ou corps sous protection de confidentialité (TLS).
[RFC 6750 — OAuth 2.0 Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750.html)

**Sourced fact (bonnes pratiques REST) :** l'OWASP REST Security Cheat Sheet
recommande d'exiger une clé API sur chaque requête vers un endpoint protégé, de
répondre `429 Too Many Requests` en cas d'abus, de pouvoir révoquer une clé API en
cas de violation, et prévient que les clés API seules ne suffisent pas à protéger des
ressources sensibles ou critiques — et que des services REST sécurisés ne doivent
exposer que des endpoints HTTPS pour protéger les identifiants (mots de passe, clés
API, JWT) en transit.
[OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)

**Inference :** la cheat sheet REST consultée ne détaille pas explicitement le
hachage côté serveur (SHA-256 du token, jamais le clair) — cette pratique vient de
la convention générale de gestion de secrets (même logique que le hachage de mot de
passe), pas d'une ligne spécifique trouvée dans les sources primaires consultées ici.
Elle est néanmoins cohérente avec l'esprit "ne jamais stocker un secret en clair" et
largement répandue (GitHub, Stripe, etc. hachent leurs clés API côté serveur) — à
traiter comme bonne pratique de facto plutôt que comme exigence sourcée d'un texte
normatif précis.

**Recommandation minimale pour Swaddle :**
- Token opaque généré aléatoirement (pas un JWT — pas de besoin de claims
  auto-portées pour un usage mono-foyer), haché (SHA-256) et stocké haché en base ;
  jamais loggé en clair.
- Un scope simple suffit au départ (`write:events` par exemple), pas un système de
  scopes granulaires — sur-ingénierie pour une seule famille.
- Révocation : une table `api_tokens` avec `revoked_at` nullable, un endpoint
  Settings pour lister/révoquer.
- Vérification en plus du cookie de session dans `hooks.server.ts`, pas à la place :
  garder le flux PIN web intact.

**Ce que ça débloque immédiatement pour Swaddle une fois posé :** Raccourcis iOS
(`Get Contents of URL` avec en-tête `Authorization`), Tasker (Android), n8n (nœud
HTTP Request), un simple `curl`/tâche cron, et c'est le socle d'authentification que
Home Assistant `rest_command` et un futur serveur MCP réutiliseraient tous les deux.
C'est donc bien la marche structurante commune, pas une piste isolée.

---

## 3. Siri / iOS Shortcuts sans app native

**Sourced fact :** l'action « Obtenir le contenu d'une URL » (Get Contents of URL),
en méthode POST/PUT/PATCH, ajoute un paramètre « Corps de la requête » permettant
d'envoyer du JSON, un formulaire, ou un fichier, avec des valeurs saisies
manuellement ou via variables.
[Apple Support — Request your first API in Shortcuts](https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios)

**Constat de lacune documentaire :** la page officielle consultée sur cette action
**ne mentionne pas** explicitement d'exigence HTTPS, d'accès réseau local, ni le
comportement téléphone verrouillé — ces sujets ne sont simplement pas couverts par
cette page précise du guide Raccourcis.

**Sourced fact (mécanisme général iOS, pas spécifique à Shortcuts) :** App Transport
Security bloque par défaut le trafic non chiffré ; la clé `NSAllowsLocalNetworking`
(désactivée par défaut) permet, une fois activée dans l'`Info.plist` d'une app, de
désactiver ATS pour les connexions sur réseau local — un mécanisme pensé pour les
apps IoT qui parlent à du matériel local. Ce mécanisme concerne le développeur d'une
app tierce compilée avec Xcode, **pas** l'app Raccourcis elle-même (l'utilisateur ne
peut pas modifier l'`Info.plist` de l'app Raccourcis). Sources secondaires
(NowSecure, forums développeurs Apple) confirment le mécanisme général ; aucune page
support.apple.com/guide/shortcuts trouvée ne documente explicitement le comportement
HTTP-en-LAN de l'app Raccourcis elle-même.

**Inference :** en pratique, de nombreux utilisateurs rapportent (sources tierces,
non vérifiées ici comme primaires) que Raccourcis autorise du HTTP simple vers une
IP locale sans blocage ATS visible — cohérent avec le déploiement Swaddle actuel
(`http://<IP-LAN>`). Mais la doc officielle Apple consultée ne confirme ni
n'infirme ce point pour l'app Raccourcis spécifiquement ; **à vérifier manuellement**
sur un appareil réel avant de s'appuyer dessus en documentation utilisateur Swaddle.

**Déclenchement « Dis Siri » :** confirmé par les mêmes pages du guide Raccourcis
que tout raccourci peut être lancé par Siri en le nommant, ou via le widget
Aujourd'hui/écran verrouillé — mécanique standard de l'app Raccourcis, pas
spécifique à un appel réseau.

**Fonctionnement téléphone verrouillé :** non confirmé dans les sources consultées
ici — un raccourci lancé par Siri s'exécute typiquement sans déverrouiller l'écran
pour des actions simples, mais aucune page officielle explicite n'a été trouvée
statuant ce point pour une action réseau POST. **À vérifier manuellement.**

**Prérequis Swaddle :** identiques à la piste 2 — un token Bearer en en-tête du
raccourci, et HTTP simple sur LAN probablement acceptable (à confirmer par test réel
plutôt que par la doc, faute de page qui tranche explicitement le sujet).

---

## 4. Google Home / Google Assistant en 2026

**Sourced fact (mort confirmée) :** Google a officiellement mis fin (« sunset ») aux
Conversational Actions le 13 juin 2023, après une fenêtre de transition ouverte à
partir du 13 juin 2022 ; les actions conversationnelles sont désactivées depuis avec
un message vocal de notification à l'invocation.
[Google Developers — Conversational Actions sunset overview](https://developers.google.com/assistant/ca-sunset)

**Sourced fact :** Google redirige vers quatre voies restantes : App Actions
(désormais migré vers le site développeur Android, sorti de bêta), le développement
smart home via le nouveau Google Home Developer Console (device Matter), les
« Actions from web content » (intégrations via balisage Search), et les Media
Actions. [Google Developers — Conversational Actions sunset overview](https://developers.google.com/assistant/ca-sunset)

**Sourced fact (2025-2026, Gemini pour Home) :** l'annonce Google intègre Gemini aux
Home APIs — description IA de caméras, automatisations suggérées, création
d'automatisation en langage naturel (« Help me create »), nouveaux déclencheurs
météo/date. Statut : SDK Android et iOS en bêta développeur publique ; programme
d'accès anticipé annoncé pour « plus tard cette année » via la newsletter
développeur. L'écosystème d'appareils accessibles est passé de 600M à plus de 750M.
[Google Developers Blog — Bringing Gemini intelligence to Google Home APIs](https://developers.googleblog.com/en/bringing-gemini-intelligence-to-google-home-apis/)

**Constat de lacune documentaire :** ni la page Home APIs
([developers.home.google.com/apis](https://developers.home.google.com/apis)) ni
l'annonce Gemini ne mentionnent de support de webhook local self-hosted, d'exposition
de service LAN, ni de coût d'inscription développeur précis. Le Local Home SDK existe
toujours mais est positionné comme un **add-on** à une intégration Cloud-to-cloud
déjà existante (pas une voie d'entrée autonome) : « local execution is an add-on to
your Cloud-to-cloud integration, not a separate integration type ».
[Google Home Developers — Local Home SDK](https://developers.home.google.com/local-home)

**Inference :** en 2026, il n'existe pas de chemin officiel simple pour qu'une
Routine Google Home déclenche un webhook vers un service purement local sans passer
par une intégration Cloud-to-cloud (donc un backend cloud exposé publiquement, un
compte développeur Google, et une certification). La solution communément pratiquée
(sources tierces non primaires : forums, GitHub communautaires) passe par IFTTT
comme relais — router une phrase Google Assistant vers un Applet IFTTT, qui appelle
ensuite un webhook. Cela ajoute une dépendance à un service tiers cloud (IFTTT) et
sort du périmètre "aucune exposition Internet" du déploiement Swaddle actuel.

**Conclusion pour cette piste :** non réaliste pour Swaddle sans exposition Internet
ni compte développeur — à écarter tant que le déploiement reste LAN-only. À
reconsidérer seulement si Swaddle acceptait un jour une architecture cloud
relais (hors ADR actuels).

---

## 5. Serveur MCP (Model Context Protocol)

### Transports : Streamable HTTP vs stdio

**Sourced fact :** la spec MCP définit deux transports standard : stdio (messages
JSON-RPC délimités par des sauts de ligne sur les flux standard d'un sous-processus
lancé par le client) et Streamable HTTP (chaque message est un POST HTTP vers un
endpoint MCP unique ; les réponses arrivent en JSON ou en flux SSE délimité par la
requête). Les sémantiques du protocole sont identiques sur les deux transports — un
transport ne fait que définir le framing et la livraison des messages JSON-RPC.
[MCP Specification — Transports overview](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)

**Inference — faisabilité SvelteKit :** un serveur MCP Streamable HTTP est
exactement un endpoint HTTP qui accepte des POST JSON-RPC 2.0 et répond en JSON ou
SSE — ce que Swaddle sait déjà faire (`/api/stream` existe déjà en SSE). Implémenter
`+server.ts` sous `/api/mcp` qui parse le JSON-RPC (`initialize`, `tools/list`,
`tools/call`) et route vers les fonctions du domaine `events/repo.ts` est
architecturalement réaliste, sans dépendance à un framework MCP lourd — un simple
parseur JSON-RPC suffit pour un petit jeu d'outils (`log_feeding`, `log_diaper`,
`log_sleep`, `query_summary`).

### Authentification

**Sourced fact :** l'autorisation est **OPTIONNELLE** dans MCP. Quand elle est
supportée : les implémentations sur transport HTTP DEVRAIENT suivre la spec
d'autorisation OAuth 2.1 complète (serveur de ressources, découverte de serveur
d'autorisation via RFC 9728, PKCE, etc.) ; les implémentations sur stdio NE
DEVRAIENT PAS suivre cette spec et doivent plutôt récupérer les identifiants depuis
l'environnement ; les transports alternatifs DOIVENT suivre les bonnes pratiques de
sécurité établies pour leur protocole propre.
[MCP Specification — Authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization)

**Inference :** pour un serveur MCP purement local (un seul foyer, réseau privé),
OAuth 2.1 complet (serveur d'autorisation, découverte RFC 9728, PKCE, rotation de
jetons) est une charge disproportionnée. La spec elle-même autorise implicitement
une voie plus légère : soit exposer le serveur MCP en stdio (aucune couche HTTP,
identifiants pris dans l'environnement — donc pas de jeton réseau à protéger), soit,
si on choisit Streamable HTTP quand même, accepter qu'un header token simple (le même
Bearer token opaque de la piste 2) constitue une politique de sécurité "adaptée à ce
protocole", tant que le serveur MCP n'est jamais exposé au-delà du LAN. Ce choix
resterait une déviation du chemin recommandé "SHOULD" de la spec pour HTTP — à
documenter explicitement comme compromis assumé plutôt que comme conformité stricte.

### Cas d'usage réels et connectivité Claude

**Sourced fact (Claude Desktop, MCP local) :** Claude Desktop supporte l'installation
de serveurs MCP locaux via des « extensions desktop », des paquets installables en un
clic, avec un environnement Node.js intégré.
[Anthropic Help Center — Getting Started with Local MCP Servers on Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
La documentation consultée ne détaille pas explicitement le mécanisme stdio
sous-jacent ni la connectivité réseau locale — mais un serveur MCP local
conventionnel tourne en sous-processus sur la même machine que Claude Desktop et
peut, comme tout processus local, atteindre une IP du réseau local (`swaddle.home`).

**Sourced fact (connecteurs distants, exigence internet) :** les connecteurs
personnalisés via MCP distant sont disponibles sur Claude, Cowork et Claude Desktop
(plans Free à Enterprise) — **mais** « votre serveur MCP doit être joignable sur
l'internet public depuis les plages IP d'Anthropic. Les serveurs hébergés sur un
réseau d'entreprise privé, derrière un VPN, ou bloqués par un pare-feu ne se
connecteront pas », les connexions provenant de l'infrastructure cloud d'Anthropic
et non de l'appareil local même via Claude Desktop.
[Anthropic Help Center — Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
Le support mobile (iOS/Android) n'est pas explicitement mentionné dans cette page ;
la couverture documentée concerne Claude web, Cowork et Claude Desktop.

**Inference — conséquence structurante pour Swaddle :**
- Un serveur MCP **distant** (Streamable HTTP joignable par le cloud Anthropic) est
  **incompatible** avec le déploiement LAN-only actuel de Swaddle : il faudrait
  exposer `swaddle.home` sur Internet, exactement ce que le projet évite
  aujourd'hui (cf. ADR et périmètre self-host).
- Un serveur MCP **local** (stdio ou Streamable HTTP appelé en `localhost`/LAN
  depuis un Claude Desktop qui tourne physiquement sur le même réseau) reste
  cohérent avec le périmètre auto-hébergé, mais exige que le parent utilise
  Claude Desktop sur un ordinateur du foyer — pas Claude mobile en déplacement.
  C'est donc une piste "à la maison, devant un ordinateur", pas "n'importe où,
  au téléphone" comme pourrait le laisser espérer l'énoncé de la mission.

**Cas d'usage réels si ce compromis est accepté :** "note un biberon de 120ml" ou
"combien de biberons aujourd'hui ?" en langage naturel depuis Claude Desktop, en
utilisant les outils `log_feeding`/`query_summary` exposés par la route MCP de
Swaddle — mais uniquement depuis un poste du réseau domestique, pas en mobilité.

---

## Tableau de classement simplicité / valeur

| Piste | Simplicité d'implémentation | Valeur pour l'usage quotidien | Dépend de |
| --- | --- | --- | --- |
| 2. Token Bearer | Élevée — une table, un hash, un check dans le hook | Modérée seule (débloque tout le reste) | Rien — c'est le socle |
| 3. Raccourcis iOS / Siri | Élevée — aucune infra Swaddle nouvelle | Élevée — dictée vocale, un tap, appareil déjà en poche | Piste 2 |
| 1. Home Assistant (`rest_command` + Assist) | Modérée — YAML HA + STT français via Speech-to-Phrase | Élevée si un foyer a déjà HA/matériel voix | Piste 2 ; matériel voix HA optionnel |
| 5. Serveur MCP | Modérée-élevée — nouvel endpoint JSON-RPC, mais utile uniquement en Claude Desktop LAN | Modérée — langage naturel riche, mais scindé "à la maison seulement" | Piste 2 |
| 4. Google Home / Gemini for Home | Faible — nécessite compte développeur, intégration Cloud-to-cloud, exposition Internet | Incertaine — pas de chemin local documenté en 2026 | Écarter tant que LAN-only |

## Dépendances entre pistes

Le token Bearer (piste 2) est effectivement le socle commun : les pistes 1, 3 et 5
en ont toutes besoin dès qu'elles appellent l'API Swaddle depuis l'extérieur du
navigateur de session. Sans lui, chacune devrait improviser un contournement fragile
(rejouer le cookie de session, qui expire et n'est pas fait pour un usage machine).
La piste 4 est indépendante des autres, mais aussi la moins viable dans le périmètre
actuel — elle n'a pas de dépendance utile à débloquer.

## Recommandation : première marche

**Poser le token Bearer opaque, haché côté serveur, en complément du cookie de
session existant (piste 2).** C'est la plus petite unité de travail (une table
`api_tokens`, un hash SHA-256, une vérification dans `hooks.server.ts`, un endpoint
Settings minimal pour créer/révoquer), elle ne casse rien de l'existant, et elle
débloque immédiatement la piste la plus simple et la plus utile au quotidien : les
**Raccourcis iOS** (piste 3) — dictée vocale native, zéro infrastructure
supplémentaire, dans la poche du parent qui l'utilisera le plus. Home Assistant
(piste 1) est la marche suivante naturelle pour les foyers qui ont déjà HA et un
appareil vocal (le HA Voice Preview Edition à 69 USD, français supporté nativement
via Speech-to-Phrase, est une option concrète et abordable si Swaddle voulait la
documenter). Le serveur MCP (piste 5) est une valeur ajoutée réelle mais secondaire
tant que l'usage reste "au clavier, à la maison" — à envisager après les deux
premières. Google Home (piste 4) devrait être explicitement écartée du roadmap tant
que le déploiement reste LAN-only sans exposition Internet.
