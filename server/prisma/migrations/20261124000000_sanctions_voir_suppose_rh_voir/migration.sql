-- La page Sanctions charge aussi la liste des employés (rh-voir) : rh-sanctions-voir suppose donc rh-voir. Un grade qui avait
-- rh-sanctionner sans rh-voir n'avait aucun accès à cette page (et l'a reçue de la migration précédente) : on lui retire
-- la clé pour revenir à la situation d'avant. Aucun droit n'est accordé, aucun accès n'existait.
UPDATE "grades" SET "permissions" = array_remove("permissions", 'rh-sanctions-voir')
  WHERE 'rh-sanctions-voir' = ANY("permissions") AND NOT 'rh-voir' = ANY("permissions");
