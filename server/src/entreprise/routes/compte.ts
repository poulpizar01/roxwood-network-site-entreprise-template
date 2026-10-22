// ENTREPRISE — routes de gestion/compte.html (Mon compte) : fiche employé reliée au compte Discord connecté
// (téléphone, RIB — jamais le grade ni l'ID, réservés à un supérieur RH) et son quota de run de la semaine.
import { Router } from 'express';
import { body, valide } from '../../socle/http.js';
import { traiter } from '../refus.js';
import { definirMaFiche, maFiche } from '../rh.js';
import { monQuota } from '../run.js';

export const compte = Router();

compte.get('/api/moi/fiche', ...valide, async (req, res) => {
  const fiche = await maFiche(req.compte.discordId);
  res.json({ fiche, quota: fiche ? await monQuota(fiche.id) : null });
});

compte.patch('/api/moi/fiche', ...valide, traiter(async (req, res) => {
  await definirMaFiche(req.compte.discordId, body(req));
  res.json({ ok: true });
}));
