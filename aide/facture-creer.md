---
titre: Créer une facture
rubrique: facturation
mots-cles: facture, saisie, nouvelle facture, article, livraison, réduction, client
permission: factures
---
La page {chemin:Comptabilité›Facturation} réunit toutes les factures : celles reçues du bot (**Commande Discord** et **Facture en jeu**) et celles que vous saisissez vous-même (**Saisie manuelle**). Seules les factures saisies à la main se créent et se modifient ici.

## Saisir une facture

::: etapes
**Ouvrez la fenêtre** Cliquez sur [Nouvelle facture], en haut de la page.
**Renseignez le client** Saisissez le nom du client. Le numéro de facture est facultatif.
**Indiquez les dates** La date de la facture est obligatoire, au format jj/mm/aaaa. La date d'échéance est facultative.
**Ajoutez les articles** Cliquez sur [Ajouter un article], puis remplissez le nom, la quantité (Qté) et le prix unitaire. La liste « Depuis le catalogue… » remplit un article en un clic.
**Réglez la livraison et la réduction** La réduction s'applique au montant des articles, pas à la livraison.
**Vérifiez le total** Le récapitulatif affiche le total avant l'envoi. Cliquez sur [Ajouter] pour créer la facture.
:::

La facture est créée « en attente ». Vous la marquerez payée ou annulée depuis son détail.

## Retrouver une facture

Utilisez la ligne de filtres : **Toutes les provenances**, **Tous les statuts** (En attente, Payée, Annulée) et la recherche par client ou numéro. Les flèches et le bouton [Cette semaine] changent la semaine affichée ; la touche {T} revient à la semaine en cours. [Réinitialiser les filtres] efface vos filtres.

Cliquez sur une ligne pour ouvrir la facture. Le bouton [Aperçu] l'affiche à l'écran : il n'y a pas de fichier à télécharger, vous pouvez la copier en image avec [Copier en image] quand ce bouton est proposé.

::: attention Une facture reçue du bot ne se modifie pas
Une commande Discord ou une facture constatée en jeu s'affiche en lecture seule : le site ne corrige pas ce que Discord a enregistré. Un avoir non plus n'est pas modifiable.
:::

::: attention Supprimer une facture
[Supprimer] n'existe que pour une facture saisie à la main. Après confirmation (« Supprimer la facture »), elle est définitivement supprimée.
:::
