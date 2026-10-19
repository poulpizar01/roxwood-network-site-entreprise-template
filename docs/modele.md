# Modèle de site d'entreprise RP — Roxwood Network

Base réutilisable pour les sites des entreprises RP : une **vitrine** publique et un **espace de gestion** réservé aux employés (connexion Discord), servis par le même serveur Node (Express + PostgreSQL), déployés avec Docker derrière nginx.

Contrairement au [modèle des sites famille](https://github.com/poulpizar01/roxwood-network-site-famille-template), où l'espace membre est le même partout, chaque entreprise a une gestion différente (stocks, factures, rendez-vous, recrutement…). Ce modèle impose donc moins de choses : un **socle** commun — sécurité, connexion, comptes, grades et permissions, stockage des images, réception des webhooks du bot, Docker, nginx, sauvegardes, règles de code — et laisse **libres la vitrine comme la gestion**.

## Ce qui est commun, ce qui est propre à chaque site

| | **Socle — mutualisé, identique sur tous les sites** | **Entreprise — personnalisable, site par site** |
|---|---|---|
| Quoi | Serveur et sécurité, connexion Discord, comptes, grades et permissions, stockage d'images, webhooks du bot, base, déploiement, documentation, règles | La vitrine, la direction artistique, **toutes les pages de gestion**, les routes et les tables métier |
| Fichiers | `server/src/index.ts`, `server/src/socle/`, `server/prisma/schema/socle.prisma` (+ migrations `*_socle_*`), `server/Dockerfile`, `server/package.json`, `server/deploy/`, `socle/`, `compose*.yaml`, `.env.example`, `docs/`, `.claude/skills/`, `CLAUDE.md` | `site.json`, `theme.css`, `index.html`, `404.html`, `confidentialite.html`, `assets/`, `gestion/`, `server/src/entreprise/`, `server/prisma/schema/entreprise.prisma`, `ENTREPRISE.md`, `README.md` |
| Liberté | Aucune modification dans un site : les améliorations se font **dans le modèle**, puis chaque site les récupère | Totale, dans le respect des règles du socle (voir [CLAUDE.md](../CLAUDE.md)) |

Ce que le socle apporte, prêt à l'emploi :
- **Connexion Discord** réservée aux membres du serveur Discord de l'entreprise, comptes en attente de validation, propriétaire du serveur Discord avec tous les droits ;
- **Grades et permissions** : chaque grade coche des permissions (celles du socle et celles que déclare l'entreprise), peut être lié à un rôle Discord (attribué et retiré à la connexion) ; personne ne gère ce qui est au-dessus de lui ni n'accorde ce qu'il n'a pas ;
- **Contrôle d'accès** des pages et des routes côté serveur, politique de sécurité stricte (CSP à nonce), protection contre les requêtes d'un autre site, limites de requêtes ;
- **Images** : contrôle, réencodage WebP et dépôt sur le stockage distant (CDN) ;
- **Webhooks du bot Discord entreprise** ([roxwood-network-entreprise](https://github.com/poulpizar01/roxwood-network-entreprise)) : signature vérifiée, dédoublonnage, branchement sur le code de l'entreprise ;
- **Exploitation** : Docker (site, base, sauvegardes quotidiennes), nginx + HTTPS, plusieurs sites sur un même VPS, contrôle de santé, arrêt propre ;
- **Règles et outils** pour Claude Code : [CLAUDE.md](../CLAUDE.md), commande `/audit`.

Et un **point de départ** côté entreprise, à transformer : une vitrine sobre, une gestion avec connexion, accueil, mon compte, comptes, grades, un agenda complet (événements personnels, d’équipe et par grade, types et droits exacts dans la fiche des grades) et un exemple métier (annonces internes).

En bas de chaque vitrine : la signature **« Développé par Roxwood Network »** (à garder, style dans `socle/signature.css`).

## Créer un nouveau site
1. **Nouveau dépôt** : sur GitHub, bouton **Use this template** → nom du dépôt du site. Le cloner sur le poste.
2. **Identité** : remplir [`site.json`](../site.json). `nom` et `description` sont obligatoires, `couleur` (accent, `#rrggbb`) facultative ; le lien d’invitation au Discord de l’entreprise ne s’écrit pas ici : il se règle dans la gestion, Paramètres → Liens ; toute autre clé texte est libre (`slogan`, `secteur`, `adresse`, `horaires`…). Dans une page, `{{cle}}` insère la valeur, `{{Cle}}` la même avec une majuscule, `{{url}}` l'adresse du site (`BASE_URL`).
3. **Direction artistique** : [`theme.css`](../theme.css) (couleurs, polices dans `assets/fonts/`, formes), chargé par toutes les pages. Puis la vitrine ([`index.html`](../index.html), [`assets/css/styles.css`](../assets/css/styles.css)) et la gestion ([`gestion/`](../gestion/)) : libres.
4. **Visuels** (dans `assets/`) : `logo.png` (carré, fond transparent), `favicon.png`, `og-image.jpg` (1200 × 630). Ne pas toucher à `roxwood.png`.
5. **Métier** : déclarer les permissions dans [`server/src/entreprise/permissions.ts`](../server/src/entreprise/permissions.ts), les tables dans [`entreprise.prisma`](../server/prisma/schema/entreprise.prisma), les routes dans `server/src/entreprise/routes/`, et brancher le tout dans [`server/src/entreprise/index.ts`](../server/src/entreprise/index.ts) (niveau d'accès des pages, routes, webhooks, liens et réglages de la page Paramètres). L'exemple « annonces » montre chaque étape ; le garder, le transformer ou le retirer (supprimer le modèle `Annonce`, la route, la page, puis créer une migration).
6. **Notes** : réécrire [`README.md`](../README.md) (présentation du site, pour qui ouvre le dépôt) et [`ENTREPRISE.md`](../ENTREPRISE.md) (ce que fait le site, ses tables, ses pièges) et compléter [`confidentialite.html`](../confidentialite.html) avec ce que le site enregistre.
7. **Déployer** : [server/README.md](../server/README.md).

### Ajouter une table ou une colonne au socle (dans le modèle)

Le modèle n'a pas toujours de base de dev sous la main : on fait générer le SQL exact par Prisma depuis le conteneur d'un site à jour, sans toucher à sa base.

```bash
# dans le modèle : modifier server/prisma/schema/socle.prisma, puis, depuis un site (conteneur <site>-app) :
docker exec <site>-app sh -c 'rm -rf /tmp/sch && mkdir /tmp/sch && cp /app/server/prisma/schema/*.prisma /tmp/sch/'
docker cp <modèle>/server/prisma/schema/socle.prisma <site>-app:/tmp/sch/socle.prisma
docker exec -w /app/server <site>-app npx prisma migrate diff --from-schema prisma/schema --to-schema /tmp/sch --script
```

Copier la sortie dans `server/prisma/migrations/<AAAAMMJJHHMMSS>_socle_<description>/migration.sql` du modèle (`_socle_` dans le nom : c'est ce qui la distingue de celles des sites). Une fois fusionné dans le site, `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` doit répondre « empty migration ». Pas d'opération qui exige un super-utilisateur (la prod migre avec `site_app`).

### Récupérer plus tard les améliorations du socle
```bash
git remote add modele https://github.com/poulpizar01/roxwood-network-site-entreprise-template.git   # une seule fois
git fetch modele && git merge modele/main --allow-unrelated-histories                               # --allow-… : la première fois seulement
```
Les conflits éventuels ne portent que sur les fichiers personnalisables (`site.json`, `theme.css`, `gestion/`, `server/src/entreprise/`…) : y garder la version du site. Une nouvelle migration du socle arrive avec la mise à jour : la prod l'applique au démarrage ; en dev, `docker compose exec app npx prisma migrate dev` (s'il propose de remettre la base de dev à zéro, accepter). Un site qui a modifié un fichier du socle perd cette garantie : corriger plutôt dans le modèle.

## Documentation
| Sujet | Où |
|---|---|
| Règles du socle, conventions, pièges (pour Claude Code et les développeurs) | [CLAUDE.md](../CLAUDE.md) |
| Présentation du site | [README.md](../README.md) |
| Notes propres au site (pour Claude Code et les développeurs) | [ENTREPRISE.md](../ENTREPRISE.md) |
| Le modèle : socle et entreprise, création d'un site, mises à jour, développement | ce document |
| Déployer sur un VPS, mettre à jour, sauvegarder, revenir en arrière, application Discord | [server/README.md](../server/README.md) |
| API du socle (routes, droits, limites) et ajout de routes par l'entreprise | [docs/api.md](api.md) |
| Webhooks du bot Discord entreprise | [docs/webhooks.md](webhooks.md) |
| nginx : HTTPS, rôle de chaque réglage, plusieurs sites, dépannage | [docs/nginx.md](nginx.md) |
| Stockage des images (disque ou CDN), contrat attendu du service | [docs/stockage.md](stockage.md) |
| Ordinateur en jeu (FolkOS) : affichage en iframe, connexion « IG » | [docs/folkos.md](folkos.md) |
| Audits par angle : prompts, commande `/audit` dans Claude Code | [docs/audits.md](audits.md) |

## Développement
Prérequis : Docker Desktop.
```bash
docker compose up          # http://localhost:3000  ·  gestion : http://localhost:3000/gestion/
```
- Créer un `.env` à la racine (ignoré par git) contenant au moins `SITE_ID=<nom du site>` : sans lui, le projet Docker s'appelle `site`, et deux sites en dev partageraient la même base. Ne pas copier `.env.example` (sa ligne `COMPOSE_FILE` désactive les réglages de dev).
- Connexion sans Discord (bouton de connexion → compte « Dev local », propriétaire, tous les droits). Pour essayer un autre niveau d'accès : `http://localhost:3000/auth/discord?compte=<ID Discord>` ouvre la session d'un compte existant (dev uniquement).
- Pages, CSS, JS et `site.json` : rafraîchir le navigateur suffit. Serveur (`server/src`) : `docker compose restart app`.
- Base : après une modification de `server/prisma/schema/entreprise.prisma`, `docker compose exec app npx prisma migrate dev --name <description>`, et **committer le dossier de migration créé**. `docker compose down -v` remet la base à zéro.
- Tests : `docker compose exec -w /app/server app npm test` (`server/test/` : `socle-*.test.ts` pour le socle, le reste pour le site).
- Tester les webhooks du bot en local : voir [docs/webhooks.md](webhooks.md#tester-en-local).

## Organisation
- `README.md` — présentation du site ; `site.json` — identité ; `theme.css` — couleurs et polices ; `ENTREPRISE.md` — notes du site
- `index.html`, `404.html`, `confidentialite.html`, `robots.txt`, `sitemap.xml` — pages de la vitrine (toujours à la racine : seul niveau servi)
- `gestion/` — espace employés (pages libres ; `index`, `attente`, `refuse`, `accueil` : noms imposés)
- `socle/` — scripts et styles communs servis au navigateur (`socle.js`, `signature.css`)
- `assets/` — logo, favicon, image de partage, logo Roxwood ; `assets/js/` et `assets/css/` — scripts et feuilles de la vitrine ; `assets/img/` — illustrations ; `assets/fonts/`, `assets/vendor/` — polices, bibliothèques
- `server/src/socle/` — socle du serveur ; `server/src/entreprise/` — code métier du site ; `server/src/index.ts` — assemblage
- `server/prisma/schema/` — `socle.prisma` + `entreprise.prisma` ; `server/prisma/migrations/` — migrations des deux
- `server/test/` — tests (`socle-*.test.ts` : socle ; les autres : site)
- `server/deploy/` — configuration nginx ; `compose.yaml` — site, base et sauvegardes ; `compose.override.yaml` — dev
- `docs/` — documentation ; `.claude/skills/` — commandes Claude Code (`/audit`)
