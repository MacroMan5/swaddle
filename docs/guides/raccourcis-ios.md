# Raccourcis iOS — saisie vocale « Hey Siri, Swaddle »

Guide pas-à-pas pour enregistrer une tétée, un biberon, une couche ou un dodo
en dictant une phrase à Siri, sans ouvrir l'app — le téléphone peut rester
dans la poche. S'appuie sur `POST /api/quick`
([contrat](../api/quick-api.md)) et sur les jetons API
([`docs/api/settings-api.md`](../api/settings-api.md) § Jetons API).

> **Statut : expérimental.** Les recettes ci-dessous suivent le contrat de
> l'API, mais les comportements propres à iOS (HTTP en clair sur le LAN,
> téléphone verrouillé, corps d'une réponse `422`) ne sont pas documentés par
> Apple : tant que la checklist du § 5 n'est pas remplie sur un iPhone réel,
> ne tenez rien de tout cela pour acquis.

## 1. Prérequis

- **Swaddle joignable sur le réseau local**, par exemple `http://swaddle.home`
  ou `http://<ip-du-serveur>:3010`.
- **Un jeton API créé** dans Réglages → « Accès API » : donnez-lui un nom
  (ex. « iPhone maman »), validez, puis **copiez immédiatement le jeton
  affiché** (`swd_…`) — il n'est montré qu'une seule fois, Swaddle n'en garde
  que le hachage. S'il est perdu, il faut en recréer un.
- **Un seul bébé dans le foyer** pour les corps de requête tels quels :
  sans `babyId`, l'API résout le bébé toute seule uniquement dans ce cas ;
  avec plusieurs bébés elle répond `409 ambiguous_baby` — une réponse qui n'a
  **pas** de champ `speech`, le raccourci resterait donc muet. Foyer à
  plusieurs bébés : ajoutez `"babyId": "<id>"` au corps JSON et faites **un
  raccourci par bébé** (« Swaddle Léo », « Swaddle Mia ») ; les identifiants
  s'obtiennent via `GET /api/babies` (contrat dans
  [`docs/api/events-api.md`](../api/events-api.md)).

## 2. Le raccourci générique « Swaddle »

C'est le seul raccourci nécessaire au quotidien : il accepte n'importe quelle
phrase dictée et laisse le serveur la comprendre. Il se construit à la main,
une seule fois, en 2-3 minutes — Apple n'accepte pas de fichier de raccourci
téléchargeable hors iCloud, il n'y a donc pas de lien « installer en un
clic ».

Touche par touche, dans l'app **Raccourcis** (icône bleue préinstallée) :

1. Onglet **Raccourcis** → bouton **`+`** en haut à droite → un raccourci
   vide s'ouvre.
2. Touchez le nom en haut (« Nouveau raccourci ») → **Renommer** → tapez
   `Swaddle`. C'est ce nom que Siri écoute : « Hey Siri, Swaddle ».
3. Touchez **« Ajouter une action »**, cherchez `dicter`, choisissez
   **« Dicter le texte »** (langue : français). C'est cette action qui
   capture ce que vous dites.
4. Ajoutez une action (barre de recherche ou `+`), cherchez `url`,
   choisissez **« Obtenir le contenu de l'URL »** :
   - Dans le champ URL, tapez `http://swaddle.home/api/quick` (adaptez à
     votre adresse).
   - Touchez la flèche / **« Afficher plus »** de l'action pour déplier :
     - **Méthode** : `POST`.
     - **En-têtes** → **Ajouter un en-tête** → clé `Authorization`, valeur
       `Bearer swd_…` : collez votre jeton complet, **précédé du mot
       `Bearer` et d'une espace**.
     - **Corps de la requête** : `JSON` → **Ajouter un champ** deux fois :
       - type **Texte**, clé `action`, valeur `phrase` (texte tapé) ;
       - type **Texte**, clé `text`, valeur → touchez le champ puis
         choisissez la pastille **« Texte dicté »** proposée au-dessus du
         clavier — la **variable magique** de l'étape 3, pas du texte tapé.

     > **Trois pièges de cet éditeur**, tous rencontrés en vrai :
     >
     > - La clé est `text`, **pas** `texte` : le contrat de l'API est en
     >   anglais, et une clé inconnue est ignorée en silence — le refus parle
     >   alors du champ absent (`path: "text"`, *received undefined*), pas de
     >   celui en trop.
     > - `action` vaut la **constante** `phrase`, tapée une seule fois ici et
     >   jamais dictée : c'est elle qui dit au serveur de lire le champ `text`.
     >   Une valeur en dur comme `sleep` fait ignorer la dictée (c'est le
     >   principe des raccourcis dédiés du § 3, pas du raccourci générique).
     > - La valeur se saisit **à droite** de la pastille de type, qui n'est
     >   qu'un menu (`Texte` / `Nombre` / …) et non un champ de saisie.
     >
     > Tout en minuscules et sans espace autour : la majuscule automatique
     > d'iOS transforme `phrase` en `Phrase`, que le serveur refuse. Coller le
     > texte au lieu de le taper évite d'un coup majuscule automatique,
     > correction et guillemets typographiques.
5. Ajoutez l'action **« Obtenir la valeur du dictionnaire »** (cherchez
   `dictionnaire`) : « Obtenir la **valeur** de `speech` dans `Contenu de
   l'URL` » — tapez `speech` à la place de « clé ».
6. Ajoutez l'action **« Énoncer le texte »** (cherchez `énoncer`) — elle se
   branche d'elle-même sur la valeur précédente.
7. **Terminé** en haut à droite.

**Premier test sans Siri** : touchez le raccourci dans la liste → il demande
la dictée → dites « biberon 120 » → il doit répondre à voix haute « Biberon
120 millilitres enregistré » (et l'événement apparaît dans « Aujourd'hui »).
Ensuite seulement, essayez « Hey Siri, Swaddle ».

Côté serveur, `speech` est à la racine du corps JSON aussi bien pour une
réponse `200` que pour une erreur `422` (`docs/api/quick-api.md` § `phrase`),
précisément pour que les étapes 5-6 lisent toujours une phrase utile — un succès
(« Biberon 120 millilitres enregistré ») comme un refus (« Je n'ai pas
compris “bonjour” »). **Réserve à valider** : il reste à confirmer sur
appareil que « Obtenir le contenu de l'URL » transmet bien le corps d'une
réponse non-2xx à l'action suivante au lieu d'échouer — c'est un point
explicite de la checklist du § 5. Si ce n'est pas le cas, le contournement
prévu est côté serveur (renvoyer les refus de dictée en `200` avec leur
`speech`) ; ouvrir une issue de suivi plutôt que de bricoler le raccourci.

**Usage** : « Hey Siri, Swaddle » → dicter par exemple « biberon 120 »,
« néné droite », « pipi », « dodo » — Siri répond à voix haute.

## 3. Raccourcis dédiés optionnels

Pour gagner un aller-retour de dictée, un raccourci dédié à un geste fréquent
saute l'étape « Dicter le texte » et envoie un corps JSON fixe :

- « Dodo » → `{"action":"sleep"}`
- « Pipi » → `{"action":"diaper","kind":"wet"}`

Mêmes étapes que le raccourci générique (§ 2), sans l'action « Dicter le
texte », et avec le corps JSON écrit directement plutôt que la variable
magique.

**Synonymes de déclenchement** (« Hey Siri, dodo » ET « Hey Siri, sieste » qui
font la même chose) : dupliquez le raccourci sous plusieurs noms — Siri ne
reconnaît qu'un seul nom de raccourci à la fois, il n'y a pas de mécanisme de
synonyme d'invocation dans l'app Raccourcis.

Ne pas confondre avec les **synonymes de dictée** (que le mot « néné » ou
« teton » déclenchent tous deux une tétée) : ceux-là ne touchent aucun
raccourci — ils se gèrent côté serveur, dans Réglages → « Mots vocaux »
(§ 4 ci-dessous), et le raccourci générique unique (§ 2) les reconnaît sans
modification.

## 4. Phrases reconnues

Le raccourci générique comprend n'importe quelle phrase contenant un mot du
vocabulaire du foyer. Par défaut : `biberon`, `pipi`, `caca`, `couche`,
`dodo`, `sieste`, `tetee`, `teton`, `nene`.

Règle de lecture d'une phrase (détail dans `docs/api/quick-api.md` §
L'intention `phrase`) :

- **Un mot déclencheur** (le premier mot du vocabulaire rencontré dans la
  phrase) fixe l'action — « cacahuète » n'est pas « caca », seul un mot
  entier compte.
- **Un nombre** dans la phrase devient le volume en millilitres :
  « biberon 120 », « biberon 120 ml ».
- **« gauche » / « droite »** (ou « droit ») devient le côté d'une tétée :
  « néné droite », « tétée gauche ».

Exemples : « biberon 90 », « néné droite », « pipi », « caca », « dodo »,
« sieste ».

**Ajouter un mot** (un synonyme, ex. « lolo » pour une tétée) : Réglages →
« Mots vocaux » → nouveau mot, associé à l'intention voulue (biberon /
couche pipi / couche caca / couche les deux / dodo / tétée). Le mot est
reconnu à la dictée suivante, sans redémarrer le serveur ni republier de
raccourci.

## 5. Validation sur appareil réel

Cette section documente les deux inconnues non tranchées par la
documentation Apple consultée (`docs/research/2026-08-26-integrations-voix-ia.md`
§ 3) : le comportement HTTP-sur-LAN et téléphone verrouillé de l'action
« Obtenir le contenu de l'URL ». À remplir lors d'un test sur un iPhone réel
contre le serveur Swaddle en production (le Pi).

- [ ] HTTP simple sur le LAN accepté par « Obtenir le contenu de l'URL »
      (pas de HTTPS requis)
- [ ] Déclenchement « Hey Siri, Swaddle » téléphone déverrouillé
- [ ] Déclenchement téléphone **verrouillé** (et lecture du `speech`)
- [ ] Scénario complet : « néné droite » → Siri lit « Tétée côté droit
      démarrée » → l'événement est visible dans « Aujourd'hui »
- [ ] Erreur lisible : dicter un mot inconnu → Siri lit « Je n'ai pas
      compris… »
- [ ] Refus `422` : le corps JSON d'une réponse non-2xx atteint bien
      « Obtenir la valeur du dictionnaire » (Siri lit le refus, pas une
      erreur générique du raccourci — voir la réserve du § 2)

### Résultats

_À remplir après le test sur appareil réel._

### Contournements

- **Si le HTTP simple est refusé** (App Transport Security bloque la requête
  en clair) : mettre un proxy HTTPS local devant Swaddle (reverse proxy avec
  certificat auto-signé ou interne au réseau — voir les pistes de
  `docs/research/2026-08-26-integrations-voix-ia.md` avant de complexifier le
  déploiement LAN-only actuel), plutôt que d'exposer Swaddle sur Internet
  pour obtenir un certificat public.
- **Si le déclenchement téléphone verrouillé échoue ou déclenche une
  confirmation bloquante** : dans le raccourci, vérifier que l'option
  « Demander avant d'exécuter » est désactivée (elle force un déverrouillage
  manuel) ; sinon, envisager un raccourci séparé sans dictée (§ 3) qui a
  moins de chances de demander une confirmation qu'un raccourci avec saisie.

## 6. Dépannage

**Pour voir ce que le serveur répond vraiment**, insérez temporairement
l'action **« Afficher le résultat »** entre « Obtenir le contenu de l'URL » et
« Obtenir la valeur du dictionnaire » : elle montre le corps JSON brut, refus
compris. Le `issues[].path` de l'enveloppe d'erreur nomme le champ fautif, ce
qui vaut mieux que n'importe quelle ligne du tableau ci-dessous. À retirer une
fois le raccourci au point.

| Symptôme | Cause probable | À faire |
| --- | --- | --- |
| `400 validation_failed`, `path: "action"`, « Invalid discriminator value » | Le champ `action` est vide, mal orthographié, ou capitalisé en `Phrase` par iOS | Retaper `phrase` en minuscules dans la **valeur** du champ (à droite du sélecteur de type), ou la coller |
| `400 validation_failed`, `path: "text"`, « expected string, received undefined » | La clé du second champ est `texte` : `text` est donc absent du corps | Renommer la clé en `text` |
| La dictée est ignorée : « néné droite » enregistre un dodo | `action` porte une valeur en dur (`sleep`, `diaper`…) qui décide à la place de la voix | Remettre `phrase` comme valeur de `action` |
| Siri répond une erreur générique / rien ne se passe | `401` : jeton révoqué, mal collé (espace, `swd_` manquant), ou en-tête `Authorization` mal orthographié | Recréer un jeton dans Réglages → « Accès API » et remplacer la valeur dans le raccourci |
| Siri lit « il me faut le volume du biberon » | `422 missing_volume` : le mot « biberon » a été dicté sans nombre | Redicter en incluant le nombre, ex. « biberon 120 » |
| Siri lit « je n'ai pas compris… » | `422 unrecognized_phrase` : aucun mot du vocabulaire dans la phrase dictée | Vérifier le mot exact dans Réglages → « Mots vocaux », ou en ajouter un synonyme (§ 4) |
| Le raccourci reste bloqué / erreur réseau | Serveur injoignable : téléphone sur le Wi-Fi invité, un VPN actif, ou le serveur éteint | Vérifier que le téléphone est sur le même réseau que Swaddle (pas le Wi-Fi invité), désactiver le VPN, vérifier que `http://swaddle.home` répond depuis Safari |
