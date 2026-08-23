# Spécification — MVP du suivi de nouveau-né

**Statut :** Draft
**Design :** `docs/plans/2026-08-23-newborn-tracker-design.md`
**ADR :** 0001 (architecture), 0002 (déploiement Pi), 0003 (frontend/design system)
**Dernière mise à jour :** 2026-08-23

Les termes MUST / MUST NOT / SHOULD / MAY suivent la RFC 2119.

---

## Périmètre

**Inclus :**

- Allaitement (minuteur, segments gauche/droite), biberon, tirage.
- Couches (pipi / caca / les deux) en un toucher.
- Sommeil (minuteur partagé multi-appareils).
- Écran Aujourd'hui, Historique (jour/semaine), Réglages.
- Résumés journaliers et hebdomadaires.
- Synchronisation SSE entre appareils du LAN.
- Exports CSV/JSON, snapshot SQLite, restauration.
- PIN familial facultatif.
- Assistant de premier lancement.

**Exclus :** toute la section « Hors périmètre » du design (prédictions, IA,
croissance, photos, multi-famille, multi-bébé en interface, apps natives,
notifications, PWA/hors-ligne, inventaire de lait).

---

## Exigences fonctionnelles

| ID | Exigence | Priorité |
|----|----------|----------|
| FR-001 | Une couche MUST se journaliser en un toucher depuis l'accueil (Pipi, Caca, Les deux), horodatée à maintenant, avec une action Annuler affichée 5 s. | P0 |
| FR-002 | Un allaitement MUST démarrer en deux touchers (Allaiter → Gauche/Droite). La séance MUST supporter pause, reprise, changement de côté et fin ; chaque segment gauche/droite reste rattaché à la séance. Le temps en pause MUST être exclu de la durée. | P0 |
| FR-003 | Un biberon MUST enregistrer type (maternel/préparation/mixte), quantité, unité et heure (modifiable, initialisée à maintenant). Le dernier type MUST être présélectionné. Aucun minuteur. | P0 |
| FR-004 | Un tirage MUST enregistrer côté (gauche/droite/les deux), un minuteur unique, la quantité totale saisie à la fin ; heure et durée modifiables. | P1 |
| FR-005 | Le sommeil MUST offrir Commencer/Réveillé avec durée en cours affichée. Sommeil et alimentation MAY se chevaucher. | P0 |
| FR-006 | Tout type d'événement MUST pouvoir être ajouté manuellement a posteriori avec heures et durées. | P0 |
| FR-007 | Toute entrée MUST être modifiable et supprimable depuis l'historique. La suppression MUST être logique (soft delete) et annulable pendant 5 s. | P0 |
| FR-008 | L'écran Aujourd'hui MUST afficher les cartes dans l'ordre alimentation, couche, sommeil, résumé, chacune avec dernière activité et temps écoulé ; toute activité en cours MUST apparaître dans une carte persistante en haut. | P0 |
| FR-009 | L'historique MUST offrir sélecteur de journée, ligne temporelle colorée, liste chronologique, filtres par catégorie et bascule jour/semaine. | P1 |
| FR-010 | Les résumés MUST calculer les métriques listées dans le design (séances et durées d'allaitement G/D, biberons et volumes, tirages et volumes, couches pipi/caca, sommeil total et moyen des périodes terminées). Une période traversant minuit MUST rester une entrée unique dont la durée est répartie entre les journées. | P0 |
| FR-011 | Les réglages MUST couvrir : prénom et date de naissance du bébé, aidants et couleur, aidant associé au navigateur (stocké localement), PIN facultatif, unité ml/oz, thème clair/sombre/auto, exports, sauvegarde/restauration. | P0 |
| FR-012 | Les écritures MUST passer par l'API HTTP ; les autres appareils MUST recevoir les changements par SSE ; une reconnexion MUST récupérer l'état autoritaire du serveur. Les clients MUST calculer l'affichage des minuteurs localement à partir de l'heure de départ serveur. | P0 |
| FR-013 | Il MUST exister au plus un minuteur actif par catégorie et par bébé. Un démarrage concurrent MUST retourner la séance existante au lieu d'en créer une. | P0 |
| FR-014 | L'application MUST exporter CSV et JSON versionné et télécharger un snapshot SQLite cohérent. Une restauration MUST créer automatiquement un snapshot de la base remplacée avant d'écrire. | P1 |
| FR-015 | Le PIN familial, s'il est activé, MUST protéger l'ensemble de l'application et créer une session persistante par appareil. Sa réinitialisation passe par une procédure serveur documentée (hors interface). | P1 |
| FR-016 | Au premier lancement (base vide), l'application MUST présenter un assistant minimal : prénom + date de naissance du bébé, puis au moins un aidant. Aucune autre étape bloquante. | P0 |
| FR-017 | Le serveur ET l'interface MUST refuser : volumes hors de [1, 1000] ml (ou équivalent oz), fin antérieure au début, heures futures de plus de 5 minutes. | P0 |
| FR-018 | L'interface MUST afficher un bandeau de perte de connexion, conserver un formulaire échoué avec Réessayer, et ne jamais présenter une écriture comme sauvegardée avant confirmation serveur. | P0 |

---

## Exigences non fonctionnelles

| ID | Exigence | Budget |
|----|----------|--------|
| NFR-001 | Une activité créée sur un appareil MUST apparaître sur les autres appareils du LAN en < 2 s. | 2 s |
| NFR-002 | Sur le Pi 4 cible (chargé de ses autres services), les réponses API MUST rester < 300 ms au P95 et le premier chargement < 3 s sur un téléphone du LAN. | 300 ms / 3 s |
| NFR-003 | Le conteneur SHOULD rester sous 300 Mo de RAM en usage normal. | 300 Mo |
| NFR-004 | SQLite MUST être en mode WAL avec transactions courtes ; aucune écriture confirmée ne MUST être perdue après un redémarrage du conteneur. | — |
| NFR-005 | Cibles tactiles ≥ 48 px, contraste AA, catégories identifiables sans perception des couleurs, mode sombre sans surface blanche agressive. | — |
| NFR-006 | Aucune requête réseau vers un domaine tiers, jamais (polices incluses : auto-hébergées). | 0 appel |
| NFR-007 | L'image MUST être multi-arch (linux/arm64 + linux/amd64) et démarrer via Docker Compose sans étape de build (ADR 0002). | — |
| NFR-008 | Toute couleur/ombre/rayon MUST référencer un design token (ADR 0003). | — |

---

## Critères d'acceptation

| ID | Critère | Vérification |
|----|---------|--------------|
| AC-001 | Étant sur l'accueil, quand je touche Pipi, alors l'événement est enregistré à l'heure courante et Annuler s'affiche 5 s ; toucher Annuler le supprime. | E2E |
| AC-002 | Étant sur l'accueil, quand je touche Allaiter puis Gauche, alors un minuteur démarre ; changement de côté, pause et fin produisent des segments corrects et la pause est exclue de la durée. | E2E + unitaire |
| AC-003 | Étant un sommeil démarré sur l'appareil A, quand l'appareil B ouvre l'app, alors il voit le minuteur en cours et peut le terminer ; A voit la fin en < 2 s. | Intégration + E2E |
| AC-004 | Étant un minuteur actif, quand deux appareils tentent d'en démarrer un de même catégorie, alors une seule séance existe et le second appareil la récupère. | Intégration |
| AC-005 | Étant un minuteur enregistré, quand je recharge la page ou perds la connexion brièvement, alors le minuteur réapparaît avec la durée correcte calculée depuis l'heure serveur. | E2E |
| AC-006 | Étant un sommeil de 23 h 30 à 01 h 30, quand je consulte les résumés, alors chaque journée reçoit sa part de durée et l'entrée reste unique ; le calcul reste exact lors d'un changement d'heure (DST). | Unitaire |
| AC-007 | Étant des données existantes, quand j'exporte JSON puis restaure sur une base vide, alors toutes les activités sont reproduites à l'identique et un snapshot de la base remplacée a été conservé. | Intégration |
| AC-008 | Étant une base vide, quand j'ouvre l'application, alors l'assistant me demande le bébé puis un aidant, et l'accueil est utilisable immédiatement après. | E2E |
| AC-009 | Étant le PIN activé, quand un nouvel appareil ouvre l'app, alors le PIN est exigé une fois puis la session persiste. | E2E |
| AC-010 | Étant un volume de 0 ou 1500 ml, une fin avant le début, ou une heure future de 10 min, quand je soumets, alors l'interface ET l'API refusent avec un message clair. | Unitaire + intégration |
| AC-011 | L'interface est utilisable et conforme au design à 320, 390 et 768 px, en mode sombre, sur Safari iOS et Chrome Android. | E2E |
| AC-012 | Le compose de référence démarre l'image GHCR arm64 sur le Pi sans build et les données survivent à `docker compose down && up`. | Manuel |

---

## Risques et mitigations

| ID | Risque | Prob. | Impact | Mitigation |
|----|--------|-------|--------|------------|
| RISK-001 | Horloge client décalée → temps écoulé négatif ou faux. | Moy | Moy | L'heure serveur fait foi ; l'affichage clampe à ≥ 0 ; les appareils du foyer sont supposés en NTP. |
| RISK-002 | Snapshot SQLite incohérent pris pendant des écritures. | Moy | Élevé | Utiliser l'API de backup SQLite (`VACUUM INTO` ou backup API), jamais une copie de fichier à chaud. |
| RISK-003 | Pi chargé (15 conteneurs) → latences dépassant les budgets. | Moy | Faible | Budgets NFR-002 mesurés sur le Pi réel ; app légère (Svelte, pas de build SSR coûteux par requête). |
| RISK-004 | Binaire better-sqlite3 absent pour l'image arm64. | Faible | Élevé | Base glibc `node:22-slim` (ADR 0002) ; vérifié en CI par le build multi-arch. |
| RISK-005 | Minuteur oublié (sommeil de 14 h) faussant les résumés. | Moy | Faible | Pas d'arrêt automatique ; la carte affiche la durée anormale et l'entrée reste éditable (DEC-004). |

---

## Questions ouvertes

| ID | Question | Responsable | Échéance |
|----|----------|-------------|----------|
| — | Aucune. | — | — |

---

## Décisions

| ID | Décision | Justification |
|----|----------|---------------|
| DEC-001 | Le temps en pause est exclu de la durée d'allaitement. | Convention des apps de référence ; c'est la durée de tétée effective qui intéresse les aidants. |
| DEC-002 | Bornes de volume : 1–1000 ml (converti pour oz). Heures futures refusées au-delà de 5 min. | Garde-fou contre les fautes de frappe sans bloquer les usages réels. |
| DEC-003 | Le PIN protège toute l'application (pas de granularité) ; session persistante de longue durée par appareil ; reset via procédure serveur documentée. | Un seul foyer sur un LAN privé — la granularité serait de la complexité gratuite. |
| DEC-004 | Aucun arrêt automatique des minuteurs oubliés. | La correction manuelle (FR-006/007) suffit ; un auto-stop inventerait des données. |
| DEC-005 | Fenêtre d'annulation (couche, suppression) : 5 s. | Assez pour un pouce nocturne, assez court pour ne pas retarder la synchro perçue. |
| DEC-006 | Les suppressions logiques sont conservées indéfiniment ; purge hors périmètre. | Volume de données minuscule à l'échelle d'une famille. |
| DEC-007 | Assistant de premier lancement minimal (bébé + un aidant), non décrit dans le design mais indispensable. | Sans lui, l'écran Aujourd'hui n'a pas de sujet. |
| DEC-008 | Polices auto-hébergées dans l'image ; aucun CDN. | Cohérent avec NFR-006 et l'usage LAN sans Internet garanti. |

---

## Hypothèses

- 2 à 5 appareils simultanés au maximum ; les budgets NFR sont calibrés pour cela — si faux, rouvrir la spec.
- Tous les appareils du foyer partagent le même fuseau horaire que le bébé.
- Le Pi reste sur SSD (pas de carte SD) ; la durabilité SQLite en dépend.
- Les navigateurs cibles sont Safari iOS et Chrome Android récents (2 dernières versions majeures).
