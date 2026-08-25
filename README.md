# Swaddle — self-hosted baby tracker

Application web mobile, simple et open source, pour que deux aidants suivent
l'alimentation, les couches et le sommeil d'un nouveau-né — hébergée chez vous,
sur votre réseau local, sans compte, sans cloud, sans pub.

*Inspiration* : les conventions UX éprouvées d'applications comme Huckleberry,
Nara Baby ou Baby Tracker — sans reprendre leur nom, leur marque ni leurs
contenus.

## 👶 Nouvellement papa

Ce projet est né comme naissent les meilleurs projets maison : un nouveau papa,
des nuits courtes, et l'envie de savoir « depuis combien de temps dort-elle ? »
sans envoyer les données de son bébé dans le cloud de quelqu'un d'autre.

Une petite app maison, self-host sur le Raspberry Pi du salon, vibe-codée avec
les skills en superpowers et Matt Bacock en fond sonore. Si elle peut servir à
d'autres familles, c'est encore mieux — d'où l'open source.

## Fonctionnalités (MVP)

- **Alimentation** : allaitement chronométré (gauche/droite, pause, changement
  de côté), biberons, tirage.
- **Couches** : pipi / caca / les deux, journalisées en un toucher.
- **Sommeil** : minuteur partagé, démarré sur un appareil et terminé sur un autre.
- **Historique** : ligne du temps, résumés journaliers et hebdomadaires,
  correction de toute entrée.
- **Multi-appareils** : les téléphones des deux aidants se synchronisent en
  temps réel (Server-Sent Events) sur le LAN.
- **Vos données** : exports CSV et JSON, snapshot SQLite, restauration.

Le détail complet du design : `docs/plans/2026-08-23-newborn-tracker-design.md`.

## Stack

- Monolithe TypeScript **SvelteKit** (interface + API dans un seul processus).
- **SQLite** en mode WAL dans un volume persistant — un seul fichier à sauvegarder.
- **Tailwind CSS v4** + **shadcn-svelte** pour un design system à base de tokens.
- **Docker Compose** pour l'installation ; image multi-arch (arm64 + amd64) sur GHCR.

Les décisions structurantes sont consignées dans `docs/adr/`.

## Installation

Sur n'importe quelle machine avec Docker (Raspberry Pi 4+ inclus) :

```sh
mkdir swaddle && cd swaddle
curl -fsSLO https://raw.githubusercontent.com/MacroMan5/swaddle/main/deploy/docker-compose.yml
docker compose pull && docker compose up -d
```

Le Compose fonctionne avec des valeurs publiques par défaut. Pour choisir une
version, un port, un fuseau ou un emplacement de données propres au serveur,
utilisez le fichier local `.env` décrit dans le
[guide de déploiement](deploy/README.md).

Au premier lancement, ouvrez `http://<ip-du-serveur>:3010` (ou le port défini
par `SWADDLE_PORT`) : l'assistant de démarrage vous guide pour créer le profil
du bébé et le premier aidant. Les données vivent par défaut dans `./data/`
(`SWADDLE_DATA_DIR`) — sauvegardez ce dossier, c'est tout (export JSON/CSV et
sauvegarde/restauration SQLite documentés dans
[`docs/api/settings-api.md`](docs/api/settings-api.md)).

**Important** : l'application est conçue pour un réseau local privé. Ne
l'exposez pas directement à Internet (voir ADR 0001).

Code PIN oublié ? Voir
[`docs/runbooks/pin-reset.md`](docs/runbooks/pin-reset.md).

Astuce : si vous avez Pi-hole, un enregistrement DNS local (ex. `bebe.home`)
donne une adresse facile à retenir sur tous les téléphones de la maison.

## Développement

Prérequis : Node 22+ et Docker (pour l'image de production).

```sh
npm ci --ignore-scripts   # better-sqlite3 utilise ses prebuilds N-API
npm run dev               # serveur de développement Vite
npm run check             # svelte-check (types + diagnostics)
npm run test:unit         # tests unitaires Vitest
npx playwright install chromium   # une fois, avant les e2e
npm run test:e2e          # tests e2e Playwright (build de prod + navigateur)
npm run build             # build de production (adapter-node → build/)
docker build -t swaddle .          # image de production
```

Les données de développement vivent sous `data/` (variable `DATA_DIR`), jamais
versionnées.

## Contribuer

Les contributions sont bienvenues — voir [CONTRIBUTING.md](CONTRIBUTING.md).
Les bugs et idées passent par les issues GitHub.

## Licence

[PolyForm Noncommercial License 1.0.0](LICENSE) — usage non commercial
uniquement. Voir le texte complet de la licence et [la page officielle](https://polyformproject.org/licenses/noncommercial/1.0.0).
