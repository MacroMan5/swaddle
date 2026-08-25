# Déploiement Docker Compose

Le fichier `docker-compose.yml` est une base publique utilisable telle quelle.
Les valeurs propres à chaque serveur vivent dans `.env`, qui est ignoré par
Git. Le fichier `.env.example` documente les valeurs disponibles.

## Installation depuis le dépôt

Sur le serveur :

```sh
cd deploy
cp .env.example .env
${EDITOR:-vi} .env
mkdir -p "${SWADDLE_DATA_DIR:-./data}" && sudo chown -R 1000:1000 "${SWADDLE_DATA_DIR:-./data}"
docker compose config
docker compose pull
docker compose up -d
```

Pour une installation autonome sans clone Git, téléchargez les deux fichiers
publics avant de créer `.env` :

```sh
mkdir swaddle && cd swaddle
curl -fsSLO https://raw.githubusercontent.com/MacroMan5/swaddle/main/deploy/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/MacroMan5/swaddle/main/deploy/.env.example
cp .env.example .env
${EDITOR:-vi} .env
mkdir -p "${SWADDLE_DATA_DIR:-./data}" && sudo chown -R 1000:1000 "${SWADDLE_DATA_DIR:-./data}"
docker compose pull && docker compose up -d
```

## Permissions du répertoire de données

Le conteneur tourne sous un utilisateur fixe non root (`node`, uid/gid `1000`,
intégré à l'image `node:22-slim`) : il ne peut écrire que dans
`SWADDLE_DATA_DIR`. Le répertoire de données monté doit donc appartenir à
`1000:1000` sur l'hôte *avant* le premier `docker compose up` — Docker crée
sinon le dossier en tant que `root`, ce qui bloque l'ouverture de la base au
démarrage. Les commandes d'installation ci-dessus incluent cette étape
(`mkdir -p` + `chown -R 1000:1000`) ; sur un hôte sans `sudo` disponible,
créez et chownez le dossier avec les privilèges appropriés avant de lancer
Compose.

### Migration d'une installation existante (données appartenant à `root`)

Les déploiements antérieurs à ce changement font tourner le conteneur en
`root`, donc `SWADDLE_DATA_DIR` (ex. `~/swaddle/data` sur le Raspberry Pi de
référence) appartient à `root:root`. Avant de passer à une image qui inclut
ce correctif, sur le serveur :

```sh
cd ~/swaddle   # ou le dossier contenant votre docker-compose.yml
docker compose stop swaddle
sudo chown -R 1000:1000 "${SWADDLE_DATA_DIR:-./data}"
docker compose pull
docker compose up -d
```

Arrêter le service avant le `chown` évite de modifier les fichiers WAL sous
un processus encore actif. Vérifiez ensuite que l'application répond
normalement et que les données existantes sont toujours visibles.

Variables prises en charge :

| Variable | Valeur publique par défaut | Usage |
| --- | --- | --- |
| `SWADDLE_IMAGE` | `ghcr.io/macroman5/swaddle:v0.1.0` | Image versionnée à déployer |
| `SWADDLE_PORT` | `3010` | Port exposé sur le réseau local |
| `SWADDLE_DATA_DIR` | `./data` | Répertoire persistant de SQLite |
| `TZ` | `UTC` | Fuseau horaire du conteneur |

Un chemin relatif dans `SWADDLE_DATA_DIR` est résolu depuis le dossier qui
contient `docker-compose.yml` (`deploy/` dans un clone du dépôt). Un chemin
absolu peut être utilisé pour placer les données sur un disque dédié.

Pour des réglages Compose plus avancés, créez
`docker-compose.override.yml` dans ce dossier. Les overrides reconnus et les
données sous `deploy/data/` sont également ignorés par Git.

## Mise à jour

Modifiez `SWADDLE_IMAGE` dans `.env` pour choisir un nouveau tag versionné,
puis lancez :

```sh
docker compose pull
docker compose up -d
```

N'utilisez pas `:latest` : les migrations SQLite doivent rester associées à
une mise à jour volontaire.

## Sauvegarde

Privilégiez la sauvegarde SQLite proposée dans les réglages de l'application.
Pour copier directement le répertoire de données, arrêtez d'abord le service
afin de conserver ensemble la base et ses fichiers WAL :

```sh
docker compose stop swaddle
# Copiez le répertoire indiqué par SWADDLE_DATA_DIR.
docker compose start swaddle
```

Le service est destiné à un réseau local privé et ne doit pas être exposé
directement à Internet.
