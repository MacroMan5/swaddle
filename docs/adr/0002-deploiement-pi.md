# 0002 — Déploiement sur le Raspberry Pi familial

- **Date** : 2026-08-23
- **Statut** : acceptée

## Contexte

Le déploiement cible des serveurs domestiques aux ressources contraintes,
notamment les Raspberry Pi 4+ en aarch64 avec Docker et Compose v2. Construire
SvelteKit directement sur ce type d'hôte entrerait en concurrence avec les
autres services locaux. Une mise à jour automatique d'une image `:latest`
pourrait également appliquer une migration SQLite sans supervision.

## Décision

L'image Docker est construite par GitHub Actions en multi-arch
(linux/arm64 + linux/amd64) sur une base `node:22-slim` (glibc, requis par les
binaires précompilés de better-sqlite3) et publiée sur GHCR. L'hôte ne
construit jamais : il fait `docker compose pull && docker compose up -d` avec
un tag versionné (`vX.Y.Z`) et le label
`com.centurylinklabs.watchtower.enable=false`. Le port, le fuseau horaire et le
répertoire persistant sont configurés par un fichier `.env` local ignoré par
Git ; les valeurs publiques par défaut sont respectivement `3010`, `UTC` et
`./data`.

## Conséquences

- Installation en une commande pour toute famille qui clone le projet ; aucune
  compilation côté serveur.
- Les mises à jour sont volontaires (changement de tag), jamais poussées par
  Watchtower — pas de migration SQLite non supervisée sur les données du bébé.
- La publication GHCR impose un dépôt GitHub public et un workflow CI déclenché
  par les tags.
- Pas de reverse proxy devant l'app sur ce Pi : les Server-Sent Events passent
  en direct. Si un proxy est ajouté un jour, désactiver son buffering
  (`proxy_buffering off` sous nginx).
- Optionnel : un enregistrement DNS local dans Pi-hole (ex. `bebe.home →
  adresse du Pi`) donne une URL mémorisable sans changer le choix HTTP-LAN de
  l'ADR 0001.
