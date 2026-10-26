// ENTREPRISE — routes des échéanciers (/api/echeanciers/…), page gestion/echeanciers.html et fiche d'un contrat
// client (gestion/contrats.js). Permissions « factures-voir » (lecture) et « factures » (gestion, même domaine que
// la facturation).
import { Router } from 'express';
import { body, intParam, permission } from '../../socle/http.js';
import {
  ajouterEcheance, ajusterMontantAPartirDe, creerEcheancierLibre, creerEcheancierPaiement, demarquerEcheancePayee,
  etendre, facturerEcheances, listerEcheanciers, marquerEcheancePayee, modifierEcheance,
  supprimerEcheance, supprimerEcheancier,
} from '../echeanciers.js';
import { Refus, traiter } from '../refus.js';

export const echeanciers = Router();
const gerer = permission('factures');

echeanciers.get('/api/echeanciers', ...permission('factures-voir'), async (_req, res) => { res.json({ echeanciers: await listerEcheanciers() }); });

// libre (sans contrat) : partenaire saisi, avec ou sans générateur (dates/montants, voir lireGenerateur)
echeanciers.post('/api/echeanciers', ...gerer, traiter(async (req, res) => {
  const e = await creerEcheancierLibre(body(req), req.compte.id);
  res.status(201).json({ id: e.id });
}));

// paiement en plusieurs fois d'une facture déjà émise
echeanciers.post('/api/echeanciers/paiement', ...gerer, traiter(async (req, res) => {
  const b = body(req);
  const factureId = Number(b.factureId);
  if (!Number.isInteger(factureId)) throw new Refus('Facture invalide.');
  const e = await creerEcheancierPaiement(factureId, b, req.compte.id);
  res.status(201).json({ id: e.id });
}));

echeanciers.delete('/api/echeanciers/:id', ...gerer, traiter(async (req, res) => {
  await supprimerEcheancier(intParam(req, 'id'));
  res.json({ ok: true });
}));

echeanciers.post('/api/echeanciers/:id/echeances', ...gerer, traiter(async (req, res) => {
  const e = await ajouterEcheance(intParam(req, 'id'), body(req));
  res.status(201).json({ id: e.id });
}));

// « Nouveau montant à partir du … » : toutes les échéances non facturées à partir de cette date
echeanciers.post('/api/echeanciers/:id/ajuster', ...gerer, traiter(async (req, res) => {
  const b = body(req);
  await ajusterMontantAPartirDe(intParam(req, 'id'), b.date, b.montant);
  res.json({ ok: true });
}));

// ajoute des échéances après la dernière (même montant, rythme choisi)
echeanciers.post('/api/echeanciers/:id/etendre', ...gerer, traiter(async (req, res) => {
  const b = body(req);
  await etendre(intParam(req, 'id'), Math.round(Number(b.nombre)), b.rythme);
  res.json({ ok: true });
}));

// facturer une sélection d'échéances (avant ou après leur date prévue) : une facture par échéance
echeanciers.post('/api/echeanciers/:id/facturer', ...gerer, traiter(async (req, res) => {
  const b = body(req);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger);
  const factureIds = await facturerEcheances(intParam(req, 'id'), ids, req.compte.id);
  res.status(201).json({ factureIds });
}));

echeanciers.put('/api/echeances/:id', ...gerer, traiter(async (req, res) => {
  await modifierEcheance(intParam(req, 'id'), body(req));
  res.json({ ok: true });
}));

echeanciers.delete('/api/echeances/:id', ...gerer, traiter(async (req, res) => {
  await supprimerEcheance(intParam(req, 'id'));
  res.json({ ok: true });
}));

// paiement en plusieurs fois : réglé à la main seulement (aucune information de paiement partiel ne vient du bot)
echeanciers.post('/api/echeances/:id/payer', ...gerer, traiter(async (req, res) => {
  await marquerEcheancePayee(intParam(req, 'id'), body(req).moyenPaiement);
  res.json({ ok: true });
}));
echeanciers.delete('/api/echeances/:id/payer', ...gerer, traiter(async (req, res) => {
  await demarquerEcheancePayee(intParam(req, 'id'));
  res.json({ ok: true });
}));
