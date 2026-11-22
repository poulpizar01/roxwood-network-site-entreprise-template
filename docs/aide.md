# Aide en ligne : écrire un article

Référence du format lu par `server/src/socle/aide.ts`. Un article est un fichier `.md`, dans `aide-socle/` (socle,
mis à jour avec le modèle) ou `aide/` (entreprise, personnalisable ; un fichier du même nom y remplace celui du socle).
Le nom du fichier (sans `.md`) est son identifiant (`slug`), utilisé dans l'adresse et dans les liens.

## En-tête

```
---
titre: Facturer une échéance
rubrique: echeanciers
mots-cles: échéancier, contrat, facturer, payer
permission: factures
---
```

- `titre` et `rubrique` sont obligatoires. Un article sans l'un des deux est ignoré (avertissement au démarrage).
- `rubrique` est le nom d'une page de `gestion/` (sans `.html`) : l'article **hérite** du niveau d'accès de cette
  page (`entreprise.pages`) — pas besoin de le redéclarer. Une rubrique qui ne correspond à aucune page connue
  retombe sur « compte validé », avec un avertissement au démarrage.
- `permission` (facultatif) **surcharge** le niveau hérité : utile pour un article qui parle d'un geste plus
  restreint que la page elle-même (ex. une page ouverte à tout compte validé, mais un article qui ne concerne
  que ceux qui ont une permission d'écriture).
- `mots-cles` (facultatif) : séparés par des virgules, pesés dans la recherche.

## Corps : Markdown réduit

Texte ordinaire, avec :
- `## Titre` : intertitre (section repliable côté client, ancre pour « Dans cet article »).
- `- élément` : liste à puces.
- `**gras**`, `` `code` ``, `[texte](/lien)` (lien interne seulement : `/...` ou `#...`).
- `[Bouton]` : rendu comme un bouton de la gestion (reprend le libellé **exact** de l'écran réel — voir
  *Fidélité* ci-dessous) ; `[-Bouton]` pour un bouton secondaire.
- `{Touche}` : une touche de clavier (`{Ctrl}`, `{T}`…).
- `{chemin:Rubrique›Sous-rubrique}` : un chemin de navigation, séparé par `›`.

### Blocs (`::: type arguments` … `:::`)

| Type | Contenu | Rendu |
|---|---|---|
| `si <permission>` | texte ou autres blocs | retiré côté serveur pour qui n'a pas la permission (jamais envoyé, pas seulement masqué) ; un bandeau « Visible parce que vous avez « … » » l'entoure pour qui le voit |
| `etapes` | lignes `**Titre** description` | liste numérotée reliée aux repères d'un schéma |
| `cycle` | une ligne `État A > État B > État C` | les états d'un statut, dans l'ordre |
| `attention <titre>` | texte | encadré d'avertissement (ce qui ne se rattrape pas) |
| `info` | texte | encadré d'information neutre |
| `schema <nom>` | lignes `N [cle] Libellé : description` | réserve la figure et pose la légende numérotée ; le dessin lui-même vient du registre de schémas de la coque (`gestion.js`), jamais inventé par un article |

Un « si » ne s'imbrique pas dans un autre « si » (perdrait sa propre permission) : si le besoin se présente,
corriger `rendreCorps` plutôt que de le contourner.

### Légende d'un schéma : `[cle]` facultative, `Libellé` toujours une phrase lisible

```
::: schema compte
1 [terminer-service] Terminer votre service : bouton [Terminer mon service]
2 Votre identité : nom, grade, matricule
:::
```

- `[cle]` (facultative, entre crochets) : référence de zone — si la page réelle porte `data-zone="cle"` sur
  l'élément concerné, la légende devient cliquable et entoure cet élément (D13, `surlignerZone`). Jamais affichée.
  Sans elle, la ligne reste une légende ordinaire, non cliquable.
- `Libellé` est **toujours une phrase que la personne qui lit comprend** (« Terminer votre service »), jamais
  l'identifiant technique de la zone (« terminer-service ») : les deux sont volontairement séparés.
- Dans le schéma (SVG) lui-même : un texte **fixe à l'écran** (titre de champ, texte d'un bouton, nom d'une
  rubrique) peut être écrit en dur, puisqu'il est vérifié sur la page réelle et identique pour tout le monde.
  Une donnée propre à la personne connectée (son nom, son grade, une valeur saisie) reste un bloc abstrait,
  jamais un exemple inventé affiché comme si c'était une vraie donnée.

## Fidélité — règle absolue

Un schéma, un nom de bouton, un chemin de navigation ou une étape doit correspondre **exactement** à l'écran réel
au moment où l'article est écrit : même libellé, même ordre, même emplacement. Jamais une supposition. Avant
d'écrire un article qui décrit un geste, ouvrir la page réelle (navigateur, ou le fichier `gestion/*.html`/`*.js`
correspondant) et reprendre le texte qui s'y trouve mot pour mot.

## Exemple complet

```
---
titre: Se connecter
rubrique: index
mots-cles: discord, connexion, se connecter
---
La gestion est réservée à l'équipe. Connectez-vous avec votre compte Discord.

## Se connecter la première fois

::: etapes
**Ouvrez la page de connexion** {chemin:Espace de gestion}
**Cliquez sur** [Se connecter avec Discord]
**Autorisez l'accès** Discord vous demande de confirmer : acceptez.
:::

::: info
Pas encore membre du serveur Discord de l'entreprise ? Demandez l'invitation à un responsable.
:::
```
