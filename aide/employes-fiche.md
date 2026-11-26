---
titre: Ajouter un employé ou modifier sa fiche
rubrique: rh
mots-cles: employé, fiche, ajouter un membre, grade, ID Unique, téléphone, RIB, pièce d'identité, historique
---
Chaque employé a une fiche. Elle fixe son identité, son grade et ses dates. Le grade de la fiche donne aussi ses droits sur le site.

## Ajouter un employé

::: etapes
**Cliquez sur** [Ajouter un membre] en haut de la page Employés. Ce bouton n'apparaît qu'avec le droit d'ajouter un employé.
**Remplissez la fiche.** Prénom, Nom, ID Unique (des chiffres uniquement), Grade et Date d'arrivée sont demandés.
**Ajoutez le Discord.** L'ID Discord relie la fiche au compte du site, et le Pseudo Discord est celui que le bot envoie avec les ventes.
**Cliquez sur** [Ajouter] pour créer la fiche.
:::

## Modifier une fiche

Cliquez sur une ligne de la liste pour ouvrir la fiche. L'onglet **Profil** se modifie, puis se valide avec [Enregistrer]. Pour retrouver quelqu'un, utilisez les boutons **Actifs**, **Anciens** et **Tous**, le filtre par grade ou la recherche.

::: si rh-modifier
Les grades au-dessus du vôtre sont grisés dans la liste. La fiche d'un grade égal ou supérieur au vôtre, comme la vôtre, s'ouvre en lecture seule.
:::

::: si comptes
Changer le grade d'un employé dont le compte est déjà validé demande aussi le droit de gérer les comptes.
:::

## Données sensibles

- **Notes internes** : lues seulement avec le droit de les consulter, et sur les fiches d'un grade sous le vôtre ; jamais par l'employé concerné. Les écrire demande aussi de pouvoir modifier la fiche.
- **Téléphone et RIB** : affichés seulement à qui peut les consulter, modifiables seulement par qui peut les modifier.
- **Pièce d'identité** : visible seulement à qui peut la consulter. Avec le droit de la gérer, utilisez [Ajouter une pièce], [Remplacer la pièce] ou [Retirer]. Elle est effacée 90 jours après le départ de l'employé.

## Voir son activité

L'onglet **Activité** montre le compte du site relié à la fiche, le service en cours s'il y en a un, et l'**Historique de la fiche**. Cet historique s'écrit tout seul à chaque changement : on ne le saisit pas.

::: info
Une fiche marquée « À compléter » a un ID Unique provisoire ou un nom manquant. Remplacez-le par le vrai.
:::
