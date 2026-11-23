-- Permissions « voir » séparées des permissions « agir » (téléphone/RIB, sanctions) : aucun grade ne perd un accès.
-- rh-sensible permettait de voir ET de modifier : ses porteurs reçoivent rh-sensible-voir.
UPDATE "grades" SET "permissions" = array_append("permissions", 'rh-sensible-voir')
  WHERE 'rh-sensible' = ANY("permissions") AND NOT 'rh-sensible-voir' = ANY("permissions");
-- la page Sanctions s'ouvrait avec rh-voir : ses porteurs, et ceux qui sanctionnent, reçoivent rh-sanctions-voir.
UPDATE "grades" SET "permissions" = array_append("permissions", 'rh-sanctions-voir')
  WHERE ('rh-voir' = ANY("permissions") OR 'rh-sanctionner' = ANY("permissions")) AND NOT 'rh-sanctions-voir' = ANY("permissions");
