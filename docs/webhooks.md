# Webhooks du bot Discord entreprise

Le bot [roxwood-network-entreprise](https://github.com/poulpizar01/roxwood-network-entreprise) (sur-couche Discord de Ticket Tool : commandes, recrutement, absences, monitoring FiveM) **pousse** des événements vers les sites qui s'y abonnent. Le site ne l'appelle jamais : il reçoit, vérifie, enregistre et confie l'événement au code de l'entreprise.

## Mise en place
1. Sur Discord, panneau **« Monitoring »** du bot → **Ajouter un webhook** : choisir le type d'événement, URL `https://<domaine>/webhooks/bot`.
2. Le bot affiche le **secret** de l'abonnement **une seule fois** : le copier dans `BOT_WEBHOOK_SECRETS` du `.env` (plusieurs abonnements : secrets séparés par des virgules), puis `docker compose up -d`.
3. Dans `server/src/entreprise/index.ts`, déclarer le traitement de chaque type reçu dans `webhooks`.

Les journaux du site disent au démarrage combien d'abonnements sont configurés. `BOT_WEBHOOK_SECRETS` vide : la route répond `503`.

## Ce que fait le socle (`server/src/socle/routes/webhooks.ts`)
1. **Signature** : en-tête `X-Signature-256` = HMAC-SHA256 du **corps brut** (hexadécimal), comparé en temps constant à chacun des secrets. Absent ou faux : `401`.
2. **Forme** : JSON `{ guildId, eventType, payload, sentAt }` ; sinon `400`.
3. **Serveur Discord** : `guildId` doit être `DISCORD_GUILD_ID` (`403` sinon).
4. **Une seule fois** : l'empreinte SHA-256 du corps est enregistrée (table `webhooks_recus`, 30 jours ; le corps de l'événement n'y reste que tant que son traitement échoue). Une nouvelle livraison du même corps — le bot réessaie après un échec réseau, un `5xx` ou un `429` — répond `200` sans retraiter.
5. **Traitement** : `entreprise.webhooks[eventType](événement)`. Réussi : `200`, l'événement est marqué traité. Erreur levée : `500`, l'événement reste non traité et le bot réessaie (1, 2, 4… jusqu'à 30 min, 10 essais). Type sans traitement : `200`, rien d'autre.

Le site ne renvoie jamais de donnée sur cette route : elle sert à recevoir, pas à lire.

## Événements envoyés par le bot
| Type | Quand | `payload` (principaux champs) |
|---|---|---|
| `absence.updated` | déclaration, puis acceptation / refus d'une absence | `requestId`, `requesterId` (ID Discord), `startDate`, `endDate` (ISO), `reason`, `status` (`PENDING`, `ACCEPTED`, `REFUSED`), `resolverId`, `resolvedAt` |
| `order.updated` | validation d'une commande par le client, puis chaque (re)génération de facture | table `factures` (entreprise/facture.ts) : `orderId`, `ticketId`, `channelId`, `customerId` (ID Discord, aucun nom affiché), `confirmed`, `status` (`PENDING`/`PREPARING`/`DELIVERED`/`CANCELLED`), `paymentStatus` (`UNPAID`/`PAID`), `invoiceNumber`, `items: [{ name, unitPrice, quantity, weightGrams, answers: [{question, answer}] }]`, `subtotal`, `deliveryFee`, `discountPercent`, `discountAmount`, `total` |
| `recruitment.updated` | formulaire de candidature soumis, puis chaque changement de statut, assignation ou pièce jointe | candidat, statut, recruteur, réponses, noms des pièces jointes |
| `monitoring.duty` · `monitoring.recruitment` · `monitoring.storage` · `monitoring.invoice` · `monitoring.sale` | logs FiveM lus par le bot (service, embauche/licenciement, coffre, facture, vente) | log analysé (`parsed`) ; pour le coffre : `direction`, `quantity`, `stockAfter`. `monitoring.sale` (table `runs`, entreprise/run.ts) : `jobId`, `playerDiscord`, `playerName`, `description`, `parsed.{quantity, itemLabel, totalPrice, companyShare, sellerName}`. `monitoring.invoice` (table `factures`, entreprise/facture.ts) : mêmes champs de log que `monitoring.sale` (`jobId`, `playerDiscord`, `playerName`, `description`) + `parsed.{amount, taxPercent, payerName}` (`payerName` tiré du texte libre du log, pas d'identifiant Discord fiable) ; pas d'identifiant du bot propre à l'événement, dédoublonnage laissé au socle. |
| `custom` | ligne ajoutée à un Google Sheet synchronisé par le bot | libre (en-têtes de la feuille) |

La forme exacte de chaque `payload` est celle du code du bot (`src/services/*Service.ts`, appels à `dispatchWebhook`) : la vérifier avant d'écrire un traitement, et après chaque mise à jour du bot — y compris pour `order.updated` et `monitoring.invoice` ci-dessus, dont la forme documentée peut changer avec le bot.

## Écrire un traitement
```ts
// server/src/entreprise/index.ts
webhooks: {
  'order.updated': async e => {
    const p = e.payload as { orderId?: string; total?: number; status?: string };
    if (typeof p.orderId !== 'string') return;               // forme inattendue : ignorer, ne pas planter
    await prisma.commande.upsert({ where: { idBot: p.orderId }, create: { … }, update: { … } });
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
# dans .env de dev : BOT_WEBHOOK_SECRETS=secret-de-test-local, puis docker compose up -d
corps='{"guildId":"","eventType":"absence.updated","payload":{"requesterId":"dev-local","startDate":"2026-10-04T00:00:00Z","endDate":"2026-10-06T00:00:00Z","status":"ACCEPTED"},"sentAt":"2026-10-04T12:00:00Z"}'
sig=$(printf '%s' "$corps" | openssl dgst -sha256 -hmac 'secret-de-test-local' -hex | sed 's/^.* //')
curl -i -X POST http://localhost:3000/webhooks/bot -H 'Content-Type: application/json' -H "X-Signature-256: $sig" --data-raw "$corps"
```
En dev sans `DISCORD_GUILD_ID`, le contrôle du serveur Discord est ignoré (`guildId` vide accepté).
