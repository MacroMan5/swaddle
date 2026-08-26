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
data_dir="$(grep -E '^SWADDLE_DATA_DIR=' .env | cut -d= -f2-)"
mkdir -p "${data_dir:-./data}" && sudo chown -R 1000:1000 "${data_dir:-./data}"
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
data_dir="$(grep -E '^SWADDLE_DATA_DIR=' .env | cut -d= -f2-)"
mkdir -p "${data_dir:-./data}" && sudo chown -R 1000:1000 "${data_dir:-./data}"
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
data_dir="$(grep -E '^SWADDLE_DATA_DIR=' .env | cut -d= -f2-)"
sudo chown -R 1000:1000 "${data_dir:-./data}"
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
| `SWADDLE_BODY_SIZE_LIMIT` | `10M` | Taille maximale d'une requête (`BODY_SIZE_LIMIT`) |
| `SWADDLE_ORIGIN` | *(aucune, requise)* | URL utilisée par les navigateurs pour joindre l'app (`ORIGIN`) |

`SWADDLE_BODY_SIZE_LIMIT` borne la taille des requêtes acceptées, et donc
celle d'un export JSON restaurable via **Réglages → Restaurer depuis un
fichier…**. La valeur par défaut (10 Mo) est la même que celle appliquée par
l'application elle-même : un fichier plus gros est refusé avec un message
clair, sans toucher aux données ni créer d'instantané. Ne la baissez pas
en dessous de la taille de vos exports ; l'augmenter au-delà de 10 Mo n'a
pas d'effet, la limite applicative reste prioritaire.

Un chemin relatif dans `SWADDLE_DATA_DIR` est résolu depuis le dossier qui
contient `docker-compose.yml` (`deploy/` dans un clone du dépôt). Un chemin
absolu peut être utilisé pour placer les données sur un disque dédié.

Pour des réglages Compose plus avancés, créez
`docker-compose.override.yml` dans ce dossier. Les overrides reconnus et les
données sous `deploy/data/` sont également ignorés par Git.

## Origine (`SWADDLE_ORIGIN`) : pourquoi elle est requise

adapter-node (le serveur SvelteKit de l'image) doit connaître l'URL exacte que
les navigateurs du foyer utilisent pour joindre l'app, sans quoi il suppose
`https`. Le cookie de session du code PIN (`src/lib/server/settings/auth.ts`)
suit ce protocole supposé pour son attribut `Secure` ; sur ce déploiement, qui
reste en HTTP sur le LAN (ADR 0001), un cookie marqué `Secure` à tort n'est
jamais renvoyé par le navigateur et le déverrouillage PIN boucle
indéfiniment. Chrome tolère cette confusion sur `localhost` mais pas sur une
adresse LAN ni sur `swaddle.home` ; Safari/WebKit et Chrome mobile l'appliquent
strictement partout (issue #69). `SWADDLE_ORIGIN` fixe cette URL sans
ambiguïté : `docker-compose.yml` la transmet telle quelle via `ORIGIN`, la
variable qu'adapter-node consulte en priorité — pas besoin de faire passer un
en-tête de protocole par un éventuel reverse proxy. Elle est donc **requise** :
sans elle, `docker compose up` échoue immédiatement plutôt que de démarrer
avec un cookie silencieusement cassé.

Valeur à utiliser selon votre façon d'accéder à l'app — l'URL doit correspondre
exactement à ce que la barre d'adresse du navigateur affiche (schéma, hôte,
port) :

- **Accès direct par le port** (pas de reverse proxy) :
  `SWADDLE_ORIGIN=http://<ip-ou-nom-du-pi>:3010` (le port `SWADDLE_PORT`, pas
  le port interne `3000` du conteneur).
- **Derrière le vhost nginx `swaddle.home`** (déploiement de référence) :
  `SWADDLE_ORIGIN=http://swaddle.home` — le port 80 par défaut, donc pas de
  suffixe `:port`. Le vhost n'a besoin d'aucun `proxy_set_header` de protocole
  supplémentaire ; le seul réglage nginx documenté par l'ADR 0002 pour ce
  service reste `proxy_buffering off` (nécessaire aux Server-Sent Events).
  Exemple minimal :

  ```nginx
  server {
      listen 80;
      server_name swaddle.home;

      location / {
          proxy_pass http://127.0.0.1:3010;
          proxy_set_header Host $host;
          proxy_buffering off;
      }
  }
  ```

Si vous accédez à l'app par les deux chemins à la fois (port direct **et**
vhost), choisissez lequel des deux est votre usage principal et configurez
`SWADDLE_ORIGIN` en conséquence : l'app fonctionnera par l'autre chemin aussi
(le cookie reste correctement non-`Secure` en HTTP dans les deux cas), mais ce
n'est pas un usage testé ni recommandé.

### Déploiement HTTPS

Si vous mettez un jour ce service derrière TLS (par ex. un reverse proxy avec
certificat), pointez simplement `SWADDLE_ORIGIN` vers l'URL `https://` du
public : `ORIGIN` a un schéma explicite, donc le cookie de session redevient
`Secure` automatiquement, sans autre changement.

## Mise à jour

Une installation faite avant l'ajout de `SWADDLE_ORIGIN` (issue #69) n'a pas
cette variable dans son `.env` : ajoutez-la (voir la section précédente) avant
de mettre à jour, sinon `docker compose up` échoue au démarrage.

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
