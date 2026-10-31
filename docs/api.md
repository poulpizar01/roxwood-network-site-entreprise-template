# API du site

L'API du **socle** (identique sur tous les sites) et la façon d'y ajouter celle de l'**entreprise**. Toutes les réponses sont en JSON.

Une requête qui modifie quelque chose (`POST`, `PATCH`, `PUT`, `DELETE`) n'est acceptée que depuis les pages du site : un en-tête `Origin` différent de `BASE_URL` reçoit `403 { error: "origine refusée" }`. Un identifiant illisible dans l'adresse (`/api/comptes/abc`) donne `404`, une adresse `/api/…` inconnue aussi. Authentification par **cookie de session** (`site.sid`, `HttpOnly`, `Secure` en HTTPS, 7 jours : au-delà, nouvelle connexion Discord, qui revérifie l'appartenance au serveur, le grade et la propriété).

Les messages d'erreur destinés à l'utilisateur sont des phrases (`{ error: "Grade inconnu." }`) ; les codes techniques sont en minuscules à tirets (`non-connecte`, `attente`, `interdit`) — `socle.api()` affiche les premières telles quelles et traduit les seconds.

## Niveaux d'accès
| Garde (`socle/http.ts`) | Condition | Refus |
|---|---|---|
| — (public) | aucune | — |
| `...connecte` | session ouverte (compte éventuellement en attente ou refusé) | `401 non-connecte` |
| `...valide` | compte **validé** | `401` / `403 { error: "attente", statut }` |
| `...permission('cle')` | compte validé **et** permission `cle` (par son grade, ou super-admin) | `403 { error: "interdit", permission }` |

Pages de `gestion/` : mêmes niveaux, contrôlés par le serveur avant tout envoi (`server/src/index.ts`, d'après `entreprise.pages`) : pas connecté → `gestion/` (connexion) ; compte pas validé → `attente.html` ; permission manquante → `403` avec `refuse.html`. Page non déclarée : compte validé.

## Permissions et grades
- Permissions du socle : `comptes` (valider, refuser, renommer, changer de grade, supprimer un compte), `grades` (créer, ordonner, modifier, supprimer un grade) et `parametres` (page Paramètres : liens et réglages déclarés par l'entreprise). Celles de l'entreprise : `server/src/entreprise/permissions.ts`.
- **Hiérarchie** : les grades sont ordonnés du sommet (position 0) à la base. Hors propriétaire, on ne gère que les comptes et les grades **strictement sous** son propre grade (un compte sans grade ne gère rien), et on n'accorde ou ne retire que des permissions qu'on détient.
- **Droits d’agenda** : les droits sur les événements adressés à un grade ciblent des clés exactes, sans héritage hiérarchique. Créer et modifier nécessitent également le droit de consulter ce grade. Pour les événements de toute l’équipe, consultation et gestion (créer, modifier, supprimer) sont deux droits distincts.
- **Rôles Discord** : un grade peut être lié à un rôle Discord. À chaque connexion (et toutes les 10 minutes si le site a un jeton de bot, `socle/synchro-discord.ts` : un membre parti du serveur y est déconnecté et marqué `quitteLe`), le compte reçoit le plus haut grade dont il porte le rôle (et est validé d'office s'il n'avait pas été refusé) ; un grade lié à un rôle qu'il ne porte plus lui est retiré. Un grade sans rôle se donne à la main.

## Routes du socle
| Méthode et adresse | Accès | Rôle |
|---|---|---|
| `GET /auth/discord` | public | Démarre la connexion Discord (en dev avec `DEV_LOGIN=1` : connexion directe au compte « Dev local », ou `?compte=<ID Discord>`) |
| `GET /auth/discord/callback` | public | Retour de Discord : vérifie l'appartenance au serveur, crée ou met à jour le compte, son grade, son statut ; erreurs renvoyées à `gestion/?erreur=pas-membre\|oauth\|jeton\|discord\|serveur` |
| `GET /auth/folkos` | public | Connexion « IG » depuis l'ordinateur en jeu (si FolkOS est configuré, voir [folkos.md](folkos.md)) : `?folkos_ticket=` vérifié auprès du SSO, compte retrouvé par son ID Discord, `?next=` (chemin du site) honoré ; erreurs renvoyées à `gestion/?erreur=folkos-config\|ticket\|reseau\|inconnu\|discord\|serveur` |
| `POST /auth/logout` | public | Ferme la session |
| `GET /api/moi` | connecté | Mon compte : `id, discordId, pseudo, nom, avatar, statut, proprietaire, grade { cle, libelle, couleur }, permissions[]` (vide tant que le compte n'est pas validé) |
| `PATCH /api/moi` | validé | Changer son nom RP (`{ nom }`) |
| `DELETE /api/moi` | connecté | Supprimer son propre compte (validé ou en attente ; `403` pour un compte refusé), après `avantSuppressionCompte`, puis fin de session |
| `GET /api/permissions` | validé | Toutes les permissions : `[{ cle, libelle, description, domaine }]` (domaine : titre de rangement dans la page Grades, facultatif) |
| `GET /api/annuaire` | validé | Comptes validés, du sommet à la base : `[{ id, nom, avatar, grade }]` |
| `GET /api/comptes` | `comptes` | Tous les comptes (en attente, validés, refusés), les plus récents d'abord |
| `PATCH /api/comptes/:id` | `comptes` | `{ statut?: "valide"\|"refuse"\|"attente", nom?, grade?: cle\|null }` — compte sous son grade, vers un grade sous le sien ; ni son propre compte, ni celui du propriétaire (sauf par lui) |
| `DELETE /api/comptes/:id` | `comptes` | Supprimer un compte sous son grade (pas le sien) |
| `GET /api/grades` | validé | Grades du sommet à la base : `[{ cle, libelle, position, couleur, permissions[], roleDiscordId }]` |
| `GET /api/grades/roles-discord` | `grades` | Rôles du serveur Discord, lus sur Discord (du plus haut au plus bas, sans @everyone ni rôles de bots) : `{ configure, roles: [{ id, nom, couleur, position }], erreur? }`. `configure: false` sans `DISCORD_BOT_TOKEN` ; liste gardée 5 min |
| `POST /api/grades` | `grades` | `{ libelle, cle?, couleur?, permissions[], roleDiscordId? }` — créé en bas de la hiérarchie ; `409` si la clé ou le rôle est déjà pris ; un `roleDiscordId` exige aussi `comptes` (`403` sinon) |
| `PATCH /api/grades/:cle` | `grades` | Mêmes champs (sauf `cle`) ; grade sous le sien ; changer `roleDiscordId` exige aussi `comptes` |
| `PUT /api/grades/ordre` | `grades` | `{ ordre: [cle…] }` (tous les grades) ; hors propriétaire, les grades jusqu'au sien restent en place |
| `DELETE /api/grades/:cle` | `grades` | Grade sous le sien et porté par aucun compte (`409` sinon) |
| `GET /api/agenda?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ` | validé | `{ evenements, types, droits: { destinations, peut_inviter } }`. Les événements personnels sont visibles par leur auteur et les personnes invitées ; ceux partagés avec un grade restent réservés aux droits exacts de ce grade. |
| `GET /api/agenda/personnes` | validé | Comptes validés que le grade courant est autorisé à inviter : `{ personnes: [{ id, nom, discord: true }] }`. |
| `POST /api/agenda` | validé | Créer un événement `{ titre, jour, heure_debut, heure_fin, notes?, type_id?, destination, destination_grade?, invites_compte_ids? }`. `destination` : `perso`, `tous` ou `grade` ; les droits d’équipe, de grade et d’invitation sont vérifiés côté serveur. Réponse : `{ id, notifications, avertissements }`. |
| `PUT /api/agenda/:id` | validé | Modifier un événement visible et modifiable ; `invitation_ids` contient les invitations existantes à conserver (omis : toutes sont conservées) et `invites_compte_ids` ajoute des comptes validés. Déplacer la destination exige aussi le droit de création correspondant. Réponse : `{ ok, notifications, annulations, avertissements }`. |
| `DELETE /api/agenda/:id` | validé | Supprimer un événement que le compte peut modifier. Un événement invisible répond `404`. |
| `GET /api/agenda/types` | validé | Types de classement `{ types: [{ id, nom, couleur, position }] }`. |
| `POST /api/agenda/types`, `PUT /api/agenda/types/:id`, `DELETE /api/agenda/types/:id` | `agenda-types` | Gérer les types de classement. Supprimer un type ne supprime pas ses événements. |
| `GET /api/agenda/droits-grades` | `grades` | Droits précis de chaque grade : listes de clés pour consulter, créer et modifier ; droits d’équipe `consulter_tous` et `gerer_tous`. |
| `PUT /api/agenda/droits-grades/:cle` | `grades` | Remplacer les droits d’un grade inférieur : `{ consulter[], creer[], modifier[], consulter_tous, gerer_tous }`. Créer et modifier sont des sous-ensembles de consulter ; l’acteur ne peut accorder que ses propres droits. |

Les invitations concernent uniquement les événements personnels. Avec `DISCORD_BOT_TOKEN`, le site prévient les personnes dans leur ticket ouvert, si une catégorie est déclarée dans le réglage `agenda_categories_tickets`, sinon en message privé. Les échecs et les retraits qui n’ont pas pu être signalés sur Discord sont renvoyés dans `avertissements`.
| `GET /api/liens` | public | Liens publics réglés dans Paramètres : `{ cle: url }` (`''` si vide) ; lus par `socle.js` pour les `data-lien` |
| `GET /api/parametres` | `parametres` | Réglages déclarés par l'entreprise : `{ groupes: [{ titre, intro, onglet, reglages: [{ cle, type, libelle, aide, public, discord, valeur, min?, max?, defaut? }] }] }` (`discord` : `role`, `salon`, `categorie` ou `null`) |
| `GET /api/parametres/discord` | `parametres` | Rôles, salons et catégories du serveur Discord, pour les choisir par leur nom : `{ configure, roles: [{ id, nom, couleur }], salons: [{ id, nom, categorie, position }], categories: [{ id, nom, position }], erreur? }` ; `configure: false` sans `DISCORD_BOT_TOKEN` (cache 5 min) |
| `PUT /api/parametres` | `parametres` | `{ <cle>: valeur }` (seulement les clés envoyées ; `''` vide le réglage) ; tout ou rien : `400` avec le premier refus |
| `POST /webhooks/bot` | signature du bot | Réception des événements du bot entreprise : voir [webhooks.md](webhooks.md) |
| `GET /healthz` | public (bloqué par nginx) | Santé du site pour Docker : `{ ok: true }` ou `503` |

Les grandes listes renvoyées par ces routes restent à la taille d'une entreprise RP (quelques centaines de comptes au plus) : pas de pagination.

## Limites de requêtes
| Portée | Limite |
|---|---|
| Toute l'API `/api` | 240 requêtes par minute et par compte (ou par adresse IP hors connexion) |
| Connexion `/auth` | 30 tentatives par quart d'heure et par adresse IP |
| Webhooks `/webhooks/bot` | 120 par minute et par adresse IP |
| Envoi d'images (`...recevoirImage`) | 20 par compte toutes les 10 minutes |

Au-delà : `429` avec un message lisible. Les en-têtes `RateLimit` et `RateLimit-Policy` indiquent le quota restant. Toutes les réponses de `/api` et `/auth` portent `Cache-Control: no-store` (rien de personnel gardé par le navigateur). Une route de l'entreprise peut ajouter sa propre limite : `limiter(minutes, nombre, message, parCompte)`, à importer de `socle/limites.ts` (jamais de `socle/security.ts` depuis le code de l'entreprise : `security.ts` lit `entreprise.csp`, et l'importer depuis une route crée une dépendance circulaire qui empêche le serveur de démarrer).

## Ajouter les routes de l'entreprise
```ts
// server/src/entreprise/routes/stocks.ts
import { Router } from 'express';
import { prisma } from '../../socle/db.js';
import { body, entier, intParam, permission, text, valide } from '../../socle/http.js';

export const stocks = Router();
stocks.get('/api/stocks', ...valide, async (_req, res) => { res.json(await prisma.stock.findMany()); });
stocks.patch('/api/stocks/:id', ...permission('stocks'), async (req, res) => { /* req.compte : compte connecté */ });
```
Puis : la permission `stocks` dans `entreprise/permissions.ts`, le routeur dans `entreprise.routes`, la page dans `entreprise.pages`, et une ligne dans le tableau de `ENTREPRISE.md`.

Règles : adresses sous `/api/` (en français, au pluriel : `/api/factures/:id`) ; une garde en tête ; corps lus avec `body()` / `text()` / `entier()` ; `404` pour un identifiant inconnu (`intParam` rend `-1` pour un identifiant illisible) ; erreurs destinées à l'utilisateur en phrases ; aucune donnée renvoyée au-delà de ce que la page affiche.

Une route d'envoi d'image : `...permission('x'), ...recevoirImage`, puis `await enregistrerImage('dossier', req.file)` (voir `socle/images.ts` et [stockage.md](stockage.md)). Une image refusée lève `ImageRefusee`, transformée en `400` avec son message.
