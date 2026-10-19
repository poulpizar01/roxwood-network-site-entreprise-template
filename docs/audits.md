# Prompts d'audit

Une revue généraliste (« est-ce prêt pour la prod ? ») trouve surtout un type de problème et passe à côté des autres. Ces prompts découpent l'audit en **angles indépendants**, à lancer séparément avant une mise en prod, après une grosse fonctionnalité, ou périodiquement.

Dans Claude Code : `/audit` lance les sept angles en parallèle et fusionne les rapports, `/audit <angle>` un seul (voir `.claude/skills/audit/`). Ce fichier est la seule source des prompts : les modifier ici suffit.

Fichier du socle : on l'améliore dans le modèle, chaque site le récupère avec le reste du socle. Les angles couvrent le socle **et** le code de l'entreprise : dans un site, c'est surtout ce dernier qui change d'un audit à l'autre.

## Format de sortie commun

À ajouter à la fin de chaque prompt :

```
Lis CLAUDE.md (et ENTREPRISE.md qu'il importe), docs/api.md et docs/webhooks.md avant de commencer : les règles qui y figurent sont des décisions déjà prises, ne les remets pas en cause et ne signale pas comme défaut un comportement qui y est documenté comme volontaire.

Pour chaque problème trouvé :
- fichier:ligne
- scénario concret de défaillance (quelles entrées / quel état → quel résultat faux, crash ou fuite)
- correction proposée
- gravité : Indispensable avant prod / Fortement conseillé / Mineur
- zone : socle (server/src/index.ts, server/src/socle/, socle/, socle.prisma, compose, docs…) ou entreprise (le reste)

Classe les problèmes par gravité. Ne signale rien que tu n'as pas vérifié dans le code. N'écris aucune modification : rapport uniquement, en français.
```

## 1. Accès et sessions (serveur)

```
Audite uniquement le contrôle d'accès du serveur (server/src).
Cherche :
- toute route /api ou /auth de server/src/entreprise/ ou server/src/socle/ sans garde (...connecte, ...valide, ...permission de socle/http.ts), avec une garde plus faible que celle annoncée dans docs/api.md ou ENTREPRISE.md, ou une garde passée sans être étalée ;
- les pages de gestion/ qui affichent des données réservées à une permission sans être déclarées avec cette permission dans entreprise.pages (server/src/entreprise/index.ts) ;
- les vérifications « auteur ou permission » contournables en changeant un identifiant dans l'adresse ou le corps ;
- l'escalade de droits : un compte qui se donne un grade, modifie un compte ou un grade égal ou supérieur au sien, accorde une permission qu'il n'a pas, garde un grade lié à un rôle Discord qu'il n'a plus ; le propriétaire revérifié à chaque connexion, et l'ancien propriétaire qui perd ses permissions après un transfert du serveur ;
- la connexion Discord : paramètre state, appartenance au serveur vérifiée, session régénérée, comptes en attente ou refusés qui accèdent quand même à des données ;
- DEV_LOGIN activable en production, ou tout autre raccourci de dev qui survit en prod ;
- les requêtes qui modifient des données déclenchables depuis un autre site (SameSite, vérification d'origine) ;
- les limites de requêtes contournables (clé de limitation, confiance au proxy).
- la priorité entre grade attribué à la main et grade donné par un rôle Discord : un grade inférieur lié à un rôle porté par tous ne doit faire tomber personne ;
- les droits obtenus de biais : une permission qui en donne une autre en pratique (lier un rôle Discord à un grade valide des comptes), un compte refusé qui efface son refus (suppression puis reconnexion) ;
- les champs de l'entreprise qui portent un grade ou un niveau (fiche employé, salaire, rôle métier) : bornés sous celui de l'acteur comme les comptes, et jamais modifiables sur sa propre fiche ;
- les données rattachées à un compte par un nom qu'il peut changer lui-même (nom RP) plutôt que par son identifiant Discord ;
- les requêtes GET qui modifient des données (marquer comme lu…) : déclenchables depuis un autre site avec FolkOS (cookie SameSite=None, Origin non contrôlé sur GET).
```

## 2. Navigateur (XSS, CSP, fichiers servis)

```
Audite uniquement ce qui s'exécute ou s'affiche dans le navigateur, et ce que le serveur expose comme fichiers.
Cherche :
- toute donnée venant d'un utilisateur, de Discord ou du bot (nom RP, pseudo, texte saisi, contenu d'un webhook) insérée par innerHTML, insertAdjacentHTML ou dans un attribut sans socle.esc(), dans gestion/*.html, gestion/*.js, les scripts de la vitrine et socle/socle.js ;
- les URL construites depuis une donnée (href, src) qui accepteraient javascript: ou une autre origine ;
- la CSP (server/src/socle/security.ts) et entreprise.csp : origines trop larges ou non justifiées, ressource externe chargée sans y être déclarée, attributs onclick inopérants ;
- les {{…}} placés dans une chaîne JavaScript (piège documenté dans CLAUDE.md) et l'échappement des valeurs de site.json dans site.ts ;
- les fichiers servis : vérifie que server/, site.json, ENTREPRISE.md, compose*.yaml, .env, docs/ restent inaccessibles, y compris via encodage (%2e%2e, double slash, majuscules) ;
- les données renvoyées au navigateur sans besoin (champs de comptes d'autres employés, identifiants internes, contenu brut d'un webhook), y compris dans la réponse d'une modification (PATCH) et pas seulement des lectures ;
- les réponses personnelles que le navigateur pourrait garder en cache (en-tête Cache-Control: no-store sur /api et /auth).
- les routes publiques (vitrine) qui renvoient des champs qu'aucune page n'affiche (auteur, dates internes, identifiants de compte), et les routes de l'API qu'aucune page n'appelle ;
- les valeurs dérivées d'une donnée utilisateur (initiales, extrait, titre raccourci) insérées sans échappement, et les replis (`x || valeur`) qui insèrent la valeur brute ;
- la CSP : nonce réutilisé entre réponses ou prévisible ;
- confidentialite.html face à ce que la vitrine publie réellement (qui apparaît sur une page publique, sous quel nom) et aux origines d'images chargées (stockage, Discord).
- les contenus d'un tiers (cadre, lecteur, carte, script) : chacun déclaré dans entreprise.csp et décrit dans confidentialite.html (ce que le tiers reçoit, et quand) ; une adresse qui doit rester cachée envoyée au navigateur au lieu de passer par un relais ;
- les liens qui ouvrent un contenu principal du site dans un autre onglet (target=_blank, window.open) ou qui envoient le visiteur chez le tiers qui l'héberge (« Ouvrir sur … ») au lieu de l'afficher sur la page ;
- le CSS ou les API que le navigateur de l'ordinateur en jeu ne connaît pas (:has(), color-mix(), plein écran, transitions entre documents) utilisés sans repli ;
- un identifiant (id) posé par la coque de la gestion qui existe aussi dans une page (le script de la coque agirait sur l'élément de la page) ;
- le cahier des charges de l'ordinateur en jeu (docs/folkos.md, dernier tableau) : print() ou beforeunload, raccourci sur une lettre sans toLowerCase(), dépendance à window.top ou document.referrer, page qui casse avec un paramètre inconnu (?_cb=…), envoi de fichier sans texte .seulement-en-jeu, fenêtre position:fixed enfermée dans un parent à transform, filter, backdrop-filter, perspective ou contain.
```

## 3. Webhooks et intégrations

```
Audite uniquement ce qui entre dans le site depuis l'extérieur sans utilisateur connecté, et ce que le site appelle à l'extérieur.
Cherche :
- la réception des webhooks (server/src/socle/routes/webhooks.ts) : signature contournable, comparaison non constante, corps relu avant vérification, contrôle du serveur Discord, dédoublonnage (rejeu, deux livraisons simultanées), réponse qui fuirait une donnée ;
- les traitements de l'entreprise (entreprise.webhooks) : non idempotents (create aveugle sur un événement renvoyé à chaque changement de statut), confiance dans la forme du payload, texte non borné, erreur levée pour une donnée invalide (le bot réessaierait 10 fois pour rien), traitement long qui dépasse les 10 s du bot ;
- le contrat avec le bot : compare les champs lus par les traitements au code du bot (dépôt https://github.com/poulpizar01/roxwood-network-entreprise, appels à dispatchWebhook dans src/services/) ; signale tout champ utilisé qui n'existe pas ou a changé de forme ;
- les appels sortants du site (fetch dans server/src/entreprise/, stockage, Discord) : délai maximal, réponse d'erreur traitée, adresse construite depuis une donnée utilisateur (SSRF), secret écrit dans un journal ; un appel au bot Discord qui contourne socle/discord.ts, un message posté sans mentions bornées (posterMessage), un chemin d'API Discord construit avec un identifiant non vérifié ;
- les tâches qui lisent Discord à intervalle régulier : cadence face aux limites de Discord (429), reprise après une coupure sans relire ni perdre de messages, verrou contre deux passes simultanées ;
- l'ordre et les transitions d'état : événements reçus dans le désordre (une nouvelle tentative arrive après un événement plus récent), retour en arrière d'un statut (refusé puis accepté), événement sur un objet inconnu ignoré au lieu d'être consigné ;
- les champs attendus du bot qui n'existent que sur une branche non publiée ou non déployée ;
- les réponses d'erreur qui déclenchent des nouvelles tentatives inutiles (500 pour un corps trop lourd ou une donnée invalide, au lieu d'un 4xx) ;
- les relais vers un service tiers (hôte annexe) : adresse cible construite par concaténation (une cible de requête en forme absolue change l'hôte), méthodes et taille des corps acceptées, absence de limite de requêtes ;
- les données personnelles reçues (réponses d'un formulaire) gardées ailleurs que là où elles sont purgées (webhooks_recus, sauvegardes), et un résumé affiché (nom reçu) qui pourrait reprendre une donnée sensible ;
- le comportement quand un service appelé est lent, coupé ou répond une erreur : page bloquée, erreur affichée, nouvelle tentative en boucle.
```

## 4. Fiabilité, ressources et déploiement

```
Audite uniquement la fiabilité en exploitation et la consommation de ressources.
Cherche :
- les erreurs non attrapées qui arrêtent le serveur (routes async, minuteurs de entreprise.demarrage, traitement d'image, appels sortants, flux SSE — dont une écriture sur un flux déjà fermé sans écouteur d'erreur) ;
- la mémoire : traitement d'image (sharp, avec cache et parallélisme coupés) par rapport au plafond du conteneur, caches en mémoire sans borne, listes chargées en entier sans limite (take) ;
- l'envoi d'images : enregistrerImage contourné, fichiers orphelins sur le stockage après une erreur ou une suppression (lignes effacées avant les fichiers) ;
- la base : tables qui grossissent sans fin (sans purge), requêtes sans index sur des colonnes filtrées ou triées, migrations non commitées, migration qui exige un super-utilisateur, référence à un compte sans nettoyage dans avantSuppressionCompte ;
- le démarrage : variables d'environnement de l'entreprise manquantes ou invalides détectées tôt avec un message clair, ou erreur obscure plus tard ;
- le déploiement : compose.yaml (limites mémoire, ports en loopback, sauvegardes restaurables), nginx (docs/nginx.md, routes longues de l'entreprise sans leur bloc location), cookies Secure derrière le proxy ;
- les règles de l'hébergement (CLAUDE.md, « Déploiement ») : aucun volume Docker de médias, fichier nginx <domaine>.conf avec bloc HTTP réservé au défi ACME, include snippets/deny-hidden.conf, X-Forwarded-Proto et X-Forwarded-Host transmis.
- les middlewares et gestionnaires async dont la promesse n'est pas renvoyée (hôte annexe, minuteur) et les lectures de corps de réponse (`text()`, `arrayBuffer()`) hors du try : un rejet non attrapé arrête Node ;
- les relais qui gardent une réponse entière en mémoire sans plafond au lieu de la transmettre en flux ;
- le coût algorithmique : calcul par employé qui reparcourt toute une table (employés × lignes), tables entières relues à chaque requête d'une page ;
- les sondages côté navigateur (setInterval) qui continuent dans un onglet caché et partagent la limite de requêtes du compte avec le reste de l'API ;
- les tâches périodiques qui peuvent se chevaucher (pas de verrou « en cours ») ou rester bloquées sur les mêmes lignes en échec en tête de file ;
- les fichiers déposés sur le stockage avant une écriture en base qui échoue (retirer le fichier dans le catch) ;
- les réglages qui ne doivent plus changer en exploitation (STORAGE_PREFIX…) et qui le disent.
```

## 5. Socle et règles du modèle

```
Vérifie uniquement le respect des règles propres à ce modèle, décrites dans CLAUDE.md et docs/modele.md.
Cherche :
- dans un site créé depuis le modèle : toute différence entre les fichiers du socle (liste dans CLAUDE.md) et ceux du modèle (git remote « modele » s'il existe : git diff modele/main -- <fichiers du socle>) ; chaque différence est un point à reporter dans le modèle ou à annuler ;
- dans le dépôt modèle : contenu propre à une entreprise (nom, lieu, métier) hors de l'exemple « annonces » ;
- le contrat (server/src/socle/contrat.ts) : pages de gestion/ absentes de entreprise.pages alors qu'elles demandent une permission, permissions déclarées mais jamais utilisées (ou l'inverse), relation Prisma vers Compte dans entreprise.prisma ;
- les pages de gestion/ sans meta application-name, sans theme.css, ou sans socle.js avant leurs scripts ; les noms imposés (index, attente, refuse, accueil) présents ;
- les routes qui lisent req.session hors de /api et /auth ;
- les débordements horizontaux et le menu aux largeurs 375, 768, 1 024 et 1 280 px (lecture du CSS, sans navigateur : signale seulement les cas certains) ;
- une fonctionnalité, une route, une variable d'environnement ou une table ajoutée sans mise à jour de ENTREPRISE.md, .env.example, confidentialite.html ou docs/ ;
- les commentaires qui racontent une modification passée au lieu de décrire l'invariant actuel.
- les commentaires qui renvoient à du code, des tables ou des fichiers qui n'existent plus (ancienne version, renommage), et le code mort (constantes, fonctions jamais appelées) ;
- les fichiers mutualisés hors des deux listes de CLAUDE.md (.gitignore, .gitattributes) qui diffèrent du modèle ;
- les routes de l'entreprise absentes du tableau de ENTREPRISE.md.
- un lien, un identifiant Discord ou une adresse de service écrit en dur dans une page ou un script au lieu d'être déclaré dans entreprise.parametres (Paramètres) ;
- un contenu recopié dans le code depuis sa source (texte, images, tarifs d'un document tenu ailleurs) : deux versions qui finiront par se contredire ;
- une règle de conception corrigée dans le code mais absente de docs/design.md (elle se reproduira ailleurs), ou une règle propre à un site écrite dans le modèle (elle va dans ENTREPRISE.md).
```

## 6. Ergonomie et accessibilité (gestion et vitrine)

```
Audite l'ergonomie, l'accessibilité et le responsive des pages : gestion/*.html et leurs scripts, la vitrine (pages de la racine, assets/js, assets/css, theme.css). Lis d'abord docs/design.md : c'est la grille de cet audit, et chaque règle y cite l'erreur qu'elle évite. Ces règles portent sur le comportement : ne signale pas une différence d'apparence avec le modèle ou un autre site (chaque site a sa direction artistique). Lis le code ; si le site tourne en dev (docker compose up, connexion de dev par /auth/discord), vérifie aussi dans un navigateur à 375, 768, 1 024 et 1 280 px de large, et à 800 px de haut, avec les barres de défilement visibles (un navigateur automatisé les masque par défaut) et de vraies données chargées (une page vide ou en erreur cache les débordements).
Cherche :
- une rubrique du menu, le compte connecté ou la déconnexion inatteignables à une largeur ou une hauteur d'écran (zone en display:none, barre de 100vh sans défilement, menu horizontal qui défile sans indice) ;
- un débordement horizontal de la page, un tableau qui défile de côté ou dont les actions sont coupées ou hors de vue, un élément flottant (bulle, bouton fixe) qui masque du contenu ou une action ;
- une fenêtre (confirmation, modale, tiroir) sans focus initial, dont Tab sort, que Échap ne ferme pas, qui ne rend pas le focus, ou dont le titre n'est pas relié (aria-labelledby) ; un confirm(), alert() ou prompt() (invisibles en jeu, docs/folkos.md) ;
- un champ sans nom accessible (placeholder seul), un bouton à icône seule sans aria-label, une page sans <h1>, une image porteuse de sens sans alt, un focus clavier invisible, une information donnée par la seule couleur ;
- un texte sous 12 px, un contraste sous 4,5:1 (3:1 pour un gros titre, un contour de champ, une icône utile), une cible cliquable sous 24 px ;
- les textes : bouton de confirmation qui ne nomme pas l'action (« Confirmer », « OK ») ou rouge pour une action non destructive, erreur qui affiche le message technique sans dire quoi faire, état vide sans piste pour commencer, même chose nommée différemment d'une page à l'autre ;
- les incohérences entre pages : place du bouton principal, familles d'icônes (trait ou emoji), formats des dates, durées et montants.
- ce qui saute ou clignote à l'affichage : page affichée sans menu puis décalée, bloc qui arrive et pousse un contenu déjà lu, libellé dont la longueur change et fait bouger ses voisins, titre qui s'allonge et fait passer la barre d'outils dessous, police qui se charge après le premier affichage, fond animé qui apparaît d'un coup, transition de page qui passe par une page vide ;
- une flèche ou un chevron écrit en caractère (← → ↗ ‹ › ↑ ⌄) dans un bouton, un lien, un sélecteur ou un en-tête de tri, au lieu d'être dessiné ;
- une page qui défile pour ne montrer que du vide (réserve de bas de page inutile), une zone qui défile dans une autre, un cadre ou un décor fixé au bord de l'écran ;
- un tableau dont le passage en cartes dépend d'un seuil de largeur d'écran plutôt que de la place mesurée, une colonne d'actions élargie qui fait déborder le tableau à 1 280 px ;
- un menu de gestion qui porte autre chose que la navigation et le compte, ou qui défile à 800 px de haut avec toutes les permissions ;
- deux liens vers la même destination dans un même bloc, un lien qui ne fait pas ce qu'il annonce, un bouton « Afficher » pour un contenu attendu ;
- un texte qui parle à un développeur (nom de variable, .env, fichier, « webhook »), un terme inventé, une période nommée en relatif (« hier », « semaine prochaine ») ;
- une annonce automatique (aria-live) sur une information relue périodiquement, qui serait relue à chaque passage.
Ici, le scénario de défaillance est : quelle largeur ou quel moyen (souris, clavier, lecteur d'écran, ordinateur en jeu) → ce que la personne ne peut pas faire ou pas voir.
```

## 7. Argent et données personnelles sensibles

```
Audite uniquement les calculs financiers et les données personnelles sensibles de l'entreprise (salaire, primes, paie, comptabilité, fiches employé, ou tout équivalent propre au site).
Cherche :
- les calculs d'argent (paliers de prime, taux horaire, barème d'imposition, rémunération par grade, relevé de comptabilité) : arrondi incohérent entre l'affichage et la valeur enregistrée, borne de palier mal incluse ou exclue, montant négatif ou nul non géré, devise ou unité mélangée (heures vs minutes, euros vs centimes) ;
- l'import de données externes utilisées pour calculer de l'argent (tableur, CSV collé, webhook) : une ligne réimportée ou modifiée comptée deux fois, une table de « doublons » qui ne couvre pas tous les cas de reprise, un import interrompu qui laisse les tables d'état et d'archive incohérentes entre elles ;
- les champs personnels sensibles (téléphone, RIB, adresse, ou tout champ marqué comme tel dans permissions.ts) : lisibles par une permission plus large que celle déclarée, renvoyés dans la réponse d'une route qui n'en a pas besoin (liste, export, recherche), visibles dans un journal ou une erreur ;
- la conservation : une durée ou une suppression annoncée dans confidentialite.html sans tâche de purge qui l'applique réellement, ou une purge qui efface moins (ou plus) que ce que la page promet ;
- l'historique d'un montant qui change de barème ou de palier a posteriori (nouveau taux appliqué à une période déjà close, ou l'inverse) ;
- une somme recalculée à chaque affichage à partir de lignes détaillées sans transaction : deux lectures simultanées pendant un import verraient un total différent ;
- une donnée sensible rattachée à un compte par un nom ou un identifiant modifiable plutôt que par l'identifiant Discord (reprend le risque de l'angle 1, du point de vue du champ sensible plutôt que du grade).
```
