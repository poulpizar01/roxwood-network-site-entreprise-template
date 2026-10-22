-- Jeu de données d'exemple pour « Dépenses déductibles et retraits » (compta_dot_ecritures), comptabilite.html.
-- Entrées propres à l'exemple fourni par le modèle : à retirer ou remplacer dans un site réel (compte_id NULL : pas
-- d'auteur, comme une ligne dont le compte a été supprimé).
INSERT INTO "compta_dot_ecritures" ("type", "date_ecriture", "justificatif", "montant") VALUES
  ('depense', '06/10/2026', 'Essence des véhicules de service', 850),
  ('depense', '09/10/2026', 'Matériel et fournitures', 1200),
  ('depense', '12/10/2026', 'Entretien des locaux', 600),
  ('retrait', '13/10/2026', 'Retrait associé — Javier Silva', 4000),
  ('retrait', '13/10/2026', 'Retrait associé — Co-patron', 3000);
