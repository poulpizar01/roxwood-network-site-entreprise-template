# Installation de <entreprise> — guide pour la personne qui installe

<!-- ENTREPRISE — guide d'installation propre au site (server/README.md, « Installer le site »). Le modèle n'en donne
que le squelette : chaque site remplit les « à compléter » et retire ce qui ne le concerne pas.
Remplacer <entreprise> par son nom (ce fichier n'est pas servi par le site). -->

Ce guide complète [`server/README.md`](../server/README.md), qui décrit l'installation commune à tous les sites du réseau (VPS, Docker, nginx, certificat, sauvegardes). Ici : seulement ce qui est propre à ce site. Chez Flashback FA, l'opérateur installe le site et remplit le `.env` lui-même ([docs/guide-dev-fbfa.md](../docs/guide-dev-fbfa.md), A1).

## 1. Qui fournit quoi

| Élément | Fourni par | Où il va |
|---|---|---|
| Domaine (sous `*.fbfa.fr`), port, base de données | l'opérateur | `BASE_URL`, `HOST_PORT`, `POSTGRES_*` (`.env`) |
| Application Discord (identifiant, secret) et bot | l'opérateur | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` |
| ID du serveur Discord de l'entreprise | l'entreprise | `DISCORD_GUILD_ID` |
| ID Discord des super-admins | l'entreprise | `SUPER_ADMIN_DISCORD_IDS` |
| Stockage des images (adresse, jeton) | l'opérateur | `STORAGE_URL`, `STORAGE_TOKEN`, `STORAGE_PREFIX` |
| Ordinateur en jeu et connexion « IG » | l'opérateur | `FOLKOS_*` (section 4) |
| *à compléter : autre service propre au site* | | |

## 2. Variables propres au site

Dernière section de [`.env.example`](../.env.example). *À compléter : chaque variable, sa valeur attendue, qui la fournit — ou « aucune ».*

## 3. Discord

**Adresses de retour (OAuth2 → Redirects)** à déclarer dans l'application :
- `https://<domaine>/auth/discord/callback` — connexion à la gestion ;
- *à compléter : toute autre adresse de retour du site, ou rien.*

**Bot** : inviter sur le serveur de l'entreprise (OAuth2 → URL Generator, scope `bot`) avec ces droits :
- aucun pour le socle (lecture des rôles et des membres) ;
- *à compléter : chaque droit ajouté par le site, avec ce qui s'en sert.*

**Salons et catégories utilisés** : *à compléter, ou « aucun ».* Ils se choisissent ensuite dans Gestion → Paramètres, pas dans le `.env`.

## 4. Ordinateur en jeu (FolkOS)

*À retirer si le site ne s'affiche pas en jeu.* Détail : [docs/folkos.md](../docs/folkos.md).

- `FOLKOS_HOTE` : origine de l'ordinateur en jeu, fournie par l'opérateur.
- `FOLKOS_CADRES=https://*.fbfa.fr https://fbfa.fr`.
- Connexion « IG » : `FOLKOS_ID_BASE`, `FOLKOS_CLIENT_ID`, `FOLKOS_CLIENT_SECRET`, avec :
  - `BASE_URL` sous `*.fbfa.fr` (le cookie secret du ticket n'est envoyé qu'à ce domaine) ;
  - le scope **`discord`** accordé au client (le compte est retrouvé par son ID Discord ; les autres scopes ne servent pas) ;
  - l'adresse à déclarer : `https://<domaine>/auth/folkos` (et non `/api/folkos`).

## 5. Après la mise en ligne

Ordre commun (super-admin, grades, employés) : [`server/README.md`](../server/README.md), « Première connexion ». Puis, propre à ce site :
1. *À compléter : réglages de Gestion → Paramètres, onglet par onglet.*
2. *À compléter : abonnements aux webhooks du bot, s'il y en a (Gestion → Webhooks → Abonnements).*

## 6. Vérifications

| Vérifier | Résultat attendu |
|---|---|
| `docker logs <SITE_ID>-app` | se termine par `en écoute sur le port 3000 (https://<domaine>)` |
| Connexion Discord à `https://<domaine>/gestion/` | le super-admin arrive sur l'accueil |
| Connexion depuis l'ordinateur en jeu (si utilisé) | arrivée sur l'accueil ; aucune ligne `[FolkOS] refus` dans les journaux (sinon, son champ `nonce_check` dit pourquoi) |
| *à compléter* | |

## 7. Liste de contrôle

- [ ] Liste commune de [`server/README.md`](../server/README.md) cochée
- [ ] Adresses de retour Discord déclarées (section 3)
- [ ] Bot invité avec les droits de la section 3
- [ ] Ordinateur en jeu : `BASE_URL` sous `*.fbfa.fr`, scope `discord`, `/auth/folkos` déclaré (si utilisé)
- [ ] Réglages et abonnements de la section 5 faits
- [ ] Vérifications de la section 6 au résultat attendu
