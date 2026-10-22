# Notes propres à ce site

Fichier **personnalisable**, importé par `CLAUDE.md` : ce qu'un agent (ou un développeur) doit savoir de cette entreprise en particulier. Dans le dépôt modèle, il ne décrit que l'exemple fourni ; dans un site, le réécrire.

Seulement ce qui est propre au site : ses modules, tables, routes, conventions et pièges. Une règle qui vaudrait pour tout site (sécurité, en jeu, déploiement…) va dans le modèle (`CLAUDE.md`, `docs/`), pour que tous les sites en profitent ; ici, un renvoi suffit.

## L'entreprise

- Activité : *à compléter* (secteur, ce que le site vend ou gère).
- Serveur Discord : *à compléter* (rôles liés aux grades, bot entreprise utilisé ou non, webhooks abonnés).

## Ce que le site ajoute au socle

| Domaine | Permission | Pages (`gestion/`) | Routes (`server/src/entreprise/`) | Tables (`entreprise.prisma`) |
|---|---|---|---|---|
| Ressources humaines | `rh-voir`, `rh-creer`, `rh-modifier`, `rh-desactiver`, `rh-reactiver`, `rh-sensible` (téléphone, RIB), `rh-parametrer` (candidatures) | `rh.html`, `rh.js` : effectif, fiches, candidatures reçues du bot | `routes/rh.ts`, logique `rh.ts` (candidatures `recruitment.updated`) | `employes`, `rh_arrivees_bot` |
| Quota (page « Équipe » à part, run + factures) | lecture : `rh-voir` ; quota par grade : `grades` (fiche du grade, page Grades, comme les droits d'agenda) ; objectif de toute l'équipe : `parametres` (onglet Quota, un groupe Run et un groupe Factures) | `quota.html`, `quota.js` : deux chiffres de la semaine (unités run, montant facturé), sélecteur de semaine partagé (même recette que l'agenda : flèches, bouton « Cette semaine », raccourci clavier T — navigation vers le passé seulement, une semaine future demandée est ramenée à la semaine en cours), onglets **Quota run** et **Quota facture** (tableaux denses, recherche par nom/prénom — pensés pour une centaine d'employés) et **Classements** (top 5 run et top 5 factures côte à côte) ; quota par grade dans `grades.html` (sections « Run » et « Factures » de la fiche) | `routes/run.ts` (`/api/run?semaine=AAAA-MM-JJ`, `/api/run/quotas`), logique `run.ts` (`classementRuns`, `quotasRun`, `definirQuotaRun`, réception de `monitoring.sale`) ; `routes/compta.ts` (`/api/compta/factures/classement?semaine=AAAA-MM-JJ`, `/api/compta/factures/quotas`), logique `facture.ts` (`classementFactures`, `quotasFacture`, `definirQuotaFacture`) | `runs`, `runs_quota_grades`, `factures_quota_grades` |
| Factures (webhooks du bot) | `factures` ; quota et classement : voir ligne Quota ci-dessus | `factures.html`, `factures.js` : consultation toutes provenances avec le détail de la source, saisie manuelle, téléchargement en vue imprimable | `facture.ts` (événements `order.updated` et `monitoring.invoice`, câblés) — seul un paiement constaté en jeu (`monitoring.invoice`) crédite un employé (`employeId`, résolu comme dans `runs` par `playerDiscord`/`playerName`) : une commande boutique n'identifie que le client, une facture saisie depuis le site (`compteId`, l'auteur de la saisie) n'est pas nécessairement celui qui a encaissé en jeu | `factures` |
| DOT | `compta` | `comptabilite.html`, `comptabilite.js` : relevé Tablettes collé, paie à l'heure par grade, résumé de la déclaration DOT (CA brut, impôts, bénéfice net, dépenses et retraits), barème d'imposition en lecture sous les écritures | `routes/compta.ts` ; calculs purs `stats/releve.ts`, `stats/paie-horaire.ts` (tests `releve`, `paie-horaire`) | `compta_imports`, `compta_dot_ecritures`, `dot_bareme_imposition` (barème du serveur, rempli par la migration), `remunerations_grades` |
| Paie | `paie` | `paie.html`, `paie.js` : onglet **Grades** (salaire de base et primes par palier de run/facture, fiche modale par grade, comme la page Grades) et onglet **Simulateur** (chiffres saisis à la main, ou vraies données d'un employé sur une semaine) | `routes/paie.ts` ; logique pure et données `paie.ts` (`calculerPaie`, `primeDePalier` — seul le palier le plus haut atteint compte, jamais cumulé ; prime run et prime facture s'additionnent) (tests `paie`) | `remunerations_grades` (salaire de base, partagée avec la paie à l'heure), `primes_palier_grades` |
| Agenda | `agenda-types` ; droits par grade dans `grades.html` | `agenda.html`, `agenda.js`, `agenda.css`, aperçu dans `accueil.html` | `routes/agenda.ts`, règles `agenda-regles.ts` (tests `agenda`) | `evenements_agenda`, `agenda_invitations`, `agenda_types`, `agenda_droits_grades` |
| Membres en service | — (lecture : tout compte validé ; état et clôture : `parametres`) | indicateur « En service » du menu (`gestion.js`), panneau de l'accueil, état dans Paramètres → Discord | `services.ts` (événement `monitoring.duty`, clôture automatique), `services-duty.ts` (tests `services`), `routes/services.ts` ; faux bot de dev : `discord-simulation.ts` | `services`, `services_etat` |
| Paramètres → Apparence | `parametres` | onglet Apparence de `parametres.html` | `routes/apparence.ts` (relais des images réglées sur `/assets/logo.png`, `favicon.png`, `og-image.jpg`), file de nettoyage `images-retirees.ts` | `apparence_images`, `images_retirees` |
| Accueil | — | `accueil.html` : « À traiter » selon les droits, prime de la semaine, journée | `routes/accueil.ts` | — |

Les pages de gestion reprennent la mise en page et les composants d'un site du réseau (`gestion.js`, `gestion.css`) ; couleurs et polices viennent de `theme.css`, reliées par le pont en tête de `gestion.css`. Tâches planifiées (`demarrage`) : purge quotidienne (`purge.ts`), clôture des services oubliés chaque minute (`services.ts`), nettoyage du stockage toutes les 15 minutes (`images-retirees.ts`).

Événements du bot traités (`entreprise.webhooks`) : `recruitment.updated` (candidatures acceptées → fiches RH), `monitoring.duty` (prises et fins de service), `monitoring.sale` (vente d'objet en jeu → table `runs`), `order.updated` et `monitoring.invoice` (commande boutique et paiement constaté en jeu → table `factures`, entreprise/facture.ts).

## Pièges propres à ce site

- *à compléter au fil de l'eau.*
