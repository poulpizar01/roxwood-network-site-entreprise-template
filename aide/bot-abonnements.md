---
titre: Connecter un événement du bot Discord
rubrique: webhooks
mots-cles: bot, abonnement, webhook, clé, configurer, remplacer la clé, historique
---
Le bot Discord de l'entreprise envoie des événements au site (prises de service, factures, candidatures…). Chaque type d'événement a son abonnement et sa propre clé secrète, qui prouve que l'événement vient bien du bot.

## Configurer un abonnement

L'onglet **Abonnements** liste les événements. L'état est **Non configuré**, **En attente**, **Actif** ou **En échec**.

::: etapes
**Cliquez sur** [Configurer] sur la ligne de l'événement.
**Créez l'abonnement dans le bot.** Dans le panneau Discord « Monitoring » du bot, ajoutez un webhook du type indiqué.
**Donnez-lui l'adresse du site.** Le bouton **Copier** (ou [Copier l'adresse] en haut de page) la place dans le presse-papiers.
**Collez la clé secrète** affichée par le bot : 64 caractères hexadécimaux.
**Cliquez sur** [Enregistrer]. Discord peut vous demander de confirmer votre identité.
:::

## Remplacer ou retirer une clé

Sur une ligne configurée, ouvrez le menu des actions :

- **Remplacer la clé** : pour l'ancienne clé, choisissez « Encore valable 24 h » (changement prévu) ou « Coupée tout de suite » (clé peut-être vue par quelqu'un d'autre).
- **Historique de la clé** : qui l'a enregistrée, remplacée ou retirée, et quand.
- **Retirer l'abonnement** : le site refuse ensuite ces événements.

::: attention Retirer aussi l'abonnement dans le bot
Après avoir retiré un abonnement, supprimez-le aussi dans le panneau Monitoring du bot. Sinon le bot réessaie pendant quelques heures.
:::

::: info
Ce panneau ne sert que si le site doit recevoir ces événements. Les prises de service, par exemple, n'arrivent qu'une fois leur abonnement actif.
:::
