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
docker compose pull && docker compose up -d
```

Variables prises en charge :

| Variable | Valeur publique par défaut | Usage |
| --- | --- | --- |
| `SWADDLE_IMAGE` | `ghcr.io/macroman5/swaddle:v0.1.0` | Image versionnée à déployer |
| `SWADDLE_PORT` | `3010` | Port exposé sur le réseau local |
| `SWADDLE_DATA_DIR` | `./data` | Répertoire persistant de SQLite |
| `TZ` | `UTC` | Fuseau horaire du conteneur |

Un chemin relatif dans `SWADDLE_DATA_DIR` est résolu depuis `deploy/`. Un
chemin absolu peut être utilisé pour placer les données sur un disque dédié.

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
