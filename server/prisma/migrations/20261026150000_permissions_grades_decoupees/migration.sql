-- ENTREPRISE — reprise des grades après le découpage de permissions trop larges (aucun grade ne perd de droit) :
--   rh-voir           -> + rh-sanctions-voir, quota, services (ces trois consultations dépendaient de rh-voir)
--   rh-modifier       -> + services-corriger (corriger un service dépendait de rh-modifier)
--   rh-sanctionner    -> + rh-sanctions-voir (gérer suppose désormais de pouvoir consulter la page Sanctions)
--   factures          -> + factures-voir (nouvelle permission de lecture, exigée par « factures »)
--   agenda « gérer toute l'équipe » (gerer_tous) -> + agenda-absences (la validation d'absence devient une permission à part)
UPDATE "grades"
SET permissions = (SELECT array_agg(DISTINCT e) FROM unnest(permissions || ARRAY['rh-sanctions-voir', 'quota', 'services']) e)
WHERE 'rh-voir' = ANY(permissions);

UPDATE "grades"
SET permissions = (SELECT array_agg(DISTINCT e) FROM unnest(permissions || ARRAY['services-corriger']) e)
WHERE 'rh-modifier' = ANY(permissions);

UPDATE "grades"
SET permissions = (SELECT array_agg(DISTINCT e) FROM unnest(permissions || ARRAY['rh-sanctions-voir']) e)
WHERE 'rh-sanctionner' = ANY(permissions);

UPDATE "grades"
SET permissions = (SELECT array_agg(DISTINCT e) FROM unnest(permissions || ARRAY['factures-voir']) e)
WHERE 'factures' = ANY(permissions);

UPDATE "grades" g
SET permissions = (SELECT array_agg(DISTINCT e) FROM unnest(g.permissions || ARRAY['agenda-absences']) e)
FROM "agenda_droits_grades" a
WHERE a."grade" = g."cle" AND a."gerer_tous" = true;
