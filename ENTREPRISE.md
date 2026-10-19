# Notes propres à ce site

Fichier **personnalisable**, importé par `CLAUDE.md` : ce qu'un agent (ou un développeur) doit savoir de cette entreprise en particulier. Dans le dépôt modèle, il ne décrit que l'exemple fourni ; dans un site, le réécrire.

Seulement ce qui est propre au site : ses modules, tables, routes, conventions et pièges. Une règle qui vaudrait pour tout site (sécurité, en jeu, déploiement…) va dans le modèle (`CLAUDE.md`, `docs/`), pour que tous les sites en profitent ; ici, un renvoi suffit.

## L'entreprise

- Activité : *à compléter* (secteur, ce que le site vend ou gère).
- Serveur Discord : *à compléter* (rôles liés aux grades, bot entreprise utilisé ou non, webhooks abonnés).

## Ce que le site ajoute au socle

| Domaine | Permission | Pages (`gestion/`) | Routes (`server/src/entreprise/`) | Tables (`entreprise.prisma`) |
|---|---|---|---|---|
| Ressources humaines | `rh-voir`, `rh-creer`, `rh-modifier`, `rh-desactiver`, `rh-reactiver`, `rh-sensible` (téléphone, RIB), `rh-parametrer` | `rh.html`, `rh.js` : effectif, fiches, candidatures reçues du bot, données « à rattacher » | `routes/rh.ts`, logique `rh.ts` (candidatures `recruitment.updated`) | `employes`, `rh_arrivees_bot` |
| Ventes et Google Sheets de la direction | `ventes`, `ventes-gerer` | pas de page : alimentent RH, l'accueil (prime de la semaine) et la DOT | `routes/stats.ts` (`POST /api/stats/ventes`, clé `STATS_BOT_SECRET`), `stats/` (`calcul.ts`, `tableur.ts`, `ventes.ts`, `recap.ts` ; tests `stats-calc`, `tableur`) | `ventes`, `ventes_doublons`, `baremes_primes`, `tableur_lignes`, `tableur_etat`, `tableur_archives`, `tableur_archives_lignes` |
| Comptabilité | `compta` | `comptabilite.html`, `comptabilite.js` : relevé Tablettes collé, rémunération par grade (salaire fixe, primes selon les paliers, paie à l'heure), déclaration DOT | `routes/compta.ts`, rémunération et paliers dans `routes/stats.ts` ; calculs purs `stats/releve.ts`, `stats/paie-horaire.ts` (tests `releve`, `paie-horaire`) | `compta_imports`, `compta_dot_ecritures`, `dot_bareme_imposition` (barème du serveur, rempli par la migration), `remunerations_grades` |
| Agenda | `agenda-types` ; droits par grade dans `grades.html` | `agenda.html`, `agenda.js`, `agenda.css`, aperçu dans `accueil.html` | `routes/agenda.ts`, règles `agenda-regles.ts` (tests `agenda`) | `evenements_agenda`, `agenda_invitations`, `agenda_types`, `agenda_droits_grades` |
| Membres en service | — (lecture : tout compte validé ; état et clôture : `parametres`) | indicateur « En service » du menu (`gestion.js`), panneau de l'accueil, état dans Paramètres → Discord | `services.ts` (événement `monitoring.duty`, clôture automatique), `services-duty.ts` (tests `services`), `routes/services.ts` ; faux bot de dev : `discord-simulation.ts` | `services`, `services_etat` |
| Paramètres → Apparence | `parametres` | onglet Apparence de `parametres.html` | `routes/apparence.ts` (relais des images réglées sur `/assets/logo.png`, `favicon.png`, `og-image.jpg`), file de nettoyage `images-retirees.ts` | `apparence_images`, `images_retirees` |
| Accueil | — | `accueil.html` : « À traiter » selon les droits, prime de la semaine, journée, annonces | `routes/accueil.ts` | — |
| Annonces internes (exemple du modèle) | `annonces` (publier) ; lecture : tout compte validé | `annonces.html`, aperçu dans `accueil.html` | `routes/annonces.ts` | `annonces` |

Les pages de gestion reprennent la mise en page et les composants d'un site du réseau (`gestion.js`, `gestion.css`) ; couleurs et polices viennent de `theme.css`, reliées par le pont en tête de `gestion.css`. Tâches planifiées (`demarrage`) : lecture du Google Sheets toutes les 5 minutes (`stats/tableur.ts`), purge quotidienne (`purge.ts`), clôture des services oubliés chaque minute (`services.ts`), nettoyage du stockage toutes les 15 minutes (`images-retirees.ts`). Lien « Registre » du menu : réglé dans Paramètres → Liens, servi par `/api/outils`.

Événements du bot traités (`entreprise.webhooks`) : `recruitment.updated` (candidatures acceptées → fiches RH), `monitoring.duty` (prises et fins de service), `absence.updated` (exemple : une absence acceptée devient une annonce).

## Pièges propres à ce site

- *à compléter au fil de l'eau.*
