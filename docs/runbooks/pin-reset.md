# Réinitialiser le code PIN

Si le code PIN est oublié, il n'existe aucun moyen de le récupérer depuis
l'interface (le hash est à sens unique). La seule procédure est une
intervention directe sur la base de données, côté serveur.

## Procédure

1. Arrêter le conteneur applicatif :

   ```sh
   docker compose stop swaddle
   ```

2. Ouvrir le fichier SQLite (`data/swaddle.db` par défaut, ou le chemin
   configuré via `DATA_DIR`) et vider le hash du code PIN :

   ```sh
   sqlite3 data/swaddle.db "UPDATE household SET pin_hash = NULL"
   ```

3. Redémarrer le conteneur :

   ```sh
   docker compose start swaddle
   ```

L'application redémarre sans code PIN actif (FR-015) ; toute session
existante était de toute façon déjà invalidée par la suppression du hash
(`swaddle_session` est dérivé de `pin_hash`). Un nouveau code peut ensuite
être défini depuis Réglages → Code PIN.
