# Ordinateur en jeu (FolkOS)

Sur un serveur FiveM qui fournit un ordinateur en jeu (FolkOS), le site peut s'afficher dans le navigateur de cet ordinateur, et les employés s'y connecter sans Discord (« Se connecter IG »). **Désactivé par défaut** : sans réglage, le site refuse d'être affiché dans une autre page (`frame-ancestors 'none'`) et rien ne change.

## Réglages (`.env`)
| Variable | Effet |
|---|---|
| `FOLKOS_HOTE` | Origine de l'ordinateur en jeu (`https://…`, sans chemin), fournie par l'opérateur. Active l'affichage en iframe et le SDK de l'opérateur. |
| `FOLKOS_CADRES` | Facultatif : autres pages autorisées à encadrer le site (origines `https://`, joker de sous-domaine admis, ou schémas comme `nui:`), séparées par des espaces. |
| `FOLKOS_ID_BASE`, `FOLKOS_CLIENT_ID`, `FOLKOS_CLIENT_SECRET` | Connexion « IG » : adresse du validateur SSO de l'opérateur (http admis : il est souvent sur la même machine) et identifiants du site. Les trois ensemble, et `FOLKOS_HOTE` avec. Validateur sur la même machine : `http://host.docker.internal:<port>` (déclaré dans `compose.yaml`), à condition qu'il écoute aussi sur l'adresse du pont Docker (`ip -4 addr show docker0`) et pas seulement sur `127.0.0.1`, et que le pare-feu de la machine laisse passer les réseaux Docker (172.16.0.0/12) vers son port ; sinon, son adresse publique en https. |

Le serveur refuse de démarrer sur un réglage incomplet ou mal formé.

## Ce qui change quand `FOLKOS_HOTE` est réglé
- **Affichage en iframe** : `frame-ancestors` autorise le site lui-même, `FOLKOS_HOTE`, les cadres de FiveM (`https://cfx-nui-external-iframe`, `nui://game`, `nui:`) et `FOLKOS_CADRES`. Le navigateur FiveM vérifie chaque ancêtre : s'il en manque un, la page reste blanche sans message. `X-Frame-Options` n'est plus envoyé (il ne sait pas exprimer une liste et contredirait la règle).
- **Cookie de session** en `SameSite=None; Secure` : dans l'iframe, le site est « un autre site » pour le navigateur, qui n'y enverrait jamais un cookie `Lax`. Le contrôle de l'en-tête `Origin` (`server/src/index.ts`) devient alors la seule protection contre les requêtes d'un autre site : le garder. En `http://localhost` (dev), le cookie reste `Lax`.
- **SDK de l'opérateur** : le serveur ajoute `/socle/folkos.js` en tête de chaque page HTML (aucune page n'a à l'inclure). Hors iframe il ne fait rien ; dans l'ordinateur en jeu, il charge `fbfa-game.js` (clavier rendu au site dès qu'un champ a le focus, Échap laissé à la page) et `fbfa-bridge.js` (la barre d'adresse suit la page) depuis `FOLKOS_HOTE`, pose la classe **`en-jeu`** sur `<html>` et ouvre les liens `target="_blank"` dans le cadre. La politique de sécurité autorise `FOLKOS_HOTE` pour les scripts, styles, images et requêtes.
- **À faire côté site** : l'ordinateur en jeu n'a pas de sélecteur de fichiers et l'ajout d'image par lien n'existe pas (docs/stockage.md) : un envoi d'image se fait depuis un vrai navigateur, à dire près du bouton ; couper ce qui coûte au GPU quand `<html>` a la classe `en-jeu` (WebGL, animations plein écran : le GPU est partagé avec le jeu) ; aucune boîte de dialogue native (`alert`, `confirm`, `prompt`) ni `beforeunload`, que le navigateur FiveM n'affiche pas ; mentionner dans `confidentialite.html` que, en jeu, la page charge le SDK de l'opérateur.

## Connexion « IG »
Le broker de l'opérateur ouvre `<BASE_URL>/auth/folkos?folkos_ticket=…` (adresse à lui déclarer) ; `&next=/gestion/…` facultatif.
1. Le ticket est vérifié auprès de `FOLKOS_ID_BASE/sso/verify` (10 s au plus) ; seule cette réponse fait foi.
2. Le compte est retrouvé par l'**ID Discord** de l'identité renvoyée. Il doit déjà exister : la première connexion se fait par Discord, depuis un navigateur.
3. FolkOS ne connaît ni le serveur Discord ni les rôles : la connexion IG n'est acceptée que si la **dernière connexion Discord date de moins de 30 jours**. Ainsi, un employé parti du serveur Discord perd aussi l'accès en jeu au plus tard 30 jours après sa dernière connexion Discord.
4. Session ouverte comme pour Discord ; compte en attente → page d'attente ; sinon `next` (chemin du site uniquement) ou l'accueil.

Erreurs renvoyées à `gestion/?erreur=folkos-…` : `config`, `ticket`, `reseau`, `inconnu`, `discord`, `serveur` (messages dans `gestion/index.html`).

## Cahier des charges de l'opérateur : ce que fait le socle, ce que fait le site

L'opérateur de l'ordinateur en jeu fournit une liste d'exigences (navigateur FiveM : Chromium embarqué, ancien et bridé). Chacune est couverte ainsi ; la colonne « Site » est à vérifier à chaque nouvelle page (les audits « navigateur » et « ergonomie » le contrôlent, `docs/audits.md`).

| Exigence | Socle (rien à faire) | Site |
|---|---|---|
| Aucune boîte native (`alert`, `confirm`, `prompt`, `print`, `beforeunload`) : elles gèlent tout le jeu | `gestion.confirmer`, `gestion.notifier`, fenêtres `.modale-fond` (gestion.js) | n'en écrire aucune ; erreurs dans la page |
| Cadrage : `frame-ancestors` avec toute la chaîne (`nui://game`, `https://cfx-nui-external-iframe`, l'hôte, les autres pages de l'opérateur), en en-tête HTTP, sans `X-Frame-Options`, en HTTPS | `security.ts` avec `FOLKOS_HOTE` et `FOLKOS_CADRES` (ex. `https://*.fbfa.fr https://fbfa.fr`) ; un relais servi à part (`entreprise.hotes`) pose le sien (voir la WebMap d'un site) | régler les deux variables ; page blanche : console F8, message « ancestor violates frame-ancestors » |
| Cookie de session `SameSite=None; Secure` | automatique avec `FOLKOS_HOTE` en HTTPS | — (pas de repli par jeton : un jeton lisible par les scripts de la page serait exposé à toute faille d'affichage ; le cookie suffit en HTTPS) |
| SDK clavier `fbfa-game.js` (`typing: field`, `escape: false` : le site est une page du navigateur) et suivi d'adresse `fbfa-bridge.js` | chargés par `socle/folkos.js`, injecté dans chaque page | une page entièrement au clavier demande `typing: 'always'` à l'opérateur |
| Touche avec Maj : `e.key` arrive en majuscule | — | un raccourci sur une lettre compare `e.key.toLowerCase()` |
| Pas de `window.open` ni `target="_blank"` (n'ouvrent rien) | `folkos.js` les ouvre dans le cadre | un contenu principal se lit dans la page (docs/design.md, §8) |
| Pas d'accès à la fenêtre parente (`window.top…`), pas de `document.referrer` (vide) | — | n'en dépendre pour rien ; tester `window.self !== window.top` suffit à savoir qu'on est en jeu |
| Une adresse avec `?_cb=…` (anti-cache ajouté par FolkOS) ne casse rien | le serveur ignore les paramètres inconnus | une page ne lit que les paramètres qu'elle connaît |
| Sélecteur de fichiers peu fiable | pas d'envoi par lien : refusé par conception (docs/stockage.md : un fichier envoyé est le seul contrôlable) | près de chaque envoi, un texte `.seulement-en-jeu` : « si rien ne s'ouvre, ajoutez l'image depuis un navigateur » |
| CSS récent instable (`color-mix()`, `line-height: 0`, `:has()`) | le modèle n'en utilise pas ; teintes calculées par le site (`{{couleur_rvb}}`, `{{couleur_sombre}}`) | n'en écrire aucun (docs/design.md, §10) |
| Fenêtre `position: fixed` piégée par un ancêtre | fenêtres de la coque ajoutées à `<body>`, z-index élevé | une fenêtre de page est enfant de `<body>` (ou d'un parent sans `transform`, `filter`, `backdrop-filter`, `perspective`, `contain`) |
| GPU partagé avec le jeu | `html.en-jeu` posé par `folkos.js` | couper WebGL et grosses animations sous `html.en-jeu` |
| Identité « IG » : endpoint unique, secrets côté serveur, seule la réponse du validateur fait foi, compte retrouvé par `discord_id` (jamais `sub`), `unique_id` lu en texte, `next` relatif, validateur sur la même machine | `/auth/folkos` (adresse à déclarer à l'opérateur, au lieu du `/api/folkos` de ses exemples) | déclarer l'adresse ; dire à l'opérateur que le site tourne sur la même machine que le validateur |
