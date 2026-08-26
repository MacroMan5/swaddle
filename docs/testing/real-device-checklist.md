# Checklist manuel — appareils réels (issue #53)

La CI exécute désormais les parcours critiques dans Chromium et WebKit
desktop (`tests/e2e/playwright.config.ts`), qui approchent Chrome Android et
Safari iOS sans les reproduire exactement. Ce qui suit ne peut être vérifié
que sur un vrai appareil, avant chaque changement notable de l'UI tactile ou
avant une release. Cocher au fil de l'eau ; noter l'appareil/OS/navigateur
utilisé.

## Appareils de référence

- **iOS** : iPhone récent, dernière version de Safari (iOS courant).
- **Android** : téléphone récent, dernière version de Chrome (Android courant).

## Parcours à rejouer

Sur chaque appareil, dérouler les mêmes parcours critiques que la CI :

- [ ] Premier lancement (assistant `/setup`) : saisie du prénom et de la date
      de naissance au clavier tactile, `Continuer` puis `Terminer`.
- [ ] Aujourd'hui : tuiles héros (couche une touche, allaitement deux
      touches), sélecteur de couche, biberon/tirage (feuilles), minuteurs
      actifs (bandeau).
- [ ] Historique : sélecteur de jour, grille horaire, édition d'un
      événement, suppression avec annulation (5 s), ajout manuel.
- [ ] Réglages : ajout/renommage d'aidant, changement d'unité et de thème,
      restauration depuis un fichier (`Restaurer depuis un fichier…`).
- [ ] Code PIN : verrouillage/déverrouillage, code incorrect, session
      persistante après un redémarrage de l'app/l'onglet.

## Comportement tactile

- [ ] Aucune cible tactile ne demande une précision anormale (les tuiles et
      boutons visent ≥ 48 px, mais un doigt réel n'est pas un clic simulé).
- [ ] Pas de zoom involontaire à la mise au point d'un champ de saisie
      (Safari iOS zoome si un champ affiche du texte < 16 px — vérifier
      Volume, PIN, formulaires de l'assistant).
- [ ] Pas de double-déclenchement au tap (ex. tuile héros ouvrant une feuille
      deux fois, `active:` visuel qui reste collé après relâchement).
- [ ] Défilement de la grille horaire (Historique) fluide au doigt, sans
      scroll horizontal parasite ni rebond cassé.
- [ ] Feuilles (BottleSheet/PumpSheet/NursingSheet) : le clavier système ne
      masque pas le bouton d'action ; le tap en dehors ferme la feuille.

## Zones sécurisées (encoche, coins arrondis, barre de gestes)

- [ ] Le bandeau de minuteur actif et les boutons de bas d'écran restent
      visibles et atteignables au-dessus de la barre de gestes iOS et de la
      barre de navigation Android (aucun contenu caché sous l'encoche ou la
      zone d'inset).
- [ ] Le bas des feuilles (sheets) respecte l'inset de sécurité en bas
      d'écran (le bouton `Enregistrer` n'est pas coupé).
- [ ] Orientation portrait uniquement testée (l'app ne prétend pas au
      paysage) : vérifier qu'une rotation accidentelle ne casse pas la mise
      en page plutôt que de viser un support explicite.

## Lecteurs d'écran (VoiceOver / TalkBack)

Points d'entrée à vérifier, pas un audit d'accessibilité complet :

- [ ] VoiceOver (iOS) : activer, balayer depuis le haut de l'écran
      « Aujourd'hui » — les tuiles héros, le sélecteur de couche et le
      bandeau de minuteur actif sont annoncés avec un libellé compréhensible
      (pas juste « bouton »).
- [ ] TalkBack (Android) : idem, plus la navigation par gestes standard
      (balayage droite/gauche) parcourt les tuiles dans un ordre logique.
- [ ] Le bouton « Réessayer » de l'état d'erreur (`bootstrap-error`) est
      annoncé comme une alerte, pas silencieusement ignoré.
- [ ] La feuille modale (sheet) piège le focus du lecteur d'écran pendant
      qu'elle est ouverte et le restitue à la fermeture.
- [ ] Le toast d'annulation (suppression, 5 s) est annoncé et son bouton
      « Annuler » atteignable avant l'expiration.

## Notes

- Ce document ne remplace pas la CI : il couvre uniquement ce que
  l'émulation desktop (Chromium/WebKit sous Windows) ne peut pas exercer par
  construction — vrai matériel tactile, vrais lecteurs d'écran, vraies
  zones sécurisées d'un vrai écran.
- Consigner ici toute régression trouvée en la reliant à un ticket, pas en
  modifiant cette liste avec le détail du bug.
