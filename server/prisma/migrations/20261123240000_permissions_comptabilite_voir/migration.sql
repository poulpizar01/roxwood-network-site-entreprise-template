-- Comptabilité : lecture et écriture séparées pour les factures, la paie, la DOT et les contrats. Chaque grade qui avait
-- la permission d'écriture (qui donnait aussi la lecture) reçoit la permission de lecture : aucun accès n'est perdu.
UPDATE "grades" SET "permissions" = array_append("permissions", 'factures-voir')
  WHERE 'factures' = ANY("permissions") AND NOT 'factures-voir' = ANY("permissions");
UPDATE "grades" SET "permissions" = array_append("permissions", 'paie-voir')
  WHERE 'paie' = ANY("permissions") AND NOT 'paie-voir' = ANY("permissions");
UPDATE "grades" SET "permissions" = array_append("permissions", 'compta-voir')
  WHERE 'compta' = ANY("permissions") AND NOT 'compta-voir' = ANY("permissions");
UPDATE "grades" SET "permissions" = array_append("permissions", 'contrats-voir')
  WHERE 'contrats' = ANY("permissions") AND NOT 'contrats-voir' = ANY("permissions");
