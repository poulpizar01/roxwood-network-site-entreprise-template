# Conception des pages : règles, erreurs déjà commises, outils du modèle

Base de connaissance pour quiconque crée ou modifie une page, un composant ou un texte d'interface, sur le modèle comme sur un site qui en dérive. Chaque règle vient d'une erreur réellement commise puis corrigée sur un site du réseau : la ligne « Vu : » la décrit, pour qu'elle ne se reproduise pas. Les règles courtes et absolues sont dans `CLAUDE.md` (section *Ergonomie*) ; celles-ci les détaillent.

**À lire avant** d'écrire une page, un composant, une feuille de style ou un texte affiché. **À relire** avant de dire qu'un écran est fini : la dernière section dit comment le vérifier.

**Ce qui est commun, ce qui est libre.** Ces règles portent sur le comportement : rien ne saute ni ne déborde, tout reste atteignable, chaque texte se comprend, rien n'est en dur. Elles ne fixent pas l'apparence : chaque site a sa propre direction artistique (couleurs, polices, formes, mise en page, ton des textes) et ne doit pas ressembler aux autres. Les outils cités (`gestion.js`, `gestion.css`, dans `gestion/`) sont un point de départ : un site les habille à sa façon, les réécrit ou en change la forme, mais garde la règle qu'ils appliquent. Une solution donnée en exemple (« un indicateur qui ouvre un panneau ») dit quoi obtenir, pas à quoi cela doit ressembler.

---

## 1. Menu et coque de la gestion

- **Le menu ne porte que la navigation et le compte.** Une information qui se met à jour seule (qui est en service, des alertes) s'y réduit à un indicateur qui ouvre un panneau ; la liste complète va dans une page (l'accueil).
  Vu : une liste « En service » ajoutée sous le menu, avec sa propre barre de défilement, qui bougeait sur toutes les pages et repoussait le compte ; sur téléphone, elle n'était visible qu'en ouvrant le menu pour aller ailleurs.
- **Jamais deux zones qui défilent l'une dans l'autre.** Une seule zone défile dans le menu, la navigation ; le compte et la déconnexion restent fixés en bas. Ce qui est caché se signale par un fondu, la barre n'apparaît qu'au survol.
  Vu : la navigation et la liste en dessous défilaient chacune de leur côté ; la molette agissait sur l'une ou l'autre selon la position de la souris.
- **Rubriques sur une ligne, à hauteur fixe.** Viser que tout le menu tienne sans défilement à 800 px de haut (vérifier avec toutes les permissions) ; un libellé sur deux lignes donne une colonne en dents de scie.
- **Le menu est posé au premier affichage, avant toute réponse du serveur** (`gestion.coque()` le dessine d'après le compte gardé pour l'onglet, puis le corrige) ; sa place est réservée en CSS avant même l'appel.
  Vu : chaque page s'affichait d'abord sans menu, puis tout le contenu sautait de 256 px vers la droite.
- **Laisser respirer le logo** : au moins 16 px entre le logo et le premier titre de groupe.
- **Le site public est atteignable depuis la gestion par un lien nommé** (« Voir le site »), dans le même onglet ; un logo cliquable ne suffit pas (personne ne le devine, la bulle d'aide n'existe ni sur téléphone ni en jeu).

## 2. Stabilité de l'affichage : rien ne saute, rien ne clignote

- **Un contenu qui arrive ne pousse pas un contenu déjà affiché.** Réserver sa place avec un squelette de la taille finale (`.squelette`), ou afficher le bloc d'un seul coup quand toutes ses données sont là.
  Vu : des cartes de chiffres arrivant au-dessus d'un tableau et le faisant descendre de 140 px ; un bloc « À traiter » apparu au-dessus d'un panneau déjà lu.
- **Un libellé qui change ne fait pas bouger ses voisins** : largeur minimale à la taille du libellé le plus long.
  Vu : un bouton « Aujourd'hui » / « Cette semaine » / « Sem. du 28 sept. » qui décalait les flèches à chaque changement.
- **Un titre qui s'allonge revient à la ligne, il ne fait pas passer la barre d'outils dessous** (titre en `flex: 1 1 …; min-width: 0`, commandes calées en haut).
- **Pas de flash à l'arrivée sur une page** :
  - précharger les polices principales dans l'en-tête de chaque page (`<link rel="preload" as="font" crossorigin>`) — sinon le texte se redessine après le premier affichage ;
  - un fond animé (canvas, WebGL) arrive en fondu, il ne remplace pas le fond uni d'un coup ;
  - une transition de page ne passe jamais par une page vide.
- **Transition entre pages : un seul mouvement, sur le contenu seulement**, en réponse au clic (la rubrique cliquée s'allume aussitôt, le contenu s'estompe, la page suivante le fait reprendre) ; menu et en-tête immobiles ; rien pour `prefers-reduced-motion`.
  À ne pas faire : les transitions natives entre documents (`@view-transition`) — en test elles ont été sautées par le navigateur et ont figé l'affichage. Ni des entrées « fondu-glissement » section par section (effet de page générée).
- **Une coque en grille sur toute la hauteur (`min-height: 100vh`) fixe ses rangées à leur contenu** (`grid-template-rows: auto 1fr`) : sinon, sur une page courte, la hauteur en trop se répartit et la barre du haut grandit.
  Vu : une barre du haut de 176 px sur téléphone pour un logo et un bouton, sur les pages courtes seulement.
- **Pas de cadre décoratif fixé au bord de l'écran** sur une page qui défile : le contenu passe dessous en permanence.

## 3. Défilement et éléments flottants

- **Une page ne défile pas pour ne montrer que du vide.** La réserve du bas de page (pour la bulle de messagerie ou un bouton fixe) n'existe que là où un élément pourrait passer dessous ; sa taille est celle de l'élément flottant, pas plus.
  Vu : 104 px réservés sous « Mon profil », alors que le dernier bouton, à gauche, ne pouvait pas croiser la bulle à droite : la page défilait de 63 px pour rien.
- **Un élément flottant ne recouvre jamais une action.** Placer la dernière action (souvent destructrice) à gauche, du côté opposé à la bulle.
- **Bouton d'enregistrement flottant sans bandeau** : un bouton collant (`position: sticky`), sans rectangle de fond derrière lui, avec `pointer-events` limités au bouton.
  Vu : une barre d'enregistrement collante qui dessinait un rectangle sombre sur le contenu.
- **Fenêtre longue : le bandeau (titre et fermeture) et le pied (actions) restent fixes ; seul le contenu défile**, dans une fenêtre à hauteur limitée. Sur téléphone, elle peut prendre tout l’écran, sans déplacer ces repères.
  Vu : dans l’agenda, la croix et les boutons de validation disparaissaient en faisant défiler les champs ; même défaut dans les fenêtres longues d'autres rubriques.
- **Barres de défilement aux couleurs du site**, fines ; aucune zone qui défile à l'intérieur d'une autre.

## 4. Tableaux

- **Un tableau ne défile jamais de côté.** Trop large pour sa place, il devient une grille de cartes (`tablesAdaptatives`, `gestion.js`) — sinon les colonnes cachées sont souvent les actions.
- **La bascule se décide sur la place réellement mesurée, pas sur la largeur de l'écran.** La place dépend du menu, de la barre de défilement, du contenu affiché.
  Vu : un seuil fixe à 1 200 px ; à 1 280 px avec une barre de défilement visible et un menu élargi, le tableau débordait de 29 px et cachait « Supprimer ».
- **Ajouter une colonne ou une icône d'action, c'est revérifier la largeur à 1 280 px.** Préférer rendre cliquable un élément existant (le nom d'un bien qui mène à sa page) à une icône de plus.
- **Le tri se fait sur l'en-tête de colonne** (clic, flèche d'état), pas avec un sélecteur à part.
- **Un montant ne se coupe pas sur deux lignes.**

## 5. Contrôles : boutons, flèches, sélecteurs, champs

- **Une flèche ou un chevron est dessiné (SVG), jamais un caractère** (« ← », « → », « ↗ », « ‹ », « › », « ↑ », « ⌄ »). Un caractère se pose sur la ligne de base et paraît trop bas, surtout à côté de majuscules. Outil : `fleche('gauche' | 'droite' | 'sortie' | 'precedent' | 'suivant' | 'haut' | 'bas')` et `svg.fleche` (`gestion.js`, `gestion.css`). Exception : une flèche dans une phrase (« Paramètres → Liens »), qui se lit comme un mot.
  Vu : à une vingtaine d'endroits — boutons de retour, flèches de photos, tri, fil d'Ariane, menus déroulants.
- **Le chevron d'un sélecteur est dessiné et centré verticalement**, à distance du bord ; son ouverture ne dépasse jamais de l'écran (s'ouvrir vers le haut près du bas de la fenêtre).
- **Un bouton nomme l'action** (« Supprimer le grade »), il n'est rouge que si l'action détruit ; un groupe de boutons reste sur une ligne tant que la place le permet.
  Vu : « Refuser » qui passait sous « Valider » sans raison de place.
- **Chaque lien fait ce qu'il promet.** Deux liens vers la même page dans le même bloc font croire à deux actions différentes : le second doit faire autre chose (« Ajouter un rendez-vous » ouvre directement le formulaire, `agenda.html?nouveau=1`) ou disparaître.
- **Un champ qui ressemble à un champ désactivé ou surligné trompe** : un champ modifiable a l'apparence de tous les autres ; un champ en lecture seule n'a pas l'air d'un champ.
- **Obligatoire / facultatif** : marquer « facultatif » sur les champs facultatifs plutôt qu'une astérisque inexpliquée.
- **Bouton « Copier »** : confirme la copie par une notification, sans changer la taille ni le libellé du bouton.
- **Boutons radio et cases** alignés sur la première ligne de leur libellé.
- **Notification d'une action réussie** : en bas de l'écran, une seule à la fois (`gestion.notifier`) ; une confirmation affichée en haut de page passe inaperçue quand on a cliqué en bas.

## 6. Dates, heures, périodes

- **À la française, à l'heure de Paris** : champ texte jj/mm/aaaa et 24 h (un champ natif suit la langue du navigateur : « 02:00 PM ») ; une date invalide affiche une erreur claire et bloque l'enregistrement (`champDateFr`, `champHeureFr`, `gestion.js`). « Aujourd'hui » se calcule avec `timeZone: 'Europe/Paris'`.
  Vu : une date saisie au hasard, aucune erreur, et rien d'enregistré.
- **Un message d'erreur n'apparaît pas en quittant un champ** : il pousserait le bouton sur lequel on est en train de cliquer, et le clic tomberait à côté. En quittant le champ, seul son contour change (rien ne bouge) ; le message vient à l'envoi.
  Vu : « Ajouter » qui ne faisait rien après une date invalide corrigée — le message apparu au départ du champ avait déplacé le bouton.
- **Une période se nomme par sa date**, sauf la période actuelle (« Aujourd'hui », « Cette semaine », « Ce mois-ci ») : jamais « hier », « semaine prochaine », qu'il faut recalculer de tête. Le bouton qui ramène à la période actuelle le dit (nom accessible « … : revenir à cette semaine »).

## 7. Textes d'interface

- **Pour la personne qui utilise le site, pas pour celle qui l'a codé.** Aucun nom de variable, de fichier ou de configuration à l'écran (`DISCORD_BOT_TOKEN`, `.env`, « webhook ») ; dire ce qui se passe et qui contacter (« demandez-le à la personne qui s'occupe du site »).
  Vu : une aide de paramètre qui renvoyait au `.env` ; un onglet « Discord » incompréhensible sans explication de ce qu'il règle.
- **Ne pas inventer de terme.** Reprendre le vocabulaire de l'activité ; un champ au nom inventé (« ligne de départ ») est incompris.
- **Nommer par la fonction** : « Simulateur » plutôt que « Vérifier un salaire » ; « collé depuis un outil externe » plutôt qu'une liste d'outils.
- **Une erreur dit ce qui s'est passé et quoi faire ; un état vide dit ce qui manque et comment commencer** (avec le lien pour le faire).
- **Une même chose porte le même nom partout** (menu, titre, boutons, notifications).
- **Guillemets français avec espaces insécables** à l'intérieur ; un nom court entre guillemets (« Mon profil ») entièrement insécable.
- **Pas de lecture automatique répétée** (`aria-live`) sur une information relue périodiquement : elle serait lue à chaque relecture, sur chaque page.

## 8. Contenu intégré (carte, présentation, service tiers)

- **Un contenu principal se lit sur le site, jamais dans un nouvel onglet** : il s'affiche dans un cadre de la page, avec un « Plein écran » sur place (`pleinEcran`, masqué si le navigateur ne le permet pas, comme certains navigateurs en jeu).
  Vu : une carte qui s'ouvrait dans un autre onglet (contraire au cahier des charges d'un site), un bouton « Ouvrir sur Google Slides » qui envoyait les visiteurs hors du site.
- **Une seule source pour un contenu.** Ne pas recopier dans le code (texte, images) ce qui vit ailleurs et change : l'afficher depuis sa source. Un contenu « à moitié modifiable, à moitié en dur » est pire que l'un ou l'autre : les deux versions finissent par se contredire.
  Vu : un règlement en trois exemplaires (présentation, copies d'images, résumé écrit dans le code).
- **Pas de bouton « Afficher » pour révéler un contenu attendu** : l'afficher directement, chargé quand il arrive à l'écran (`loading="lazy"`).
- **Le cadre prend la proportion exacte du contenu** (ex. 16:9 + la barre du lecteur) : pas de bandes ; pas de boîte bordée autour, le contenu est présenté comme une pièce (angles adoucis, filet, ombre).
- **Toute ressource tierce se déclare** : `entreprise.csp` (https, et en dev un sous-domaine de `localhost`), et `confidentialite.html` dit ce qu'elle reçoit et quand.
- **Une adresse à ne pas divulguer passe par un relais** (`entreprise.hotes`) ; l'adresse du relais, ouverte directement dans un onglet, renvoie vers la page du site.

## 9. Réglages : rien en dur

- **Un lien, un identifiant Discord, une adresse de service se règle dans Paramètres**, jamais dans le code ni le `.env` (réservé à l'infrastructure et aux secrets).
  Vu : les liens de quatre présentations écrits dans un script.
- **Un réglage Discord se choisit par son nom** (`discord: 'role' | 'salon' | 'categorie'`), l'identifiant n'est qu'un repli.
- **Page Paramètres** : réglages rangés par onglet, enregistrés par onglet, état des lectures automatiques en tête de l'onglet concerné, « Modifications non enregistrées » visible et confirmation avant de changer d'onglet.

## 10. Compatibilité : navigateur en jeu et CSS

- **Le navigateur de l'ordinateur en jeu est ancien** : pas de `:has()`, pas de `color-mix()` ; une API récente (plein écran, transitions) se teste et se masque si elle manque.
- **Pas de transformation persistante sur un conteneur** : une animation garde `animation-fill-mode: backwards`, sinon l'élément garde une transformation et tout élément `position: fixed` à l'intérieur (fenêtre, bouton) se place par rapport à lui.
- **Un identifiant posé par la coque ne doit pas exister dans une page** : préfixer ceux de la coque.
  Vu : un panneau de la coque nommé comme un bloc de l'accueil — il s'ouvrait au mauvais endroit et ne se fermait plus.
- **Pas d'attribut `onclick`, de `confirm()`, `alert()`, `prompt()`, `print()` ni `beforeunload`** : la CSP bloque le premier, les autres gèlent le jeu entier dans l'ordinateur en jeu (le joueur doit fermer FiveM).
- **Ordinateur en jeu** (cahier des charges complet : `docs/folkos.md`) : un raccourci sur une lettre compare `e.key.toLowerCase()` (avec Maj, la touche arrive en majuscule) ; une page tolère un paramètre inconnu dans l'adresse (`?_cb=…` anti-cache) ; rien ne dépend de `window.top` ni de `document.referrer` ; près de chaque envoi de fichier, un texte `.seulement-en-jeu` dit quoi faire si le sélecteur ne s'ouvre pas ; une fenêtre `position: fixed` est enfant de `<body>` ou d'un parent sans `transform`, `filter`, `backdrop-filter`, `perspective` ni `contain`, sinon elle s'y retrouve enfermée.

---

## Vérifier avant de dire que c'est fini

- **Dans un navigateur, pas seulement en lisant le code** : `docker compose up`, connexion de dev, puis 375, 768, 1 024 et 1 280 px de large et 800 px de haut, menu ouvert compris, au clavier (Tab, Échap).
- **Avec les barres de défilement visibles.** Un navigateur automatisé les masque par défaut (Playwright : `ignoreDefaultArgs: ['--hide-scrollbars']`) ; sans elles, un débordement de 12 à 30 px passe inaperçu.
  Vu : un tableau annoncé « sans débordement » qui débordait chez l'utilisateur.
- **Avec de vraies données chargées.** Une page vide ou en erreur (limite de requêtes atteinte par des tests répétés) est plus courte et cache les défauts.
  Vu : « Mon profil » jugé sans défilement sur une page dont le profil ne s'était pas chargé.
- **Avec tous les droits et avec le moins de droits** (`/auth/discord?compte=<ID>` en dev), et avec le faux bot Discord (`DISCORD_BOT_TOKEN=simulation`) pour ce qui en dépend.
- **Mesurer ce qui bouge** quand le défaut est temporel (flash, saut) : relever les instants de peinture et de chargement des polices, ou capturer une image toutes les 50 ms, plutôt que de supposer.
- **Ne pas affirmer une correction non vérifiée.** Si un point n'a pas pu être vérifié, le dire.
