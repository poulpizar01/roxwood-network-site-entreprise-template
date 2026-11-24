// ENTREPRISE — routes du module « demandes » (montées seulement s'il est allumé dans site.json) : formulaire public (identité
// Discord vérifiée exigée) et boîte de gestion. « demandes-voir » : lecture ; « demandes-gerer » : traiter (suppose
// demandes-voir) ; convertir en contrat exige en plus « contrats » (traiter une demande ne donne pas le droit de créer un contrat).
import { Router } from 'express';
import { body, intParam, permission } from '../../socle/http.js';
import { limiter } from '../../socle/limites.js';
import { identiteVerifiee } from '../../socle/routes/discord-leger.js';
import {
  changerStatutDemande, convertirEnContrat, creerDemande, creerSalonPourDemande, listerDemandes, modifierNotesDemande, modifierSalonDemande,
  reprendreSuiviDemande,
} from '../demandes.js';
import { traiter } from '../refus.js';

export const demandes = Router();
const voir = permission('demandes-voir');
const gerer = permission('demandes-gerer');
const versContrat = [...gerer, ...permission('contrats')];

// ---- formulaire public ----
const limiteDemandes = limiter(60, 10, 'Trop de demandes envoyées, réessayez plus tard.');
demandes.post('/api/demandes', limiteDemandes, traiter(async (req, res) => {
  const d = await creerDemande(body(req), identiteVerifiee(req));
  res.status(201).json({ id: d.id });
}));

// ---- boîte « Demandes » (gestion) ----
demandes.get('/api/demandes', ...voir, traiter(async (_req, res) => { res.json({ demandes: await listerDemandes() }); }));

demandes.patch('/api/demandes/:id', ...gerer, traiter(async (req, res) => {
  const b = body(req);
  if ('statut' in b) await changerStatutDemande(intParam(req, 'id'), b.statut, req.compte.id);
  if ('notes' in b) await modifierNotesDemande(intParam(req, 'id'), b.notes);
  if ('salonDiscordId' in b) await modifierSalonDemande(intParam(req, 'id'), b.salonDiscordId);
  res.json({ ok: true });
}));
demandes.post('/api/demandes/:id/reprendre', ...gerer, traiter(async (req, res) => { await reprendreSuiviDemande(intParam(req, 'id'), req.compte.id); res.json({ ok: true }); }));
demandes.post('/api/demandes/:id/salon', ...gerer, traiter(async (req, res) => { res.status(201).json({ salonDiscordId: await creerSalonPourDemande(intParam(req, 'id')) }); }));
demandes.post('/api/demandes/:id/contrat', ...versContrat, traiter(async (req, res) => {
  const c = await convertirEnContrat(intParam(req, 'id'), body(req), req.compte.id);
  res.status(201).json({ id: c.id });
}));
