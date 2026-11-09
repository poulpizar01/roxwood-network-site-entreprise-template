---
name: conception
description: Règles de conception du réseau (ergonomie, responsive, accessibilité, textes d'interface, stabilité de l'affichage) et erreurs déjà commises à ne pas refaire. À charger avant de créer ou de modifier une page de la vitrine ou de la gestion, un composant, une feuille de style ou un texte affiché, et avant de déclarer un écran terminé.
---

# Conception d'une page ou d'un composant

La référence est `docs/design.md` — la seule source. Lis-le en entier à chaque invocation (il s'enrichit à chaque erreur corrigée) ; ne travaille pas de mémoire.

## Avant d'écrire

1. Lis `docs/design.md`, puis repère les sections qui concernent ce que tu vas toucher (menu, tableau, champ de date, contenu intégré, texte…).
2. Regarde si le modèle a déjà l'outil qui applique la règle (`gestion/gestion.js`, `gestion/gestion.css` : `fleche()`, `tablesAdaptatives`, `gestion.confirmer`, `gestion.notifier`, `champDateFr`, `pleinEcran`, `triable()`, `glisserColonnes()` et `.colonnes-statut`, `.squelette`…) : reprends-le ou adapte-le plutôt que d'en écrire un autre.
3. Les règles fixent le comportement, pas l'apparence : garde la direction artistique du site (couleurs, polices, formes, ton). Ne rapproche pas un site du modèle ou d'un autre site au nom d'une règle.

## Avant de dire que c'est fini

Suis la dernière section de `docs/design.md` (*Vérifier avant de dire que c'est fini*) : navigateur, quatre largeurs et 800 px de haut, barres de défilement visibles, vraies données chargées, clavier. Dis ce que tu n'as pas pu vérifier.

## Quand une nouvelle erreur est corrigée

Si la correction révèle une règle qui manque (l'erreur pourrait se reproduire sur un autre écran ou un autre site), propose de l'ajouter à `docs/design.md`, dans la section du thème, au format des autres : la règle, puis « Vu : » et l'erreur constatée. Une règle valable pour tout le réseau va dans le modèle ; une règle propre à un site va dans son `ENTREPRISE.md`.
