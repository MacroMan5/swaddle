# 0001 — Architecture du prototype familial

- **Date** : 2026-08-23
- **Statut** : acceptée

## Contexte

Le produit est une petite application web open source utilisée par une seule famille
sur son réseau local. Il doit synchroniser quelques appareils, conserver des
minuteurs fiables et rester simple à installer, sauvegarder et maintenir.

## Décision

Construire un monolithe TypeScript avec SvelteKit, une base SQLite persistée dans un
volume Docker, et des Server-Sent Events pour synchroniser les appareils. Distribuer
l'application avec Docker Compose et la servir en HTTP sur le LAN pour le prototype.

## Conséquences

- Une seule application contient l'interface et l'API.
- Aucun service de base de données, cache ou cloud séparé n'est requis.
- Les sauvegardes peuvent reposer sur un fichier SQLite et des exports applicatifs.
- Server-Sent Events suffisent aux mises à jour serveur vers les navigateurs ; les
  écritures ordinaires passent par HTTP.
- Le mode WAL et des transactions courtes sont nécessaires pour les accès concurrents.
- Le service ne doit pas être exposé directement à Internet.
- HTTP sur une adresse LAN ne permet pas une PWA complète ni un service worker. Une
  future installation PWA ou exposition distante nécessitera HTTPS et une nouvelle
  décision sur l'authentification et le déploiement.
