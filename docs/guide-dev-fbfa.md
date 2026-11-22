# Guide du développeur FBFA

Tout ce qu'il faut pour **faire héberger un site chez FBFA** et, si besoin, **l'afficher en jeu**,
réuni dans un seul fichier. Il sert à créer un nouveau site comme à mettre à jour un site existant.

Ce guide ne contient aucun secret, aucune adresse de serveur et aucun détail d'infrastructure. Les
valeurs entre chevrons (`<HÔTE_FOLKOS>`…) vous sont données en privé par l'opérateur.

❌ = refusé à l'analyse ou cassé en jeu · ✅ = ce qu'on attend.

---

## Par où commencer

| Votre site | À lire |
|---|---|
| S'affiche **seulement dans un navigateur** (pas en jeu) | **Partie A** uniquement. Les règles FiveM ne vous concernent pas. |
| S'affiche **aussi en jeu** (tablette, ordinateur, écran, borne) | **Partie A** puis **Partie B** |
| Est **déjà hébergé** chez nous | Votre partie, puis la **Partie C** (ce qui a changé récemment) |

**Sommaire**

- 0 · Ce que l'opérateur vous fournit
- **Partie A · Héberger un site (tous les sites)**
  - A1 Comment ça se passe · A2 Le dépôt · A3 Le `.env` · A4 Le code · A5 Dépendances et scripts ·
    A6 Réseau et web · A7 Cookies et sessions · A8 Base de données · A9 Discord ·
    A10 Fichiers et images : l'API de stockage · A11 Liste de contrôle
- **Partie B · Afficher le site en jeu (sites en jeu seulement)**
  - B1 Le navigateur du jeu · B2 Aucun dialogue natif · B3 Autoriser l'iframe · B4 Cookies en jeu ·
    B5 Clavier et sortie : `fbfa-game.js` · B6 Suivre l'adresse : `fbfa-bridge.js` · B7 À éviter
  - B8 Connecter le joueur : FolkOS
  - B9 Parler au jeu : l'API `external-iframe` (`/leave`, `/typing`…)
  - B10 Optionnel : tablette à onglets et brouillons
  - B11 Liste de contrôle
- **Partie C · Site déjà en place : ce qui a changé**
- **Partie D · Prompts pour un assistant IA**

---

## 0. Ce que l'opérateur vous fournit

Rien de tout ceci n'est écrit dans ce guide. L'opérateur vous le donne en privé, au moment voulu.

| Élément | Pour qui | Sert à |
|---|---|---|
| Le domaine, le port, la base de données | tous | l'opérateur remplit le `.env` lui-même (A3) |
| L'application Discord (identifiant, secret) et le bot éventuel | sites avec Discord | A9 |
| `<HÔTE_STORAGE>` et un jeton | seulement si l'envoi de fichiers vous est accordé | A10 |
| `<HÔTE_FOLKOS>` | sites en jeu | l'**ordinateur en jeu** de FolkOS : il sert `fbfa-game.js` et `fbfa-bridge.js` (B5, B6) |
| `<PORTAIL_FOLKOS>` | sites en jeu | le **portail** FolkOS, qui ouvre votre site depuis les liens et les tablettes : il sert `folkos-tablette.js` (B10) |
| `FOLKOS_ID_BASE`, `FOLKOS_CLIENT_ID`, `FOLKOS_CLIENT_SECRET` et la liste de vos scopes | sites en jeu avec connexion | B8 |
| Un lien de démo | tests de connexion sans vrai joueur | B8.8 |
| La clé publique du jeton `?token=` | pages posées sur un point de jeu | B9.5 |

`<HÔTE_FOLKOS>` et `<PORTAIL_FOLKOS>` sont des **origines** : `https://hote.example`, sans chemin ni
barre finale. Le code les compare telles quelles.

Deux sortes de valeurs :

- **Les secrets** (secret FolkOS, jeton de stockage, secret et jeton Discord) restent **côté serveur** :
  jamais dans le dépôt, jamais envoyés au navigateur, jamais écrits dans les journaux.
- **Les adresses** (`<HÔTE_FOLKOS>`, `<PORTAIL_FOLKOS>`, `<HÔTE_STORAGE>`) sont publiques : elles
  apparaissent dans vos pages (`<script src>`, `<img src>`). Comme le domaine, elles viennent du `.env`
  (A3).

---

# Partie A · Héberger un site chez FBFA

**Pour tous les sites**, qu'ils s'affichent en jeu ou non.

## A1. Comment ça se passe

1. Vous envoyez le **dépôt GitHub complet**.
2. L'opérateur lit tout le code et vérifie les règles de cette partie. **Rien n'est lancé avant la fin
   de l'analyse.**
3. S'il y a des choses à corriger, il vous les demande.
4. Il choisit le domaine (sous `*.fbfa.fr`) et le port, crée la base, remplit le `.env` et installe le
   site en suivant votre README.
5. Chaque grosse mise à jour repasse par la même analyse.

## A2. Le dépôt

- ✅ Dépôt complet, avec le fichier de verrouillage des dépendances (`package-lock.json`,
  `pnpm-lock.yaml`…).
- ✅ Un README clair, qui donne :
  - l'installation, le build, le lancement et la mise à jour ;
  - les migrations de la base ;
  - la version de Node ou du langage ;
  - la base de données utilisée ;
  - s'il y a Discord : le chemin de callback à déclarer et, s'il y a un bot, ses droits et les salons
    qu'il utilise.
- ✅ Un `.env.example` commenté qui liste chaque variable.
- ❌ `.env`, secret ou dump de base dans le dépôt, **historique compris**. Un secret commité doit être
  régénéré : le retirer du dépôt ne suffit pas.

## A3. Le `.env` : tout ce qui peut changer

Tout ce qui peut changer est dans le `.env`, rien dans le code. Le domaine et le port sont choisis par
l'opérateur, qui doit pouvoir les modifier sans toucher au code.

```dotenv
# Adresse publique du site, sans barre finale
SITE_URL=https://monsite.fbfa.fr
# Port d'écoute
PORT=
# Connexion à la base
DATABASE_URL=
# Discord
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
# IDs Discord des super-admins, séparés par des virgules
SUPER_ADMIN_DISCORD_IDS=
# Sites en jeu seulement (Partie B) : adresses publiques, injectées dans les pages
FOLKOS_HOST=
FOLKOS_PORTAIL=
```

Ces noms sont des exemples, à adapter à votre projet.

- ❌ En dur dans le code : ID Discord (utilisateur, rôle, salon, serveur), tout autre ID unique, domaine,
  port, adresse IP, secret, URL de webhook.
- ❌ Secret envoyé au navigateur, par exemple dans une variable `NEXT_PUBLIC_`.
- ✅ Les adresses publiques dont la page a besoin (`<HÔTE_FOLKOS>`, `<PORTAIL_FOLKOS>`…) passent aussi
  par le `.env`, puis votre serveur ou votre build les injecte dans la page (ex. une variable
  `NEXT_PUBLIC_FOLKOS_HOST` : publique, jamais un secret). Une variable `NEXT_PUBLIC_` est figée au
  build : après l'avoir changée, il faut relancer le build (dites-le dans le README). Seule exception
  aux adresses dans le `.env` : l'en-tête CSP de B3, qui cite `*.fbfa.fr` tel quel.

## A4. Le code

Le serveur est partagé : aucun code ne doit pouvoir exécuter des commandes, ouvrir un accès distant ou
lire ce qui ne le regarde pas.

- ❌ `child_process` (`exec`, `spawn`, `fork`…), `eval`, `new Function`, `vm`, `require()` dynamique,
  `os.system`, `subprocess`. Exception possible seulement avec une raison claire expliquée dans le
  README, et jamais avec une donnée venant d'un utilisateur.
- ❌ Connexion sortante inattendue : `net.connect`, IP en dur, domaine inconnu.
- ❌ Code obfusqué, minifié côté serveur, ou encodé puis décodé pour être exécuté.
- ❌ Route cachée d'administration ou de debug, console distante, envoi de code.
- ❌ Lecture ou écriture hors du dossier du projet, chemin de fichier venant d'un utilisateur.

## A5. Dépendances et scripts

- ✅ Paquets connus, versions raisonnables, `npm audit --omit=dev` sans vulnérabilité haute ni critique.
- ❌ Scripts `preinstall`, `install`, `postinstall` ou `prepare` sans raison expliquée.
- ❌ `sudo`, `curl … | bash`, création de service, modification du système (pare-feu, SSH, cron).
  L'application tourne sans droits d'administration : décrivez les étapes dans le README, l'opérateur
  fait le reste.

## A6. Réseau et web

- ✅ L'application écoute sur `127.0.0.1`, sur le port du `.env`, jamais sur `0.0.0.0`. Dans un conteneur
  Docker, elle écoute sur `0.0.0.0` à l'intérieur du conteneur, et le port est publié sur `127.0.0.1`
  uniquement (`127.0.0.1:PORT:PORT`).
- ✅ Le HTTPS et le certificat sont gérés par l'opérateur : le site tourne derrière un reverse proxy.
  Lisez `X-Forwarded-Proto` et `X-Forwarded-Host` (`trust proxy` en Express), et n'ajoutez ni serveur
  web ni gestion de certificat.
- ✅ Adresses absolues (redirections, liens envoyés sur Discord…) construites depuis l'URL publique
  (`SITE_URL`). Derrière le proxy, le serveur voit l'adresse interne : `request.url` en Next.js, ou
  `req.protocol` et `req.get('host')` en Express sans `trust proxy`. Le visiteur recevrait une adresse
  `localhost` inatteignable.
- ✅ Routes qui modifient des données : authentification et contrôle de l'origine (CSRF). En jeu,
  l'origine peut valoir `null` : voir B7.
- ❌ Route qui va chercher une URL fournie par un utilisateur sans la restreindre (SSRF).
- ❌ Serveur de fichiers statiques qui laisse lire `.env`, `.git/` ou le code du backend, y compris par
  double barre (`//backend/…`) ou chemin encodé (`%2f`).

## A7. Cookies et sessions

- ✅ Cookies de session `HttpOnly; Secure`.
- ✅ Site seulement web : `SameSite=Lax` convient.
- ⚠️ Site affiché en jeu : `SameSite=None; Secure` est **obligatoire** en production (B4).
- ❌ Aucun secret côté navigateur.

## A8. Base de données

- L'opérateur crée une base et un utilisateur dédiés, et met les accès dans le `.env`.
- ✅ Tables créées au démarrage, ou migrations fournies et décrites dans le README.
- ✅ Requêtes SQL paramétrées, jamais de concaténation.

## A9. Discord

- L'application Discord est fournie par l'opérateur, avec ses identifiants.
- ✅ Indiquez dans le README le chemin de callback OAuth2 à déclarer et, s'il y a un bot, ses droits et
  les salons qu'il utilise.
- ✅ Avec NextAuth ou Auth.js, déclarez l'émetteur, sinon toutes les connexions Discord échouent :

  ```ts
  DiscordProvider({ clientId, clientSecret, issuer: "https://discord.com" })   // v4
  Discord({ issuer: "https://discord.com" })                                   // v5
  ```

- ⚠️ Site affiché en jeu : la connexion Discord ne fonctionne pas dans la fenêtre du jeu. Utilisez la
  connexion FolkOS (B8).

## A10. Fichiers et images : l'API de stockage

### La règle : rien sur le serveur

Par défaut, **aucun stockage de fichier ni d'image**, donc aucun envoi possible.

- ❌ Formulaire d'envoi de fichier, dossier `uploads/`, fichier en base (BLOB), volume dédié aux médias.
- ✅ Les images fixes du site (logo, fonds) restent dans le dépôt.
- Si le projet a vraiment besoin d'envoyer des fichiers, **demandez à l'opérateur avant de le
  développer**. S'il accepte, les fichiers passent **uniquement** par l'API de stockage ci-dessous.

### L'API

L'opérateur vous donne `<HÔTE_STORAGE>` et un jeton. Le jeton reste **côté serveur** : le navigateur
envoie le fichier à votre backend, qui le pousse vers le stockage.

Authentification : en-tête `Authorization: Bearer <VOTRE_JETON>` sur toutes les routes `/api/*`.

| Méthode et route | Effet |
|---|---|
| `PUT /api/object/{key}` | Ajouter ou remplacer (le corps est le fichier). Renvoie `{ id, url, size, mimeType }`. |
| `GET /api/object/{key}` | Métadonnées : `{ id, url, size, mimeType }`. |
| `DELETE /api/object/{key}` | Supprimer. |
| `GET /api/objects?prefix=&limit=&cursor=` | Lister : `{ items: [{ id, url, … }], nextCursor }`. |
| `GET /api/usage` | Quota et usage. |

`{key}` est un chemin libre : les `/` créent des sous-dossiers (ex. `dossiers/2026/img1.webp`).

- ✅ **Construisez la clé vous-même**, à partir de vos données (ex. `dossiers/<id en base>/<aléatoire>.webp`).
- ❌ Jamais à partir du nom de fichier envoyé par l'utilisateur.
- ✅ Encodez chaque segment de la clé dans l'URL (`encodeURIComponent`), comme ci-dessous.
- ✅ Vérifiez le type et la taille du fichier côté serveur avant de l'envoyer.

```js
// Côté serveur uniquement : le jeton ne part jamais dans le navigateur.
const STORAGE = (process.env.STORAGE_BASE_URL || '').replace(/\/+$/, '');   // <HÔTE_STORAGE>
const JETON = process.env.STORAGE_TOKEN;

async function envoyer(cle, contenu, type) {
  const chemin = cle.split('/').map(encodeURIComponent).join('/');
  const r = await fetch(`${STORAGE}/api/object/${chemin}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${JETON}`, "Content-Type": type },
    body: contenu,
  });
  if (!r.ok) throw new Error(`stockage : ${r.status}`);
  return r.json();   // { id, url, size, mimeType }
}
```

### Jeton limité à un dossier

Un jeton peut être limité à un dossier (ex. `monsite/`). Toute clé hors de ce dossier est alors refusée
en `403` (`key_forbidden`), en lecture, en écriture, en liste et en suppression. Sans `prefix`,
`/api/objects` liste ce dossier. `GET /api/usage` l'indique dans `token.keyPrefix`.

### Afficher un fichier

L'envoi renvoie un champ **`url`** de la forme `<HÔTE_STORAGE>/view/{id}`. Mettez-le directement dans
vos pages, sans jeton :

```html
<img src="<HÔTE_STORAGE>/view/clx9a8b7c0001" />
```

L'`url` ne contient pas la clé : gardez la clé en base, à côté de l'`url`, pour pouvoir supprimer le
fichier plus tard.

⚠️ Ces liens sont **publics** : toute personne qui a le lien voit le fichier, sans jeton. Ne faites
passer aucun document confidentiel par le stockage.

## A11. Liste de contrôle · hébergement

- [ ] Dépôt GitHub complet, fichier de verrouillage, README clair, `.env.example` commenté.
- [ ] Aucun `.env`, secret ou dump dans le dépôt, historique compris.
- [ ] Domaine, port, IDs Discord et super-admins dans le `.env`, rien en dur dans le code.
- [ ] Aucun secret envoyé au navigateur (`NEXT_PUBLIC_`…).
- [ ] Pas de `child_process`, `eval` ni code obfusqué sans raison expliquée.
- [ ] Dépendances saines, pas de script d'installation inexpliqué, pas de `sudo`.
- [ ] Écoute sur `127.0.0.1` (ou `0.0.0.0` dans un conteneur publié sur `127.0.0.1`), site fonctionnel
      derrière un reverse proxy HTTPS (`trust proxy`).
- [ ] Adresses absolues construites depuis `SITE_URL`, jamais depuis l'adresse interne de la requête.
- [ ] SQL paramétré, CSRF, pas de SSRF, aucun fichier sensible lisible.
- [ ] Cookies de session `HttpOnly; Secure`.
- [ ] Discord : callback et droits du bot dans le README, émetteur déclaré avec NextAuth ou Auth.js.
- [ ] Aucun envoi ni stockage local de fichier ; si l'envoi est accordé, uniquement via l'API de
      stockage : jeton côté serveur, clé construite par vous et encodée, type et taille vérifiés.

**Votre site ne s'affiche pas en jeu ? Vous avez terminé.** Passez à la Partie C s'il est déjà hébergé.

---

# Partie B · Afficher le site en jeu

**Seulement pour les sites qui s'affichent en jeu.** La Partie A s'applique aussi.

## B1. Le navigateur du jeu

En jeu, votre site s'affiche dans une **`<iframe>`** à l'intérieur de la NUI de FiveM : un Chromium
embarqué (CEF) et bridé, en version 144. Ce n'est pas un onglet classique : certaines API web **gèlent
tout le jeu**, d'autres se comportent autrement.

Chaîne d'affichage :

```
nui://game → https://cfx-nui-external-iframe → [ <HÔTE_FOLKOS> ou <PORTAIL_FOLKOS> ] → votre site
```

Le **parent direct** de votre page dépend de l'endroit d'où le joueur l'ouvre :

| Ouvert depuis | Parent direct de votre page |
|---|---|
| le navigateur de l'ordinateur en jeu | `<HÔTE_FOLKOS>` |
| un lien du portail, dans une tablette ou un cadre | `<PORTAIL_FOLKOS>` |
| un lien du portail, en grand | le jeu (`https://cfx-nui-external-iframe`) |
| un point de jeu ou un écran placé dans le monde | le jeu (`https://cfx-nui-external-iframe`) |

L'en-tête de B3 couvre tous ces cas. B5 s'en sert pour savoir quand Échap doit fermer la fenêtre.

Règle d'or : **le comportement hors jeu ne doit pas changer.** Tout ce qui suit est prévu pour ne rien
gêner dans un navigateur normal, à condition de suivre les réglages indiqués (en particulier B5).

## B2. Règle absolue : aucun dialogue natif

❌ `window.alert()`, `window.confirm()`, `window.prompt()`, `window.print()` et les prompts
`beforeunload` **gèlent le jeu** : plus rien ne répond, le joueur doit forcer la fermeture de FiveM.

✅ Modale maison, toast, ou **confirmation en 2 temps** (1er clic → « Confirmer ? », 2e clic → action).
Les erreurs s'affichent dans la page.

Avant de livrer, lancez cette recherche à la racine du projet et vérifiez chaque résultat :

```bash
grep -rnE "\b(alert|confirm|prompt|print)\(|beforeunload|window\.open|_blank" . \
  --include=*.{js,jsx,ts,tsx,mjs,cjs,html,vue,svelte} --exclude-dir={node_modules,.next,dist,build,.git}
```

Elle peut remonter des faux positifs (`inquirer.prompt(`, un `print(` côté serveur…). Ce qui compte :
aucun de ces appels dans le code exécuté par le navigateur. La commande est pour bash : sous Windows,
lancez-la dans Git Bash ou WSL.

## B3. Autoriser l'affichage en iframe

Sans ça : **page blanche, sans aucun message**. Le navigateur du jeu vérifie **chaque** ancêtre de la
chaîne ci-dessus.

✅ Posez cet en-tête HTTP sur **toutes** les réponses :

```
Content-Security-Policy: frame-ancestors 'self' https://*.fbfa.fr https://fbfa.fr https://cfx-nui-external-iframe nui://game nui:
```

| Stack | Où le poser |
|---|---|
| Next.js | `async headers()` dans `next.config`, sur `source: "/(.*)"`, et aussi dans le middleware s'il renvoie ses propres réponses |
| Express | `res.setHeader('Content-Security-Policy', "…")` dans un `app.use` global |
| Node nu | sur toutes les routes, avant `res.end` |

- ❌ **Retirez `X-Frame-Options`** : il bloque l'affichage même si la CSP est correcte.
- ❌ **Une seule CSP.** Si votre site envoie déjà un `Content-Security-Policy` (Helmet, `next.config`,
  middleware…), ajoutez la directive `frame-ancestors` ci-dessus **dans cet en-tête-là**. Quand deux
  CSP arrivent, le navigateur applique les deux : un `frame-ancestors 'self'` dans l'une suffit à tout
  bloquer. Helmet en pose un par défaut, ainsi qu'un `X-Frame-Options` : réglez les deux.
- ❌ Pas de balise `<meta>` : elle est ignorée pour `frame-ancestors`. Il faut un vrai en-tête HTTP.
- ❌ Pas de `frame-ancestors 'none'` ni `frame-ancestors *`, ni de `Content-Security-Policy-Report-Only`
  en production.

**La page reste blanche ?** Ouvrez la console (F8 en jeu) et cherchez
`Refused to display … because an ancestor violates … "frame-ancestors …"`. Le message donne l'origine
rejetée, souvent `nui://game` ou `https://cfx-nui-external-iframe`. Vérifiez l'en-tête avec
`curl -I https://votre-site/`. Une fois corrigé, une ancienne réponse peut rester en cache : videz le
cache FiveM.

## B4. Cookies en jeu

❌ Un cookie normal est **refusé sans erreur** dans l'iframe : le joueur boucle sur la connexion.

✅ `SameSite=None; Secure` en production (en plus de `HttpOnly`). En développement local en HTTP,
gardez `SameSite=Lax`.

## B5. Clavier et sortie : `fbfa-game.js`

En jeu, FiveM **capte les touches** : sans ce SDK, **rien ne s'écrit dans vos champs**.

`<HÔTE_FOLKOS>` ci-dessous est la valeur du `.env` (A3), injectée dans la page par votre serveur ou
votre build.

```html
<script src="<HÔTE_FOLKOS>/fbfa-game.js"></script>
<script>
  // Vrai seulement quand la page est affichée dans un cadre (en jeu, dans une tablette…).
  const enCadre = (location.ancestorOrigins || []).length > 0;
  // init() renvoie l'objet `game` utilisé dans ce guide (aussi disponible dans FBFAGame.current).
  const game = window.FBFAGame ? FBFAGame.init({
    typing: { mode: 'field' },  // 'field' (recommandé) | 'always' (page 100 % clavier) | 'never'
    autofocus: enCadre,         // hors cadre, ne pas prendre le focus de la page
    // Échap ferme la fenêtre en jeu, sauf dans le navigateur de l'ordinateur en jeu (B1).
    escape: enCadre && (location.ancestorOrigins || [])[0] !== '<HÔTE_FOLKOS>'
  }) : null;
</script>
```

- **Échap** ferme la fenêtre du jeu (la tablette entière, si votre site y est affiché), sauf si votre
  code l'a consommée : quand Échap ferme votre modale, faites `e.preventDefault()`.
- **Ouvert depuis le portail** (tablette, cadre ou en grand), depuis un point de jeu ou sur un écran :
  le parent direct n'est pas `<HÔTE_FOLKOS>`, donc Échap reste active. Ne forcez pas `escape: false`
  en dur : Échap ne ferait plus rien, car le clavier reste dans votre page.
- **Ouvert dans le navigateur de l'ordinateur en jeu** : le parent direct est `<HÔTE_FOLKOS>`, donc
  Échap est coupée, sinon elle fermerait tout l'ordinateur. Le joueur revient avec le bouton
  « précédent » de FolkOS.
- La comparaison est exacte : `<HÔTE_FOLKOS>` doit être l'origine telle quelle, sans barre finale.
- **Bouton de sortie** : appelez `game?.close()`.
- `game` vaut `null` si la lib n'a pas pu se charger, et certaines de ses parties valent `null` hors
  cadre (`game.typing` notamment) : appelez-les toujours avec `?.` (ex. `game?.typing?.set(true)`).
- **Dans un framework** (React, Vue…), évitez une variable globale `game` : utilisez
  `window.FBFAGame?.current`.
- Sous Shift, `e.key` arrive en **majuscule**. Si vous liez des touches :
  `const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;`
- **Écran placé dans le monde** : le SDK ne suffit pas, collez en plus le script de B9.3.

## B6. Suivre l'adresse : `fbfa-bridge.js`

Ce script signale la sous-page courante (le chemin d'URL seul). La barre d'adresse du jeu affiche
alors `intranet://…`, et FolkOS rouvre la bonne page à la prochaine ouverture (B8.7) :

```html
<script src="<HÔTE_FOLKOS>/fbfa-bridge.js" async></script>
```

Sans lui, le joueur repart de votre accueil à chaque ouverture. Si vous chargez `folkos-tablette.js`
(B10), il le remplace : ne chargez jamais les deux.

## B7. À éviter

- ❌ `window.open()` et `target="_blank"` : n'ouvrent rien. Naviguez dans le cadre ou en overlay (pour
  ouvrir une page à côté dans la tablette, voir B10).
- ❌ `window.top`, `window.parent`, `document.referrer` : bloqués ou vides. Ne lisez jamais l'identité
  depuis la page parente (B8).
- ❌ Planter sur une query string inconnue : FolkOS ajoute `?_cb=…` contre le cache.
- ❌ Redirection vers une connexion externe (Discord…) dans la fenêtre du jeu. Utilisez la connexion
  FolkOS (B8) ou un appairage par code.
- ❌ `<input type=file>` comme seule option, si l'envoi de fichiers vous est accordé (A10) : il est peu
  fiable en jeu. Proposez aussi l'ajout par adresse d'image : votre backend télécharge l'image en
  appliquant les règles SSRF (A6), puis l'envoie via l'API de stockage.
- ❌ Téléchargement (`download`, lien vers un fichier binaire) et glisser-déposer : le premier n'aboutit
  pas, le second est aléatoire. Affichez le fichier dans la page : image en lightbox, PDF dans une
  `<iframe>` en overlay.
- ❌ `line-height: 0` casse le texte. Le CSS récent (`color-mix()`…) est reconnu, mais testez-le en jeu.
- ❌ Lire l'en-tête `Origin` sans prévoir la valeur `null`. En jeu, un POST peut arriver avec
  `Origin: null`. Les Server Actions de Next.js 15 répondent alors 500 (`Invalid URL`) : toute
  sauvegarde échoue en jeu alors que tout marche dans un vrai navigateur.
  - ✅ Pour les écritures, préférez une route API, ou n'acceptez `Origin: null` qu'avec un jeton lié à
    la session.
  - ❌ Évitez `Referrer-Policy: no-referrer`, qui fait partir les formulaires avec `Origin: null` ;
    utilisez `same-origin` ou `strict-origin-when-cross-origin`.
- ❌ `display: flex` ou `block` sur un élément `hidden` : votre règle l'emporte et il reste visible.
  Ajoutez `[hidden] { display: none !important; }`.
- ❌ Modale `position: fixed` rendue sur place : utilisez un **portail** sur `document.body` avec un
  `z-index` élevé.
- ❌ `Content-Type` mal formé : en Express, `res.type('html')`, pas `res.type('html; charset=utf-8')`.
  Sinon le jeu télécharge la page au lieu de l'afficher.

---

## B8. Connecter le joueur : FolkOS

Ouvrir une session sur votre site avec l'identité du joueur, sans mot de passe ni connexion Discord en
jeu.

> ⚠️ **Votre backend doit être hébergé chez nous.** Le service qui valide les connexions n'est
> joignable que depuis notre serveur. Un Worker Cloudflare, un Vercel ou un autre serveur ne peut pas
> s'en servir. Dites-le avant d'écrire du code.

### B8.1 Le principe

```
Le joueur clique « Se connecter IG »
   └─▶ FolkOS (le portail, ou l'ordinateur en jeu) crée un TICKET lié à votre site
        (et pose dans le navigateur un cookie secret fbfa_sso_<votre client_id>_…)
        └─▶ redirige vers  https://VOTRE-SITE/api/folkos?folkos_ticket=<ticket>
             └─▶ VOUS appelez  POST {FOLKOS_ID_BASE}/sso/verify  (ticket + secrets du cookie)
                  └─▶ réponse { valid: true, identity: {…} }
                       └─▶ vous ouvrez VOTRE session et redirigez
```

- Le ticket est opaque, **à usage unique**, lié à votre site, valable **90 secondes**, et accepté
  seulement s'il est présenté par le navigateur qui l'a reçu.
- **Ne faites jamais confiance au ticket lui-même** : seule la réponse de `/sso/verify` fait foi. Comme
  le ticket est consommé à la vérification, vous n'avez pas d'anti-rejeu à écrire.

### B8.2 Ce qu'on vous fournit, ce que vous rendez

Trois variables, **côté serveur uniquement**, à ajouter à votre `.env.example` :

| Variable | Contenu |
|---|---|
| `FOLKOS_ID_BASE` | adresse du service de validation (fournie, joignable seulement depuis notre serveur) |
| `FOLKOS_CLIENT_ID` | votre identifiant de client (ex. `monsite`) |
| `FOLKOS_CLIENT_SECRET` | votre secret : **jamais** côté navigateur, jamais en `NEXT_PUBLIC_`, jamais dans les journaux |

On vous dit aussi **quels scopes** vous avez reçus : ils décident des champs de l'identité (B8.6).

Vous nous indiquez **le chemin de votre endpoint** (en principe `/api/folkos`). L'adresse complète
découle du domaine choisi par l'opérateur, toujours sous `*.fbfa.fr` (ex.
`https://monsite.fbfa.fr/api/folkos`) : ailleurs, le cookie secret ne lui parviendrait pas.

### B8.3 L'endpoint : un seul, en GET

```
GET /api/folkos?folkos_ticket=<ticket>[&next=<chemin>]
```

Quatre étapes, dans cet ordre :

1. **Lire `folkos_ticket`.** S'il est absent, renvoyez vers votre page de connexion avec une erreur.
2. **Échanger le ticket** contre l'identité (B8.4), avec les secrets de vos cookies `fbfa_sso_…`
   (B8.5).
3. **Retrouver VOTRE utilisateur** à partir de l'identité reçue (B8.6).
4. **Ouvrir VOTRE session** (votre cookie, votre JWT : ce que vous utilisez déjà) et rediriger (B8.7).

### B8.4 L'échange

```
POST {FOLKOS_ID_BASE}/sso/verify
Content-Type: application/json

{ "client_id": "...", "client_secret": "...", "token": "<le ticket>", "nonces": ["…"] }
```

- ⚠️ Le champ s'appelle **`token`**, pas `ticket` : c'est la valeur de `folkos_ticket`.
- ⚠️ `nonces` est **obligatoire** (B8.5). Sans lui : refus `403 nonce_required`.

Réponse acceptée :

```json
{ "valid": true, "identity": { "sub": "...", "name": "...", "discord_id": "..." }, "nonce_check": "ok" }
```

Refus : `{ "valid": false, "error": "..." }`, avec un statut HTTP :

| Statut | `error` | Signification |
|---|---|---|
| 401 | `client_auth_failed` | Mauvais `client_id` ou `client_secret`. |
| 400 | `token_invalid` | Ticket inconnu, **déjà consommé** ou expiré (90 s). |
| 403 | `audience_mismatch` | Ticket émis pour un autre site. |
| 403 | `nonce_required` | Aucun secret transmis dans `nonces`, ou ticket émis sans secret (`nonce_check: unbound`). |
| 403 | `nonce_mismatch` | Des secrets transmis, aucun ne correspond au ticket. |

Traitez tous les refus de la même façon : retour à votre page de connexion avec une erreur. **Ne
réessayez jamais** : un ticket consommé le reste.

### B8.5 Lier le ticket au navigateur (obligatoire)

> Site branché à FolkOS avant le 6 novembre 2026 : une période de transition s'applique, voir la
> Partie C.

En même temps que le ticket, FolkOS (le portail ou l'ordinateur en jeu) pose dans le navigateur un
cookie secret, que votre endpoint reçoit dans l'en-tête `Cookie` :

```
fbfa_sso_<votre client_id>_<8 hex>=<secret>; HttpOnly; Secure; SameSite=None; Domain=.fbfa.fr; Path=/; Max-Age=120
```

Envoyez dans `nonces` les valeurs de **tous** vos cookies dont le nom commence par
`fbfa_sso_<votre client_id>_` :

- préfixe : votre `client_id` **en minuscules**, chaque caractère hors `a-z`, `0-9` et `-` remplacé
  par `-` ;
- **16 valeurs au plus, les 16 plus récentes** (les dernières de l'en-tête : `.slice(-16)`), de 16 à
  128 caractères chacune, transmises telles quelles, sans décodage ni troncature ;
- plusieurs cookies, c'est normal (un par ouverture, plusieurs onglets) : envoyez-les tous ;
- aucun cookie : envoyez `[]` quand même (la connexion sera refusée) ;
- le cookie est `HttpOnly` : il se lit **côté serveur** uniquement ;
- derrière un proxy, l'en-tête `Cookie` doit arriver intact jusqu'au code qui appelle `/sso/verify` ;
- rien à nettoyer : le cookie expire seul en 2 minutes ;
- ce sont des **secrets** : ne les écrivez jamais dans les journaux et ne les renvoyez jamais au
  navigateur.

La réponse contient un champ `nonce_check`. **Ne refusez pas vous-même sur cette valeur** : c'est le
service de validation qui décide. Pour diagnostiquer, journalisez seulement `nonce_check`, jamais les
valeurs :

| `nonce_check` | Signification | Cause probable |
|---|---|---|
| `ok` | connexion acceptée | — |
| `absent` | aucun secret transmis | préfixe mal construit, endpoint hors `*.fbfa.fr`, en-tête `Cookie` perdu en route |
| `mismatch` | secrets transmis, aucun ne correspond | valeurs modifiées avant l'envoi, ou les 16 premières gardées au lieu des 16 dernières |
| `unbound` | ticket émis sans secret | problème de notre côté : prévenez l'opérateur |

### B8.6 L'identité

Les champs reçus dépendent **de vos scopes**. Un scope non accordé donne des champs absents, sans
erreur.

| Scope | Champs |
|---|---|
| `openid` | `sub` |
| `profile` | `name`, `given_name`, `family_name` |
| `discord` | `discord_id`, `discord_name` |
| `fba` | `unique_id` (le **joueur**), `character_id` (le **personnage**), `server` |
| `job` | `job_id` (entreprise, nombre), `rank` (grade, ex. `"Patron"`) |
| `org` | `organisation_id` = `org_id` (nombre), `org_type` (nombre), `org_name` |
| `point` | `point_id` : le poste placé dans le monde d'où le site a été ouvert (accordé seulement aux sites qui en ont l'usage) |

- Un joueur sans entreprise n'a **ni** `job_id` **ni** `rank`. Un joueur peut avoir une organisation
  sans entreprise, et inversement : traitez toujours le cas « champ absent ».
- `point_id` est signé par le jeu : la valeur est fiable. Ne le remplacez **jamais** par un paramètre
  d'URL (`?point=…`), que n'importe qui pourrait falsifier.

Un joueur arrive **par le portail** FolkOS (liens et tablettes, en jeu comme sur le web) ou **par
l'ordinateur en jeu**. Les deux passent par le même endpoint, mais l'identité diffère :

| Champ | Par le portail | Par l'ordinateur en jeu |
|---|---|---|
| `sub` | `fba:<unique_id>:<character_id>` | `acc:<id de compte>` |
| `name` | « Prénom Nom » | pseudo du compte |
| `given_name` / `family_name` | ✅ | ❌ jamais |
| `discord_id` | ✅ chaîne | ✅ chaîne (ou absent) |
| `discord_name` | ❌ jamais | ✅ |
| `unique_id` / `character_id` | chaîne (`"123456"`) | **nombre** (`123456`) |
| `server` | ❌ jamais | ✅ (parfois `null`) |
| `job_id` / `rank` | ✅ | ✅ |
| `organisation_id` / `org_id` / `org_type` / `org_name` | ✅ | ❌ jamais |
| `point_id` | ✅ si ouvert depuis un poste | ❌ jamais |

Trois conséquences :

1. **Ne liez jamais vos comptes à `sub`** : il change selon le chemin d'entrée, et le même joueur
   aurait deux comptes. Choisissez la clé selon ce que représente un compte chez vous :

   | Un compte chez vous = | Clé à utiliser |
   |---|---|
   | un **joueur** (tous ses personnages ensemble) | `unique_id` de préférence (`discord_id` peut manquer par l'ordinateur en jeu) |
   | un **personnage** (fiche d'agent, dossier, métier…) | le couple **`unique_id` + `character_id`** |

   `discord_id` et `unique_id` désignent le joueur, pas le personnage : sur un site par personnage,
   les utiliser seuls donnerait le même compte à tous les personnages d'un joueur.
2. **Convertissez `unique_id` et `character_id` en texte** (`String(identity.unique_id)`) : le type
   change selon le chemin d'entrée.
3. **Ne basez aucun droit d'accès sur un champ marqué ❌** : il sera absent la moitié du temps.

> **Site à accès restreint : ne créez pas de compte depuis la connexion FolkOS.** Un joueur validé est
> un vrai joueur, pas forcément un membre chez vous. Exigez une fiche créée à l'avance, ou un contrôle
> de rôle avant de créer le compte.

### B8.7 `?next=` : rouvrir la bonne page

En jeu, fermer la tablette **détruit la page**. FolkOS retient la dernière sous-page visitée (grâce à
`fbfa-bridge.js` ou `folkos-tablette.js`, B6 et B10) et la repasse à votre endpoint (pendant 12 heures par défaut, parfois moins selon
le réglage de votre site) :

```
https://VOTRE-SITE/api/folkos?folkos_ticket=…&next=%2Ftablette%2Foperations
```

Après avoir ouvert la session, allez sur `next` **seulement si c'est un chemin relatif**, sinon sur
votre accueil. Ignorer `next` ne casse rien : le joueur repart juste de l'accueil.

**La validation n'est pas optionnelle** : accepter une URL absolue ferait de votre endpoint une
redirection ouverte. Le chemin doit commencer par `/` sans commencer par `//`, ne contenir ni espace
ni `\`, rester court, et exclure vos routes de passage (`/api`, `/login`…). Code en B8.9.

**Cache de l'iframe** : le jeu sert volontiers une vieille version de la page d'arrivée. Ajoutez un
paramètre jetable à la redirection (`_sso=<aléatoire>`, fonction `arrivee` en B8.9), et mettez
toujours `Cache-Control: no-store, max-age=0` sur les réponses de l'endpoint, échecs compris.

### B8.8 Tester sans vrai joueur

Demandez à l'opérateur d'activer le **mode démo** : il vous donne un lien qui envoie un ticket normal à
votre endpoint (avec une variante pour voir le rendu en tablette). `/sso/verify` renvoie alors une
identité **fictive** :

```json
{ "unique_id": "999999", "character_id": "999999", "discord_id": "999999999999999999",
  "name": "Perso Démo", "job_id": 999, "rank": "Patron",
  "organisation_id": 999, "org_id": 999, "org_type": 3, "org_name": "Organisation Démo" }
```

- Ce personnage ne correspond à aucun compte réel : vous validez le flux, pas l'ouverture de session.
- La liaison au navigateur s'applique aussi en démo : un test réussi doit répondre `nonce_check: "ok"`.
- Lisez toujours le préfixe des cookies depuis `FOLKOS_CLIENT_ID`, jamais en dur.
- Le mode démo est **coupé** une fois votre intégration finie.

### B8.9 Code : Node.js (Express ou serveur nu)

Aucune dépendance : `fetch` est natif depuis Node 18.

```js
const crypto = require('node:crypto');
const ID_BASE = (process.env.FOLKOS_ID_BASE || '').replace(/\/+$/, '');
const BASE = (process.env.SITE_URL || '').replace(/\/+$/, '');   // URL PUBLIQUE, jamais l'adresse interne
const PROD = process.env.NODE_ENV === 'production';

// Préfixe des cookies secrets posés avec le ticket (B8.5).
const PREFIXE_NONCE = 'fbfa_sso_' +
  String(process.env.FOLKOS_CLIENT_ID || '').toLowerCase().replace(/[^a-z0-9-]/g, '-') + '_';

/** Valeurs des cookies `fbfa_sso_<client_id>_*` lues dans l'en-tête Cookie. Jamais journalisées. */
function noncesFolkos(enteteCookie) {
  return String(enteteCookie || '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.startsWith(PREFIXE_NONCE))
    .map((p) => p.slice(p.indexOf('=') + 1))
    .filter((v) => v.length >= 16 && v.length <= 128)
    .slice(-16); // les 16 plus récents
}

/** Échange un ticket contre l'identité. Renvoie l'identité, ou null si refusé. */
async function verifierTicket(ticket, nonces) {
  if (!ID_BASE || !process.env.FOLKOS_CLIENT_SECRET) throw new Error('SSO non configuré');
  let resp;
  try {
    resp = await fetch(ID_BASE + '/sso/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.FOLKOS_CLIENT_ID,
        client_secret: process.env.FOLKOS_CLIENT_SECRET,
        token: ticket,   // ⚠ `token`, pas `ticket`
        nonces,          // obligatoire
      }),
    });
  } catch (e) {
    console.error('[FolkOS] service injoignable :', e.message);
    return null;
  }
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data || !data.valid || !data.identity) {
    // Statut, erreur et nonce_check seulement : jamais le ticket, jamais les nonces.
    console.warn('[FolkOS] refus :', resp.status, data && data.error, data && data.nonce_check);
    return null;
  }
  return data.identity;
}

// Vos routes de passage, où l'on ne veut jamais arriver.
const TRANSITOIRES = /^\/(api|login|deconnexion)(\/|\?|$)/;

/** `next` accepté seulement en chemin relatif sûr (B8.7). */
function cheminSur(nextBrut, defaut = '/') {
  const v = String(nextBrut || '');
  const ok =
    v.startsWith('/') &&
    !v.startsWith('//') &&   // //evil.com : une URL absolue déguisée en chemin
    v.length <= 512 &&
    !/[\\\s]/.test(v) &&
    !TRANSITOIRES.test(v);
  return ok ? v : defaut;
}

/** Adresse d'arrivée, avec un paramètre jetable contre le cache de l'iframe (B8.7). */
function arrivee(chemin) {
  return BASE + chemin + (chemin.includes('?') ? '&' : '?') + '_sso=' + crypto.randomBytes(4).toString('hex');
}

// Votre modèle de compte (B8.6) : 'joueur' ou 'personnage'.
const COMPTE_PAR = 'joueur';

// L'endpoint, en Express
const express = require('express');
const app = express();
app.set('trust proxy', 'loopback');   // derrière le reverse proxy (A6) ; dans un conteneur : 1

app.get('/api/folkos', async (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');   // sur toutes les réponses, échecs compris
  if (!BASE || !ID_BASE || !process.env.FOLKOS_CLIENT_SECRET) {
    console.error('[FolkOS] SSO non configuré');
    return res.status(500).send('SSO non configuré');
  }
  const echec = (code) => res.redirect(`${BASE}/login?error=${code}`);

  try {
    const ticket = req.query.folkos_ticket;
    if (!ticket) return echec('sso');

    const identity = await verifierTicket(String(ticket), noncesFolkos(req.headers.cookie));
    if (!identity) return echec('sso');

    // Jamais sur `sub`, et on convertit en texte (B8.6).
    const discordId = identity.discord_id ? String(identity.discord_id) : null;
    const uniqueId = identity.unique_id != null ? String(identity.unique_id) : null;
    const characterId = identity.character_id != null ? String(identity.character_id) : null;
    const manque = COMPTE_PAR === 'personnage' ? !uniqueId || !characterId : !uniqueId && !discordId;
    if (manque) return echec('AccountNotFound');   // identifiant absent : scope `fba` accordé ?

    const user = await trouverUtilisateur({ discordId, uniqueId, characterId });   // à vous
    if (!user) return echec('AccountNotFound');   // pas de création si accès restreint

    const sid = await ouvrirSession(user);         // à vous : renvoie l'identifiant de session
    res.cookie('session', sid, {
      httpOnly: true,
      secure: PROD,
      sameSite: PROD ? 'none' : 'lax',   // none : obligatoire dans l'iframe du jeu
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    });
    return res.redirect(arrivee(cheminSur(req.query.next, '/')));
  } catch (e) {
    console.error('[FolkOS] erreur :', e.message);   // jamais le ticket ni les nonces
    return echec('sso');
  }
});
```

Sans Express, la logique est identique : lisez `folkos_ticket` et `next` avec
`new URL(req.url, BASE)` (il ne sert qu'à lire les paramètres), puis répondez `302` avec les en-têtes
`Location`, `Set-Cookie` et `Cache-Control`.

**Site statique (HTML/JS pur) ?** Il vous faut quand même un petit bout de serveur : le secret ne doit
jamais partir dans le navigateur, et le service de validation n'est joignable que depuis notre serveur.
Les quelques lignes ci-dessus suffisent.

### B8.10 Code : Next.js (App Router)

Tout se passe côté serveur : vos composants ne voient qu'une session déjà ouverte.

```ts
// app/api/folkos/route.ts
import crypto from "node:crypto"
import { NextRequest, NextResponse } from "next/server"

const ID_BASE = (process.env.FOLKOS_ID_BASE ?? "").replace(/\/+$/, "")
const BASE = (process.env.SITE_URL ?? "").replace(/\/+$/, "")   // URL publique, jamais request.url
const PREFIXE = `fbfa_sso_${(process.env.FOLKOS_CLIENT_ID ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "-")}_`
const COMPTE_PAR = "joueur" as "joueur" | "personnage"   // votre modèle de compte (B8.6)

/** Redirection jamais mise en cache (B8.7). */
function rediriger(adresse: string) {
  const res = NextResponse.redirect(adresse)
  res.headers.set("Cache-Control", "no-store, max-age=0")
  return res
}

// Toute erreur (base injoignable…) renvoie vers la connexion, jamais une page 500 mise en cache.
export async function GET(req: NextRequest) {
  try {
    return await traiter(req)
  } catch (e) {
    console.error("[FolkOS] erreur :", (e as Error).message)   // jamais le ticket ni les nonces
    return rediriger(`${BASE}/login?error=sso`)
  }
}

async function traiter(req: NextRequest) {
  if (!BASE || !ID_BASE || !process.env.FOLKOS_CLIENT_SECRET) {
    console.error("[FolkOS] SSO non configuré")
    return new NextResponse("SSO non configuré", { status: 500, headers: { "Cache-Control": "no-store" } })
  }
  const echec = (code: string) => rediriger(`${BASE}/login?error=${code}`)

  const ticket = req.nextUrl.searchParams.get("folkos_ticket")
  if (!ticket) return echec("sso")

  const nonces = req.cookies.getAll()
    .filter((c) => c.name.startsWith(PREFIXE) && c.value.length >= 16 && c.value.length <= 128)
    .map((c) => c.value)
    .slice(-16)

  const r = await fetch(`${ID_BASE}/sso/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.FOLKOS_CLIENT_ID,
      client_secret: process.env.FOLKOS_CLIENT_SECRET,
      token: ticket,   // ⚠ `token`, pas `ticket`
      nonces,          // obligatoire
    }),
    cache: "no-store",
  }).catch(() => null)
  const data = r ? await r.json().catch(() => null) : null
  if (!r?.ok || !data?.valid || !data.identity) {
    console.warn("[FolkOS] refus :", r?.status, data?.error, data?.nonce_check)   // jamais ticket ni nonces
    return echec("sso")
  }

  // Jamais sur `sub`, et on convertit en texte (B8.6).
  const id = data.identity
  const discordId = id.discord_id ? String(id.discord_id) : null
  const uniqueId = id.unique_id != null ? String(id.unique_id) : null
  const characterId = id.character_id != null ? String(id.character_id) : null
  const manque = COMPTE_PAR === "personnage" ? !uniqueId || !characterId : !uniqueId && !discordId
  if (manque) return echec("AccountNotFound")   // identifiant absent : scope `fba` accordé ?

  const user = await trouverUtilisateur({ discordId, uniqueId, characterId })   // à vous
  if (!user) return echec("AccountNotFound")   // pas de création si accès restreint

  const chemin = cheminSur(req.nextUrl.searchParams.get("next"), "/")
  const res = rediriger(
    BASE + chemin + (chemin.includes("?") ? "&" : "?") + "_sso=" + crypto.randomBytes(4).toString("hex"),
  )
  await ouvrirSession(res, user)   // à vous : cookie HttpOnly, Secure, SameSite=None en production
  return res
}
```

Copiez `cheminSur` et `TRANSITOIRES` depuis B8.9 (typez le paramètre de `cheminSur` en
`string | null`). Ici, `ouvrirSession(res, user)` pose le cookie sur la réponse ; en Express, elle
renvoyait l'identifiant de session. Adaptez-la à votre code.

Pièges propres à Next.js :

- **`request.url` pointe vers `localhost`** derrière le proxy : construisez toujours vos redirections
  depuis `SITE_URL` (ou `NEXTAUTH_URL`).
- **NextAuth v4, session JWT** : si vous fabriquez le JWT avec `encode()`, ne passez **pas** de `salt`.
  NextAuth relit le jeton sans `salt` : avec un `salt`, la session paraît vide, sans erreur.
- **Vous partez de zéro ?** Préférez une session stockée en base (Auth.js v5 : le cookie ne contient
  qu'un identifiant aléatoire) : pas de format de JWT à reproduire, pas de piège de `salt`.

---

## B9. Parler au jeu : l'API `external-iframe`

### B9.0 En avez-vous besoin ?

| Votre cas | Ce qu'il faut |
|---|---|
| Site ouvert dans la tablette ou l'ordinateur FolkOS | **Rien de plus** que `fbfa-game.js` (B5) : il gère déjà le clavier (`/typing`) et la sortie (`/leave`). |
| Page posée sur un **écran dans le monde** | `fbfa-game.js` **et** le script de B9.3. |
| Page affichée par un point de jeu **sans FolkOS**, sans charger `fbfa-game.js` | `/typing` et `/leave` à la main (B9.2, B9.3, squelette en B9.6). |
| Page qui doit **masquer le curseur** | `/cursor` (B9.4). |

### B9.1 Le principe

La page parle au jeu en envoyant un `POST` sur `https://external-iframe/<route>`. Cette adresse
n'existe **que** dans le navigateur de FiveM : hors jeu, les `fetch` échouent. **Chaque appel a donc
son `.catch`** (ou son `try`/`catch`), pour que le site marche normalement hors jeu.

Dans le tableau, `game` est l'objet renvoyé par `FBFAGame.init()` (B5) : appelez-le avec `?.`.

| Route | Corps envoyé | Réponse | Dans `fbfa-game.js` |
|---|---|---|---|
| `/leave` | `{ success? }` | — | `game.leave(ok)` / `game.close()` |
| `/typing` | `{ typing }` | — | automatique (mode `field`) ; `game?.typing?.set(on)` |
| `/cursor` | `{ disabled }` | — | `game.cursor(hidden)` |

Messages envoyés **par le jeu** à la page, sur un écran dans le monde uniquement (B9.3) :

| Message (`event.data.type`) | Contenu | À faire côté page |
|---|---|---|
| `externalIframeKey` | `{ event: 'keydown' \| 'keyup', key, code, repeat, shiftKey, ctrlKey, altKey }` | recréer la touche et l'écrire dans le champ actif |
| `externalIframeTypingEnd` | — | le joueur a fait Échap : quitter le champ |

### B9.2 `/leave` : fermer la page

`success` est **optionnel** : sans lui, la page se ferme sans résultat ; avec lui, elle marque un
mini-jeu réussi ou raté.

```js
function fermer(success) {
  fetch("https://external-iframe/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(success === undefined ? {} : { success: !!success }),
  }).catch(() => {});
}
```

Avec `fbfa-game.js` : `game.leave(true | false)` marque un résultat, `game.close()` ferme **sans**
résultat. Échap fait une fermeture simple, sauf si un gestionnaire a fait `e.preventDefault()`.

### B9.3 `/typing` : libérer le clavier du jeu

Tant que la page ne dit rien, le jeu garde les touches (ZQSD fait bouger le personnage pendant la
saisie). Prévenez-le au focus et à la perte de focus d'un champ ; le push-to-talk est rétabli à la
perte de focus.

```js
function saisie(actif) {
  fetch("https://external-iframe/typing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ typing: !!actif }),
    keepalive: true,   // part même si la page se ferme
  }).catch(() => {});
}

document.querySelectorAll("input, textarea").forEach((el) => {
  el.addEventListener("focus", () => saisie(true));
  el.addEventListener("blur", () => saisie(false));
});
```

Inutile si vous chargez `fbfa-game.js` en mode `field` : il le fait déjà, et rend toujours le clavier
quand la page se ferme. Un jeu joué au clavier en continu choisit plutôt `typing: { mode: 'always' }`
dans `init()` (ou appelle `game?.typing?.set(true)`).

#### Écran dans le monde : le script des champs est obligatoire

Une page peut aussi s'afficher sur un **écran placé dans le monde** : la caméra se met face à l'écran
et le joueur l'utilise à la souris. Échap quitte l'écran ; si un champ était en saisie, le jeu prévient
aussi la page (`externalIframeTypingEnd`) pour qu'elle quitte le champ. Les autres routes fonctionnent
à l'identique, **sauf le clavier** :

| | Point iframe normal | Écran dans le monde |
|---|---|---|
| Touches reçues par la page | les vraies, une fois `/typing` envoyé | **aucune** : le jeu ne peut pas donner son clavier à l'écran |
| Ce qu'il faut faire | `/typing` ou `fbfa-game.js` | `/typing` **et** le script ci-dessous |
| Sans rien faire | le personnage bouge pendant la saisie | **rien ne s'écrit** dans vos champs |

Le jeu envoie chaque touche à la page par message, et la page doit la recréer. **Collez ce script dans
toute page qui peut être mise sur un écran**, même avec `fbfa-game.js`. Il :

- demande le clavier quand un champ prend le focus (le jeu ne l'accorde que juste après un clic du
  joueur sur l'écran), et le rend quand le champ perd le focus ;
- recrée `keydown` / `keyup` et écrit dans le champ actif : lettres, Retour arrière, Suppr, flèches
  gauche et droite. Entrée valide le formulaire, ou passe à la ligne dans un `textarea` ;
- quitte le champ quand le joueur fait Échap.

Pour un jeu joué au clavier **sans champ de saisie**, demandez le clavier dans le clic qui lance la
partie : `post("typing", { typing: true })`.

> **N'acceptez les touches que du jeu.** Le script ne les écoute que si la page est réellement
> embarquée par le jeu (`location.ancestorOrigins`, fourni par le navigateur) et seulement si le
> message vient de lui (`e.origin`). Sans ces deux vérifications, un autre site autorisé à embarquer
> votre page pourrait y taper du texte et valider des formulaires à la place du joueur.

```js
// Écran dans le monde : le jeu n'envoie pas de vraies touches à la page, ce script les recrée.
(() => {
  const RESSOURCE = "https://cfx-nui-external-iframe";
  // Page vraiment embarquée par le jeu ? (liste fournie par le navigateur, impossible à falsifier)
  if (!Array.from(location.ancestorOrigins || []).includes(RESSOURCE)) return;

  const post = (route, body) =>
    fetch("https://external-iframe/" + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  const NOT_TEXT = ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"];
  const isField = (el) =>
    !!el && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !NOT_TEXT.includes(el.type)));

  // Demande le clavier quand un champ prend le focus (le jeu ne l'accorde que juste après un clic).
  document.addEventListener("focusin", (e) => isField(e.target) && post("typing", { typing: true }));
  document.addEventListener("click", () => isField(document.activeElement) && post("typing", { typing: true }));
  document.addEventListener("focusout", (e) => isField(e.target) && post("typing", { typing: false }));

  // Valeur posée par le setter natif : React, Vue… voient le changement (sinon le champ se vide).
  const setValue = (el, v) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    set ? set.call(el, v) : (el.value = v);
  };
  const edit = (el, insert, start, end) => {
    try {
      el.setRangeText(insert, start, end, "end");
    } catch {
      setValue(el, insert ? el.value + insert : el.value.slice(0, -1)); // number, email… : pas de sélection
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  window.addEventListener("message", (e) => {
    const data = e.data;
    if (!data || e.origin !== RESSOURCE) return; // touches du jeu seulement
    const el = document.activeElement;
    if (data.type === "externalIframeTypingEnd") {
      if (isField(el)) el.blur();
      return;
    }
    if (data.type !== "externalIframeKey") return;

    const { event, key, code, repeat, shiftKey, ctrlKey, altKey } = data;
    const init = { key, code, repeat, shiftKey, ctrlKey, altKey, bubbles: true, cancelable: true };
    const notCancelled = (el || document.body).dispatchEvent(new KeyboardEvent(event, init));
    if (event !== "keydown" || !notCancelled || !isField(el)) return;

    if (el.isContentEditable) {
      if (key.length === 1 && !ctrlKey) document.execCommand("insertText", false, key);
      else if (key === "Backspace") document.execCommand("delete");
      else if (key === "Enter") document.execCommand("insertParagraph");
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    if (key.length === 1 && !ctrlKey) edit(el, key, start, end);
    else if (key === "Backspace") edit(el, "", start === end ? Math.max(0, start - 1) : start, end);
    else if (key === "Delete") edit(el, "", start, start === end ? end + 1 : end);
    else if (key === "Enter") el.tagName === "TEXTAREA" ? edit(el, "\n", start, end) : el.form?.requestSubmit();
    else if (key === "ArrowLeft" || key === "ArrowRight") {
      const caret = Math.max(0, Math.min(el.value.length, start + (key === "ArrowLeft" ? -1 : 1)));
      try {
        el.setSelectionRange(caret, caret);
      } catch {}
    }
  });
})();
```

Hors du jeu, ce script ne fait rien.

### B9.4 `/cursor` : masquer le curseur

Masque le curseur **en gardant le clavier dans la page**, pour un mini-jeu joué au clavier. Le CSS
`cursor: none` ne suffit pas : le curseur peut être dessiné par FiveM lui-même.

```js
function curseur(masque) {
  fetch("https://external-iframe/cursor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ disabled: !!masque }),
    keepalive: true,   // part même si la page se ferme
  }).catch(() => {});
}
```

Prévoyez toujours le `curseur(false)` de sortie (fin de partie, démontage, `pagehide`) : un curseur
laissé masqué le reste après la fermeture de la page.

### B9.5 Identité sur un point de jeu : le jeton `?token=`

Si le point de jeu est réglé pour transmettre l'identité, il ajoute un **JWT RS256** à l'URL de votre
page. Il se lit côté navigateur mais **se vérifie côté serveur** : un jeton non vérifié ne prouve rien.
La clé publique vous est donnée par l'opérateur.

```js
// Côté serveur (Node.js + jsonwebtoken)
const jwt = require("jsonwebtoken");

/** `token` = le paramètre ?token= reçu par la page. Renvoie les claims, ou null. */
function lireJetonPoint(token) {
  try {
    return jwt.verify(String(token || ""), process.env.POINT_PUBLIC_KEY, { algorithms: ["RS256"] });
  } catch {
    return null;   // jeton absent, signature fausse ou jeton expiré
  }
}
```

| Claim | Présent si |
|---|---|
| `uniqueId`, `characterId` | le point transmet les identifiants |
| `discordId` | le point transmet Discord |
| `firstName`, `lastName` | le point transmet le nom |
| `env`, `iat`, `exp` | toujours (**jeton valable 5 minutes**) |

- ✅ Figez `algorithms: ["RS256"]`, sinon un jeton `alg: none` ou HS256 passerait.
- ❌ Ne gardez pas ce jeton comme session : c'est un ticket d'entrée de 5 minutes. Pour une vraie
  session, utilisez la connexion FolkOS (B8).
- ⚠️ Le jeton ne dit pas pour quel site il a été émis : un jeton reçu par un autre site pourrait être
  rejoué chez vous pendant ses 5 minutes. Réservez-le à des usages sans enjeu, et passez par FolkOS
  (B8) pour tout ce qui compte.

### B9.6 Squelette minimal d'une page sans `fbfa-game.js`

```html
<!doctype html>
<html lang="fr">
  <head><meta charset="utf-8" /></head>
  <body>
    <button id="quitter">Quitter</button>
    <script>
      const post = (route, body) =>
        fetch("https://external-iframe/" + route, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).catch(() => {});

      // Identité signée éventuelle, à vérifier côté serveur (B9.5)
      const token = new URLSearchParams(location.search).get("token");

      // Libère le clavier quand on tape dans un champ
      document.querySelectorAll("input, textarea").forEach((el) => {
        el.addEventListener("focus", () => post("typing", { typing: true }));
        el.addEventListener("blur", () => post("typing", { typing: false }));
      });

      // Ferme la page
      document.getElementById("quitter").onclick = () => post("leave", {});

      // Sans fbfa-game.js, Échap ne ferme rien : on le fait nous-mêmes
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !e.defaultPrevented) post("leave", {});
      });
    </script>
  </body>
</html>
```

---

## B10. Optionnel : tablette à onglets et brouillons

Certaines tablettes ont **plusieurs onglets** : le joueur ouvre plusieurs pages de votre site, passe
de l'une à l'autre, et peut en afficher deux côte à côte. **Votre site n'a rien à faire pour que ça
marche.** Ce script d'aide permet seulement de faire mieux.

Chargez-le **sans `async`**, avant le code de votre site qui s'en sert. Placez ce code en fin de
`<body>` (ou après `DOMContentLoaded`), pour que vos boutons existent déjà :

```html
<script src="<PORTAIL_FOLKOS>/sdk/folkos-tablette.js" data-brouillons></script>
```

- **Hors cadre** (navigateur normal) : il ne fait rien.
- **Dans un cadre** (tablette, ordinateur en jeu) : il signale l'adresse et le titre de la page, et les
  brouillons fonctionnent.
- **Les onglets** n'existent que dans les tablettes qui les proposent.
- **`fbfa-bridge.js` ou ce script, jamais les deux.** Les deux envoient l'adresse de la page : ce
  script fait tout ce que fait `fbfa-bridge.js` (avec en plus la partie après le `?`, le titre, les
  onglets et les brouillons). S'il est chargé, retirez `fbfa-bridge.js`.

```js
const tablette = window.FolkOSTablette;   // absent si le script n'a pas pu se charger

// Proposer « ouvrir dans un onglet » seulement quand c'est possible
let ongletPossible = false;
tablette?.pret(({ max, ouverts }) => {
  ongletPossible = ouverts < max;
  document.body.classList.toggle('multi-onglet', ongletPossible);
});

// Ouvrir une page dans un nouvel onglet : chemin RELATIF de votre site.
// ouvrirOnglet renvoie true même si le maximum est atteint : d'où le test de ongletPossible.
document.querySelector('#ouvrir-a-cote')?.addEventListener('click', () => {
  if (ongletPossible && tablette.ouvrirOnglet('/dossiers/42', { titre: 'Dossier 42' })) return;
  location.href = '/dossiers/42';   // pas d'onglet possible : navigation normale
});

// Nommer l'onglet (sinon : document.title)
tablette?.titre('Dossier 42');
```

**Brouillons** (`data-brouillons`) : fermer la tablette détruit la page, et ce que le joueur avait
saisi serait perdu. Avec cet attribut, le script recopie chaque champ touché dans le `localStorage` de
**votre** site (rien ne sort du navigateur du joueur) et le remet en place au retour, un brouillon par
page et par onglet.

- Jamais copiés : mots de passe, champs cachés, fichiers, et tout champ ou bloc marqué
  `data-brouillon="non"`.
- Les codes à usage unique et les cartes bancaires ne sont reconnus que par leur attribut
  `autocomplete` (`one-time-code`, `cc-…`) : sans lui, marquez-les `data-brouillon="non"`.
- Effacé à l'envoi réussi du formulaire, au bout de 12 heures, ou par
  `window.FolkOSTablette?.oublierBrouillon()`.
- Formulaire enregistré « en place » (un `fetch`, puis il reste affiché) : appelez
  `window.FolkOSTablette?.oublierBrouillon()` après l'enregistrement, sinon le brouillon reviendrait par-dessus.
- Donnez un `name` ou un `id` à vos champs (ou `data-brouillon-cle="…"`), sinon ils sont repérés par
  leur rang dans la page, ce qui est fragile.

Règles :

- un chemin d'onglet est **toujours relatif** (`/dossiers/42`), jamais une URL complète ;
- un nouvel onglet arrive directement sur la page demandée, avec la session déjà ouverte : votre cookie
  de session doit être `SameSite=None; Secure` (B4) ;
- **8 onglets au plus** : chaque onglet est une copie complète de votre appli. Si votre page interroge
  le serveur en boucle, espacez quand l'onglet est caché (`document.visibilityState`).

## B11. Liste de contrôle · en jeu

**Affichage**
- [ ] Aucun `alert`, `confirm`, `prompt`, `print`, `beforeunload` dans le code du navigateur
      (recherche de B2 vérifiée ligne par ligne).
- [ ] Une seule CSP, avec le `frame-ancestors` complet, sur toutes les réponses ; pas de
      `X-Frame-Options`.
- [ ] Cookies de session `SameSite=None; Secure` en production.
- [ ] Écritures (POST) testées en jeu : rien ne casse si `Origin` vaut `null`.
- [ ] `Referrer-Policy` en `same-origin` ou `strict-origin-when-cross-origin` ; `Content-Type` bien
      formé.
- [ ] `fbfa-game.js` inclus et initialisé (`autofocus` et `escape` réglés comme en B5) : les champs sont
      saisissables en jeu.
- [ ] `fbfa-bridge.js` inclus (ou `folkos-tablette.js`, jamais les deux) : la barre d'adresse suit les
      pages.
- [ ] Le site accepte `?_cb=…`, n'utilise ni `window.open`, ni `target="_blank"`, ni `window.top`.
- [ ] Modales en portail, Échap consommée, touches en minuscules, `[hidden]` forcé.
- [ ] Le comportement hors jeu est inchangé.

**Connexion FolkOS (si utilisée)**
- [ ] Backend hébergé chez nous, endpoint `GET /api/folkos` sous `*.fbfa.fr`.
- [ ] `token:` et non `ticket:` dans l'appel à `/sso/verify`.
- [ ] Cookies `fbfa_sso_<client_id>_*` transmis dans `nonces` (les 16 plus récents), jamais journalisés.
- [ ] Test de démo, test par le portail **et** test par l'ordinateur en jeu (si votre site y est
      proposé) qui répondent `nonce_check: "ok"`.
- [ ] Compte retrouvé **jamais** par `sub` : par `unique_id` de préférence (ou `discord_id`) pour un
      compte par joueur, par `unique_id` + `character_id` pour un compte par personnage ; identifiants
      convertis en texte.
- [ ] Pas de création de compte automatique si le site est à accès restreint.
- [ ] `?next=` validé en chemin relatif, routes de passage exclues ; `_sso` ajouté à l'arrivée ;
      `Cache-Control: no-store` sur toutes les réponses de l'endpoint.
- [ ] `point_id` lu seulement dans l'identité, jamais dans l'URL.
- [ ] Endpoint protégé par un `try`/`catch` : une erreur renvoie vers la connexion, sans arrêter le
      serveur.
- [ ] `FOLKOS_CLIENT_SECRET`, ticket et nonces jamais envoyés au navigateur ni écrits dans les journaux.

**API du jeu (si utilisée)**
- [ ] Tous les appels à `https://external-iframe/…` ont un `.catch` ou un `try`/`catch`.
- [ ] Page possible sur un écran dans le monde : script de B9.3 collé, touches acceptées seulement de
      `https://cfx-nui-external-iframe`.
- [ ] Curseur toujours réaffiché en sortie.
- [ ] Jeton `?token=` vérifié côté serveur en RS256, jamais gardé comme session, réservé aux usages sans
      enjeu.
- [ ] Sans `fbfa-game.js` : Échap gérée à la main (B9.6).

**Tablette (si utilisée)**
- [ ] `folkos-tablette.js` chargé sans `async`, appels protégés par `?.`.
- [ ] Champs sensibles sans `autocomplete` adapté marqués `data-brouillon="non"`.

**Et surtout : site testé dans le jeu.**

---

# Partie C · Site déjà en place : ce qui a changé

Votre site est déjà hébergé ? Vérifiez ces points, du plus urgent au moins urgent.

| Depuis | Ce qui change | Qui | Quoi faire |
|---|---|---|---|
| 6 novembre 2026 | **Liaison du ticket au navigateur** : `nonces` obligatoire dans `/sso/verify` | sites branchés à FolkOS | B8.5. Votre site continue de fonctionner le temps de la mise à jour ; **prévenez l'opérateur quand elle est en ligne**. Dès que vos connexions répondent `nonce_check: "ok"` par le portail et par l'ordinateur en jeu (si votre site y est proposé), la liaison devient exigée pour votre site : sans `nonces` valables, plus aucune connexion n'aboutit. |
| début novembre 2026 | Le navigateur du jeu passe en **Chromium 144** : un POST peut arriver avec `Origin: null` | sites en jeu | B7 : testez toutes vos sauvegardes en jeu. Les Server Actions de Next.js 15 sont touchées. |
| — | **Reprise de page** : FolkOS repasse la dernière page visitée dans `?next=` | sites en jeu avec connexion | B6 et B8.7 : incluez `fbfa-bridge.js` (ou `folkos-tablette.js`) et validez `next`. |
| — | **Écrans dans le monde** : la page ne reçoit plus de vraies touches | pages qui peuvent être mises sur un écran | B9.3 : collez le script des champs. |
| — | **Tablette à onglets et brouillons** | sites en jeu (optionnel) | B10. |

Pour la mise à jour de la liaison, seules ces lignes changent dans votre appel :

```
Avant : { "client_id": "...", "client_secret": "...", "token": "<le ticket>" }
Après : { "client_id": "...", "client_secret": "...", "token": "<le ticket>", "nonces": ["<valeur>", "…"] }
```

La lecture des cookies est la fonction `noncesFolkos` de B8.9 (ou les quelques lignes `nonces` de
B8.10 en Next.js). Pour vérifier, journalisez seulement `nonce_check` et ouvrez votre site par le
portail, puis par l'ordinateur en jeu si votre site y est proposé : chaque entrée doit répondre `ok`.

Et comme pour un nouveau site : chaque grosse mise à jour repasse par l'analyse de l'opérateur (A1).

---

# Partie D · Prompts pour un assistant IA

Joignez ce fichier et collez le prompt qui correspond.

**Site seulement web :**

> Ce projet (stack : `<STACK>`) doit être hébergé chez FBFA. Applique toutes les règles de la Partie A
> du guide joint sans changer le reste du comportement, vérifie chaque point de la liste A11, puis
> indique les fichiers modifiés et ce qui reste à voir avec l'opérateur.

**Site affiché en jeu :**

> Ce projet (stack : `<STACK>`, URL : `<URL_DU_SITE>`) doit être hébergé chez FBFA et s'afficher en jeu.
> L'ordinateur en jeu est `<HÔTE_FOLKOS>` et le portail `<PORTAIL_FOLKOS>`. Applique les règles des
> Parties A et B du guide joint qui concernent ce projet, sans changer son comportement hors jeu.
> Vérifie chaque point des listes A11 et B11, puis indique les fichiers modifiés, le chemin de
> l'endpoint FolkOS si tu l'as créé, et ce qui reste à voir avec l'opérateur.

**Site déjà en place :**

> Ce projet est déjà hébergé chez FBFA. Lis la Partie C du guide joint et applique chaque changement
> qui le concerne, sans rien changer d'autre. Indique les fichiers modifiés et ce qu'il faut tester en
> jeu.
