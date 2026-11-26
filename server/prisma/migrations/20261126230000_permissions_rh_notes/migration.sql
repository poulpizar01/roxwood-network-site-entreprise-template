-- « Consulter les notes internes » devient un droit à part. Les grades qui consultaient les fiches le reçoivent, pour que
-- personne ne perde un accès sans décision : la Direction le retire ensuite où il faut. La lecture est par ailleurs
-- limitée aux fiches d'un grade sous le sien, jamais la sienne (entreprise/rh.ts, peutLireNotes).
UPDATE "grades" SET "permissions" = array_append("permissions", 'rh-notes-voir')
  WHERE 'rh-voir' = ANY("permissions") AND NOT 'rh-notes-voir' = ANY("permissions");
