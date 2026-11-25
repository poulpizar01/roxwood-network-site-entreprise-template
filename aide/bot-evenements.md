---
titre: Diagnostiquer un événement du bot en échec
rubrique: webhooks
mots-cles: événements reçus, journal, échec, diagnostic, bot, webhook
---
Quand une facture, une prise de service ou une candidature n'arrive pas, regardez les événements reçus. Ils montrent ce que le bot a envoyé et si le site l'a traité.

## Trouver l'événement

::: etapes
**Ouvrez l'onglet** **Événements reçus**.
**Filtrez par type.** Utilisez la liste Filtrer par type pour ne garder qu'un événement.
**Filtrez par état.** Choisissez « En échec (non traités) » ou « Traités ».
**Cliquez sur le type** d'une ligne pour ouvrir son détail.
:::

Depuis l'onglet **Abonnements**, le lien « échec à regarder » d'une ligne ouvre directement la liste des échecs de ce type. L'action **Voir les événements reçus** du menu fait de même pour tous ses événements.

## Lire le détail

Le tiroir affiche la date, l'état (**Traité** ou **En échec**) et le contenu reçu. Le contenu d'un événement traité avec succès est effacé : le message « Contenu effacé (événement traité avec succès). » le dit. Seuls les échecs gardent leur contenu, pour comprendre ce qui a bloqué.

## Que faire d'un échec

- Vérifiez que l'abonnement est **Actif** dans l'onglet Abonnements.
- Si la clé a changé dans le bot, utilisez **Remplacer la clé**.
- Si le contenu semble incomplet, signalez-le à la personne qui s'occupe du site.

::: info
Le tableau se trie par colonne : Type, Date et État.
:::
