---
titre: Créer un contrat
rubrique: contrats
mots-cles: contrat, client, fournisseur, type de contrat, salon discord, facturation automatique, rythme
permission: contrats
---
Un contrat enregistre un accord avec une autre entreprise. Les onglets **Clients** (il vous paie) et **Fournisseurs** (vous le payez) séparent les deux sens. Les filtres **En cours**, **Terminés** et **Tous** et la recherche par partenaire retrouvent un contrat.

## Créer un contrat

::: etapes
**Ouvrez la fenêtre** Dans {chemin:Comptabilité›Contrats}, cliquez sur [Nouveau contrat].
**Choisissez la partie** Sélectionnez **Un client** ou **Un fournisseur**.
**Nommez l'entreprise** Saisissez son nom dans « Entreprise ». Le type est facultatif.
**Fixez le rythme et le montant** Choisissez **Par jour**, **Par semaine** ou **Par mois**, puis saisissez le montant pour cette période.
**Indiquez les dates** Renseignez le début. La date de fin est facultative : sans elle, le contrat est reconduit jusqu'à ce que vous y mettiez fin.
**Enregistrez** Cliquez sur [Ajouter].
:::

## Les types de contrat

[Types de contrat] ouvre la liste des types, qui servent à classer les contrats et à les repérer par couleur. Les types d'un client et d'un fournisseur sont séparés : la fenêtre s'ouvre pour l'onglet affiché. Supprimer un type laisse les contrats qui l'utilisent, sans type.

## Salon Discord et facturation automatique

Le champ « Salon Discord » (facultatif) reçoit l'identifiant du salon : clic droit sur le salon dans Discord, puis « Copier l'identifiant ». Laissé vide, l'envoi d'une facture demande le salon à chaque fois.

Pour un contrat client, l'option **Facturation automatique** facture chaque échéance due toute seule, puis envoie la facture dans le salon. Elle exige un salon et ne vaut que pour un contrat en cours.

::: attention Activer la facturation automatique
Si le contrat a déjà des échéances dues, elles sont toutes facturées et envoyées sur Discord dans l'heure qui suit. Une fenêtre vous en indique le nombre et le montant avant de continuer.
:::

::: info
Dès qu'une facture est liée au contrat, le rythme et la date de début ne changent plus.
:::
