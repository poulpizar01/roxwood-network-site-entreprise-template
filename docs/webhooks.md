# Webhooks du bot Discord entreprise

Le bot [roxwood-network-entreprise](https://github.com/poulpizar01/roxwood-network-entreprise) (sur-couche Discord de Ticket Tool : commandes, recrutement, absences, monitoring FiveM) **pousse** des événements vers les sites qui s'y abonnent. Le site ne l'appelle jamais : il reçoit, vérifie, enregistre et confie l'événement au code de l'entreprise.

## Mise en place
1. Déclarer le type dans `server/src/entreprise/index.ts` (`entreprise.webhooks`), avec `libelle`, `description` et `traiter` (voir plus bas) : ce qui le fait apparaître dans l'onglet **Abonnements** de `gestion/webhooks.html`.
2. Sur Discord, panneau **« Monitoring »** du bot → **Ajouter un webhook** : choisir ce type d'événement, URL `https://<domaine>/webhooks/bot` (affichée, avec bouton copier, en tête de l'onglet Abonnements).
3. Le bot affiche le **secret** de l'abonnement **une seule fois** : le coller dans la gestion, onglet Abonnements → ligne du type → **Configurer** (ou **Remplacer la clé** pour un abonnement déjà relié). Discord demande de confirmer l'identité (connexion de moins de 5 min) avant d'enregistrer.

Chaque type a sa **propre clé**, chiffrée en base (AES-256-GCM, `server/src/socle/webhooks-cle.ts`) avec une clé maîtresse qui vient d'un secret Docker (`secrets/cle-maitresse`, à créer une fois — voir `server/README.md`, jamais dans le dépôt ni dans les sauvegardes) : la clé d'un type n'est jamais acceptée pour l'événement d'un autre type. Remplacer une clé déjà en place propose de garder l'ancienne valable 24 h (reprise en cours côté bot) ou de la couper tout de suite. Historique (qui, quand, quelle empreinte — jamais la clé elle-même) dans l'onglet Abonnements → menu de la ligne → **Historique de la clé**.

La permission qui donne accès à cette page (`webhooks`) est déclarée par le **socle** (comme `comptes` ou `grades`), pas par le site : elle existe pour tous les sites entreprise.

## Ce que fait le socle (`server/src/socle/routes/webhooks.ts`)
1. **Forme** : JSON `{ guildId, eventType, payload, sentAt }` ; sinon `400`.
2. **Fraîcheur** : `sentAt` doit dater de 4 h au plus (tolérance de 5 min dans le futur, pour un léger décalage d'horloge) ; sinon `400`. Un envoi trop ancien n'est jamais traité.
3. **Serveur Discord** : `guildId` doit être `DISCORD_GUILD_ID` (`403` sinon).
4. **Signature** : en-tête `X-Signature-256` = HMAC-SHA256 du **corps brut** (hexadécimal), comparé en temps constant à la clé de l'abonnement du type reçu (et à l'ancienne clé si son délai de grâce de 24 h n'est pas passé). Absent, faux, ou type sans abonnement configuré : `401`.
5. **Une seule fois** : l'empreinte SHA-256 du corps est enregistrée (table `webhooks_recus`, 30 jours ; seul l'horodatage du bot est conservé pour un diagnostic d'échec). Une nouvelle livraison du même corps — le bot réessaie après un échec réseau, un `5xx` ou un `429` — répond `200` sans retraiter si le premier envoi est déjà traité. Si ce premier envoi est encore en cours de traitement (deux livraisons au même instant), elle répond `503` avec `Retry-After: 5` : un `200` ferait croire au bot que l'événement est traité alors que son traitement peut encore échouer ; le bot réessaie, et la nouvelle tentative reçoit `200` une fois le traitement terminé.
6. **Traitement** : `entreprise.webhooks[eventType].traiter(événement)`. Réussi : `200`, l'événement est marqué traité. Erreur levée : `500`, l'événement reste non traité et le bot réessaie (1, 2, 4… jusqu'à 30 min, 10 essais). Type sans abonnement configuré : rejeté à l'étape signature, avant d'atteindre `traiter`.

Le site ne renvoie jamais de donnée sur cette route : elle sert à recevoir, pas à lire.

## Événements envoyés par le bot
| Type | Quand | `payload` (principaux champs) |
|---|---|---|
| `absence.updated` | déclaration, puis acceptation / refus d'une absence | `requestId`, `requesterId` (ID Discord), `startDate`, `endDate` (ISO), `reason`, `status` (`PENDING`, `ACCEPTED`, `REFUSED`), `resolverId`, `resolvedAt` |
| `order.updated` | validation d'une commande par le client, puis chaque (re)génération de facture | table `factures` (entreprise/facture.ts) : `orderId`, `ticketId`, `channelId`, `customerId` (ID Discord, aucun nom affiché), `confirmed`, `status` (`PENDING`/`PREPARING`/`DELIVERED`/`CANCELLED`), `paymentStatus` (`UNPAID`/`PAID`), `invoiceNumber`, `items: [{ name, unitPrice, quantity, weightGrams, answers: [{question, answer}] }]`, `subtotal`, `deliveryFee`, `discountPercent`, `discountAmount`, `total` |
| `recruitment.updated` | formulaire de candidature soumis, puis chaque changement de statut, assignation ou pièce jointe | candidat, statut, recruteur, réponses, noms des pièces jointes |
| `monitoring.duty` · `monitoring.recruitment` · `monitoring.storage` · `monitoring.invoice` · `monitoring.sale` | logs FiveM lus par le bot (service, embauche/licenciement, coffre, facture, vente) | **`payload` = tous les champs de l'embed Discord du log, sans tri** (un champ ajouté au log par le bot arrive donc automatiquement, même non documenté ici) **+ `description`** (texte brut du log) **+ `parsed`** (résultat de l'analyse de `description` par le bot, variable selon le type) **+ `logTimestamp`** (ISO, horodatage réel du log — à préférer à `sentAt`, qui est l'heure du premier envoi du webhook : une nouvelle tentative après une panne (jusqu'à 2 h 30 plus tard) renvoie le même corps, donc la même valeur). Pas d'identifiant du bot propre à l'événement : dédoublonnage laissé au site (ex. `discordId` + `logTimestamp`/`sentAt` + objet + quantité pour le coffre, armurerie-coffre.ts). Pour le coffre (`monitoring.storage`) : `parsed.{direction, quantity, itemLabel, stockAfter}` — `itemLabel` est le nom lisible de l'objet, **n° de série inclus entre parenthèses pour une arme** (`"Pistolet de combat (BBDUHV734U)"`, à découper par regex côté site) ; `itemId` (hors `parsed`) donne la clé technique du modèle, jamais l'exemplaire ; `targetPosition` (hors `parsed`) distingue plusieurs coffres entre eux. `monitoring.sale` (table `runs`, entreprise/run.ts) : `jobId`, `playerDiscord`, `playerName`, `description`, `parsed.{quantity, itemLabel, totalPrice, companyShare, sellerName}`. `monitoring.invoice` (table `factures`, entreprise/facture.ts) : mêmes champs de log que `monitoring.sale` (`jobId`, `playerDiscord`, `playerName`, `description`) + `parsed.{amount, taxPercent, payerName}` (`payerName` tiré du texte libre du log, pas d'identifiant Discord fiable). |
| `custom` | ligne ajoutée à un Google Sheet synchronisé par le bot | libre (en-têtes de la feuille) |

La forme exacte de chaque `payload` est celle du code du bot (`src/services/*Service.ts`, appels à `dispatchWebhook`) : la vérifier avant d'écrire un traitement, et après chaque mise à jour du bot — y compris pour `order.updated` et `monitoring.invoice` ci-dessus, dont la forme documentée peut changer avec le bot.

## Écrire un traitement
```ts
// server/src/entreprise/index.ts
webhooks: {
  'order.updated': {
    libelle: 'Commandes',
    description: 'Commande validée côté client, puis chaque (re)génération de facture',
    traiter: async e => {
      const p = e.payload as { orderId?: string; total?: number; status?: string };
      if (typeof p.orderId !== 'string') return;             // forme inattendue : ignorer, ne pas planter
      await prisma.commande.upsert({ where: { idBot: p.orderId }, create: { … }, update: { … } });
    },
  },
},
```
- **Idempotent** : un même objet métier revient plusieurs fois (chaque changement de statut renvoie l'état complet) → `upsert` sur l'identifiant du bot, jamais un `create` aveugle.
- **Méfiant** : le contenu vient de saisies d'utilisateurs Discord. Vérifier la forme de chaque champ utilisé, borner les textes, échapper à l'affichage.
- **Rapide** : le bot attend la réponse 10 s au plus. Un traitement long (appel à un autre service) se fait après coup, pas dans la requête.
- **Erreur = nouvelle tentative** : ne lever une erreur que pour un échec transitoire (base indisponible). Une donnée invalide s'ignore (retour simple) : la relancer ne la rendrait pas valide.

## Tester en local
Le bot ne peut pas joindre `http://localhost`. Simuler un envoi signé :
```bash
# dans la gestion (http://localhost:3000/gestion/webhooks.html), relier l'abonnement « absence.updated » avec la clé
# de test ci-dessous (64 caractères hexadécimaux : ici 32 fois « ab »)
cle=$(printf 'ab%.0s' {1..32})
corps=$(printf '{"guildId":"","eventType":"absence.updated","payload":{"requesterId":"dev-local","startDate":"2026-10-04T00:00:00Z","endDate":"2026-10-06T00:00:00Z","status":"ACCEPTED"},"sentAt":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
sig=$(printf '%s' "$corps" | openssl dgst -sha256 -hmac "$cle" -hex | sed 's/^.* //')
curl -i -X POST http://localhost:3000/webhooks/bot -H 'Content-Type: application/json' -H "X-Signature-256: $sig" --data-raw "$corps"
```
`sentAt` doit être récent (moins de 4 h) : généré au moment de l'appel ci-dessus, pas une date fixe recopiée. En dev sans `DISCORD_GUILD_ID`, le contrôle du serveur Discord est ignoré (`guildId` vide accepté).
