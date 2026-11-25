---
titre: Importer le relevé Tablettes
rubrique: dot
mots-cles: dot, tablettes, relevé, importer, coller, ca brut, semaine
permission: compta
---
Le relevé Tablettes contient les ventes de la semaine et le total entreprise. Il se colle depuis un outil externe (Excel, Google Sheets…). Son total donne le chiffre d'affaires brut de la déclaration DOT. Un relevé appartient à sa semaine : une semaine sans relevé n'emprunte aucun chiffre à une autre.

## Importer un relevé

::: etapes
**Ouvrez l'onglet** Dans {chemin:Comptabilité›DOT}, restez sur l'onglet **Tablettes**.
**Choisissez la semaine** La liste « Semaine du relevé » propose les semaines. La semaine en cours est choisie par défaut.
**Cliquez sur** [Importer]. Une fenêtre s'ouvre.
**Collez vos données** Copiez les cellules depuis votre tableur et collez-les avec {Ctrl}+{V}. La première ligne doit contenir les titres des colonnes.
**Vérifiez l'aperçu** Contrôlez que chaque valeur est dans la bonne colonne.
**Enregistrez** Cliquez sur [Enregistrer]. Le bouton reste grisé tant que le tableau n'est pas valide.
:::

::: attention Un tableau ambigu est refusé
Un titre de colonne vide, un titre en double ou un membre en double empêche l'enregistrement. Si une ligne comme « TOTAL » n'a pas de valeur pour une colonne, mettez un tiret « - » à cet endroit avant de coller, sinon les colonnes suivantes se décalent.
:::

## Retirer ou vider

- [Copier le tableau] copie le relevé affiché.
- [Réinitialiser] vide l'affichage de la semaine, après confirmation. Le relevé précédent reste conservé côté serveur ; vous pouvez importer un nouveau relevé tout de suite.
- Dans le tableau, le retrait d'un membre recalcule les totaux sans cette ligne, après confirmation.

::: attention Semaine verrouillée
Une fois la déclaration de la semaine validée (ou verrouillée automatiquement), le relevé ne change plus : [Importer] est désactivé et les retraits sont impossibles. Importez le relevé avant de valider.
:::
