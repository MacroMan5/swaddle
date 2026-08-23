# Conception du suivi de nouveau-né auto-hébergé

- **Date** : 2026-08-23
- **Statut** : approuvée
- **Périmètre** : prototype familial sur réseau local

## Vision

Créer une application web mobile extrêmement simple pour que deux aidants puissent
suivre l'alimentation, les couches et le sommeil d'un nouveau-né. L'application sert
de mémoire familiale partagée, particulièrement lors des relais nocturnes.

Le produit reprend des conventions éprouvées de Huckleberry et Nara Baby sans
reproduire leur marque, leurs textes ou leurs éléments graphiques propriétaires.

## Recherche et références UX

Les produits étudiés convergent sur les mêmes principes :

- saisie en un ou deux touchers ;
- temps écoulé depuis la dernière activité ;
- cartes par catégorie sur l'écran du jour ;
- minuteurs persistants et partagés ;
- historique commun entre aidants ;
- résumés quotidiens et hebdomadaires.

Références principales :

- [Huckleberry — Tracking](https://huckleberrycare.com/product/tracking)
- [Nara Baby — étude de conception](https://everydayindustries.com/casestudy/mobile-app-ui-design-case-study/)
- [Huckleberry — étude CHI et captures](https://depstein.net/assets/pubs/apapoutsaki_chi26.pdf)
- [ParentLove — fonctionnalités](https://parentlove.me/features/)

## Utilisateurs et contraintes

- Une seule famille et un seul bébé dans le prototype.
- Deux aidants ou plus peuvent utiliser la même installation.
- Le projet est open source et destiné à être publié sur GitHub.
- Le serveur est auto-hébergé et accessible uniquement sur le LAN.
- Aucun compte externe, service cloud ou suivi publicitaire n'est requis.
- L'interface est en français et conçue d'abord pour les téléphones.
- Le prototype est servi en HTTP sur le LAN. Il ne fournit ni installation PWA
  complète ni fonctionnement hors connexion.

## Principes d'expérience

- L'écran principal répond d'abord à « qu'est-ce qui vient de se passer ? » et
  « depuis combien de temps ? ».
- Les actions fréquentes restent visibles sans ouvrir de menu.
- Une couche se journalise en un toucher et un allaitement démarre en deux.
- Les détails facultatifs ne ralentissent jamais la saisie principale.
- Les erreurs restent corrigeables depuis l'historique.
- Les couleurs renforcent les catégories, mais les libellés et icônes restent
  suffisants sans perception des couleurs.
- Les commandes tactiles mesurent au moins 48 px et le mode sombre évite les
  surfaces blanches agressives la nuit.

## Navigation

La barre inférieure comporte trois destinations.

### Aujourd'hui

L'écran principal utilise des cartes verticales inspirées de Nara Baby. Chaque
carte affiche la dernière activité, le temps écoulé et les actions disponibles.

Ordre des cartes :

1. alimentation ;
2. couche ;
3. sommeil ;
4. résumé de la journée.

Une activité en cours apparaît aussi dans une carte persistante en haut de l'écran.
L'en-tête affiche le prénom du bébé et l'aidant associé à l'appareil.

### Historique

- Sélecteur de journée.
- Résumé compact de la période.
- Ligne temporelle colorée.
- Liste chronologique de toutes les entrées.
- Filtres par catégorie.
- Choix entre vue journalière et hebdomadaire.
- Modification et suppression depuis chaque entrée.

### Réglages

- Prénom et date de naissance du bébé.
- Aidants et couleur d'identification.
- Aidant associé au navigateur actuel.
- PIN familial facultatif.
- Unité de volume, ml ou oz.
- Thème clair, sombre ou automatique.
- Exports CSV et JSON.
- Sauvegarde et restauration.

## Parcours d'alimentation

### Allaitement

1. Toucher **Allaiter**.
2. Choisir **Gauche** ou **Droite** ; le minuteur démarre immédiatement.
3. Pendant la séance : changer de côté, mettre en pause, reprendre ou terminer.
4. Chaque segment gauche/droite demeure rattaché à la même séance.

L'écran indique le dernier sein utilisé. Une séance oubliée peut être ajoutée
manuellement avec ses heures et durées. Une seule séance d'allaitement peut être
active pour le bébé.

### Biberon

- Type : lait maternel, préparation ou mixte.
- Quantité et unité.
- Heure initialisée à maintenant et modifiable.
- Dernier type de lait présélectionné.
- Aucun minuteur obligatoire dans le prototype.

### Tirage

- Sélection gauche, droite ou les deux.
- Minuteur unique.
- Quantité totale à la fin.
- Heure et durée modifiables.
- Aucun inventaire de lait congelé dans le prototype.

Les formulaires s'ouvrent dans un panneau inférieur afin de conserver le contexte
de l'écran principal.

## Parcours des couches

La carte expose directement **Pipi**, **Caca** et **Les deux**. Toucher une option
enregistre immédiatement l'événement à l'heure actuelle et présente brièvement une
action **Annuler**.

L'heure et une note facultative peuvent être ajoutées ou corrigées depuis
l'historique. La couleur, la consistance, la quantité et les irritations sont hors
du périmètre initial.

## Parcours du sommeil

- **Commencer le sommeil** crée une période active.
- La carte indique depuis combien de temps le bébé dort.
- **Réveillé** termine la période.
- Les heures peuvent être saisies ou corrigées manuellement.
- Une seule période de sommeil peut être active.
- Les périodes de sommeil et d'alimentation peuvent se chevaucher.

## Résumés

### Journalier

- Nombre de séances d'allaitement et durée totale.
- Durées gauche et droite.
- Nombre de biberons et volume total.
- Nombre de tirages et volume total.
- Nombre de couches avec pipi et avec caca.
- Durée totale et durée moyenne des périodes de sommeil terminées.

Une période traversant minuit reste une entrée unique, mais sa durée est répartie
entre les journées concernées pour les statistiques.

### Hebdomadaire

- Sept colonnes, une par jour.
- Totaux quotidiens par catégorie.
- Aucun score, objectif médical, conseil ou comparaison avec d'autres enfants.

## Modèle de données conceptuel

### Foyer

Contient la configuration de l'installation et le PIN facultatif.

### Bébé

Contient le prénom, la date de naissance et le fuseau horaire. Le schéma n'interdit
pas plusieurs bébés à long terme, mais l'interface du prototype n'en expose qu'un.

### Aidant

Contient un nom et une couleur. Le navigateur mémorise l'aidant choisi localement ;
il ne s'agit pas d'un compte individuel.

### Événement

Tous les événements possèdent :

- un identifiant stable ;
- le bébé et l'aidant ;
- un type ;
- des heures de début et de fin selon le type ;
- une note facultative ;
- les dates de création, modification et suppression logique.

Les détails propres au type couvrent les segments gauche/droite, le type et volume
du biberon, le côté et volume du tirage, et les indicateurs pipi/caca.

## Synchronisation

Les écritures passent par l'API du serveur. Les autres appareils reçoivent les
changements avec Server-Sent Events.

Au démarrage d'un minuteur, le serveur enregistre immédiatement l'heure de départ.
Les clients calculent ensuite l'affichage du temps localement, sans écriture chaque
seconde. La reconnexion récupère l'état autoritaire du serveur.

Il ne peut exister qu'un minuteur actif de même catégorie pour un bébé. Si un autre
appareil tente d'en démarrer un, il récupère la séance existante. Il n'y a pas de
restriction de chevauchement entre catégories différentes.

## Architecture

- Application monolithique TypeScript avec SvelteKit.
- Interface et API servies par le même processus.
- SQLite en mode WAL dans un volume persistant.
- Server-Sent Events pour les mises à jour entre appareils.
- Image Docker et fichier Docker Compose pour l'installation.
- Aucun Redis, PostgreSQL ou composant cloud dans le prototype.

Cette architecture et son déploiement sont consignés dans l'ADR 0001.

## Accès, vie privée et sécurité

- L'application est destinée à une adresse privée du LAN et ne doit pas être
  exposée directement à Internet.
- Un PIN familial facultatif crée une session persistante sur les appareils connus.
- Aucun script analytique ou appel tiers n'est chargé.
- Les secrets et fichiers de données ne sont jamais versionnés.
- Une exposition future hors LAN exigera HTTPS et une révision de l'authentification.

## Sauvegarde et portabilité

- CSV lisible pour l'analyse des activités.
- JSON complet et versionné pour la portabilité.
- Téléchargement d'un instantané SQLite.
- Avant une restauration, l'application conserve automatiquement un instantané de
  la base remplacée.

## Gestion des erreurs

- Un bandeau signale la perte de connexion au serveur LAN.
- Un formulaire échoué reste dans le navigateur et propose **Réessayer**.
- Une écriture n'est jamais présentée comme sauvegardée avant confirmation.
- Un minuteur déjà enregistré continue à être affiché pendant une courte coupure.
- Les volumes négatifs, fins antérieures aux débuts et autres valeurs impossibles
  sont refusés côté interface et côté serveur.
- Une suppression peut être annulée pendant quelques secondes.

Le prototype n'offre pas de véritable journalisation hors connexion ni de file de
synchronisation durable.

## Vérification

### Tests unitaires

- Calcul des durées et totaux.
- Segments d'allaitement gauche/droite.
- Répartition à minuit et changements d'heure.
- Validation des volumes et intervalles.

### Tests d'intégration

- Unicité des minuteurs actifs.
- Écritures concurrentes de deux aidants.
- Reconnexion Server-Sent Events.
- Exports et restauration.
- Migrations SQLite.

### Tests de bout en bout

- Couche en un toucher.
- Démarrage, changement de côté et fin d'un allaitement.
- Biberon et tirage.
- Sommeil démarré sur un appareil et terminé sur un autre.
- Modification et suppression depuis l'historique.
- Mode sombre et largeurs de 320, 390 et 768 px.
- Safari iOS et Chrome Android.

### Critères d'acceptation

- Une couche se journalise en un toucher depuis l'accueil.
- Un allaitement démarre en deux touchers.
- Un rechargement ne perd pas un minuteur enregistré.
- Un deuxième appareil voit une activité en moins de deux secondes sur le LAN.
- Les résumés restent exacts autour de minuit et des changements d'heure.
- Une sauvegarde restaurée reproduit toutes les activités.

## Hors périmètre

- Prédictions de sommeil et recommandations.
- Intelligence artificielle et conseils médicaux.
- Croissance, médicaments, vaccins et symptômes.
- Étapes de développement et aliments solides.
- Photos, souvenirs et saisie vocale.
- Plusieurs familles ou inscription publique.
- Plusieurs bébés dans l'interface.
- Applications natives et montres connectées.
- Notifications, rappels et inventaire de lait.
- PWA installable et fonctionnement hors connexion.
