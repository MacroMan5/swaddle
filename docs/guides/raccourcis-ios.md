# Raccourcis iOS — saisie vocale « Hey Siri, Swaddle »

Guide pas-à-pas pour enregistrer une tétée, un biberon, une couche ou un dodo
en dictant une phrase à Siri, sans ouvrir l'app — le téléphone peut rester
dans la poche. S'appuie sur `POST /api/quick`
([contrat](../api/quick-api.md)) et sur les jetons API
([`docs/api/settings-api.md`](../api/settings-api.md) § Jetons API).

## 1. Prérequis

- **Swaddle joignable sur le réseau local**, par exemple `http://swaddle.home`
  ou `http://<ip-du-serveur>:3010`.
- **Un jeton API créé** dans Réglages → « Accès API » : donnez-lui un nom
  (ex. « iPhone maman »), validez, puis **copiez immédiatement le jeton
  affiché** (`swd_…`) — il n'est montré qu'une seule fois, Swaddle n'en garde
  que le hachage. S'il est perdu, il faut en recréer un.

## 2. Le raccourci générique « Swaddle »

C'est le seul raccourci nécessaire au quotidien : il accepte n'importe quelle
phrase dictée et laisse le serveur la comprendre.

Dans l'app **Raccourcis** :

1. **Nouveau raccourci**, renommé « Swaddle ».
2. Ajouter l'action **Dicter le texte**, langue français. C'est cette action
   qui capture ce que vous dites après « Hey Siri, Swaddle ».
3. Ajouter l'action **Obtenir le contenu de l'URL** :
   - **URL** : `http://swaddle.home/api/quick` (adaptez à votre adresse).
   - **Méthode** : `POST`.
   - **En-têtes** : `Authorization` → `Bearer swd_…` (votre jeton complet).
   - **Corps de la requête** : JSON, avec :
     ```json
     { "action": "phrase", "text": "Texte dicté" }
     ```
     où `Texte dicté` est la **variable magique** produite par l'action
     « Dicter le texte » de l'étape 2 (pas du texte fixe).
4. Ajouter l'action **Obtenir la valeur du dictionnaire**, clé `speech`, sur
   le résultat de l'action précédente (le corps JSON renvoyé par Swaddle).
5. Ajouter l'action **Énoncer le texte** sur cette valeur.

L'étape 4 fonctionne aussi bien pour une réponse `200` que pour une erreur
`422` : dans les deux cas `speech` est à la racine du corps JSON
(`docs/api/quick-api.md` § `phrase`), donc Siri lit toujours une phrase utile
— un succès (« Biberon 120 millilitres enregistré ») comme un refus
(« Je n'ai pas compris “bonjour” »).

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

| Symptôme | Cause probable | À faire |
| --- | --- | --- |
| Siri répond une erreur générique / rien ne se passe | `401` : jeton révoqué, mal collé (espace, `swd_` manquant), ou en-tête `Authorization` mal orthographié | Recréer un jeton dans Réglages → « Accès API » et remplacer la valeur dans le raccourci |
| Siri lit « il me faut le volume du biberon » | `422 missing_volume` : le mot « biberon » a été dicté sans nombre | Redicter en incluant le nombre, ex. « biberon 120 » |
| Siri lit « je n'ai pas compris… » | `422 unrecognized_phrase` : aucun mot du vocabulaire dans la phrase dictée | Vérifier le mot exact dans Réglages → « Mots vocaux », ou en ajouter un synonyme (§ 4) |
| Le raccourci reste bloqué / erreur réseau | Serveur injoignable : téléphone sur le Wi-Fi invité, un VPN actif, ou le serveur éteint | Vérifier que le téléphone est sur le même réseau que Swaddle (pas le Wi-Fi invité), désactiver le VPN, vérifier que `http://swaddle.home` répond depuis Safari |
