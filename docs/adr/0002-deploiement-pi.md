# 0002 — Déploiement sur le Raspberry Pi familial

- **Date** : 2026-08-23
- **Statut** : acceptée

## Contexte

Le serveur cible est un Raspberry Pi 4 (Cortex-A72, 4 Go de RAM, aarch64,
Debian 12, SSD USB de 228 Go) qui héberge déjà une quinzaine de conteneurs
(n8n, Pi-hole, Vaultwarden, Portainer, Watchtower, ntfy…). Docker 20.10 et
Compose v2 y sont installés. Un build SvelteKit sur le Pi entrerait en
concurrence mémoire avec les services existants, et Watchtower met à jour
automatiquement les images `:latest`.

## Décision

L'image Docker est construite par GitHub Actions en multi-arch
(linux/arm64 + linux/amd64) sur une base `node:22-slim` (glibc, requis par les
binaires précompilés de better-sqlite3) et publiée sur GHCR. Le Pi ne
construit jamais : il fait `docker compose pull && docker compose up -d` avec
un tag versionné (`vX.Y.Z`) et le label
`com.centurylinklabs.watchtower.enable=false`. L'application écoute sur le
port 3010, configurable par variable d'environnement, avec les données dans un
bind mount `./data` sur le SSD.

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
