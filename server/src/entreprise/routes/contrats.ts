// ENTREPRISE — routes des contrats (/api/contrats/…), page gestion/contrats.html. Permission « contrats ». Page
// Bénéficiaires (/api/beneficiaires) : permission « contrats-beneficiaires », lecture seule.
import { Router } from 'express';
import { body, couleur, intParam, permission, text } from '../../socle/http.js';
import { prisma } from '../../socle/db.js';
import { config } from '../../socle/config.js';
import { limiter } from '../../socle/limites.js';
import {
  analyserCollageContrat, beneficiairesEnCours, creerAccesContrat, creerContrat, ecrireAccesContrat, lireAccesContrat,
  listerContrats, listeTypesContrat, modifierContrat, PARTIES_CONTRAT, PartieContrat, reprendreContrat, revoquerAccesContrat,
  supprimerContrat, terminerContrat,
} from '../contrats.js';
import { joursAccesContrats } from '../parametres.js';
import { Refus, traiter } from '../refus.js';

export const contrats = Router();
const gerer = permission('contrats');

contrats.get('/api/contrats', ...gerer, async (_req, res) => {
  res.json({ contrats: await listerContrats(), types: await listeTypesContrat(), joursAcces: joursAccesContrats() });
});

// ---- types de contrat : classement libre (nom, couleur), par partie (client ou fournisseur) — comme les types
// d'agenda ou de sanction ----
function lireTypeContrat(b: Record<string, unknown>) {
  const nom = text(b.nom, 40), c = couleur(b.couleur);
  if (!nom) throw new Refus('Donnez un nom au type.');
  if (!c) throw new Refus('Couleur invalide.');
  if (!PARTIES_CONTRAT.includes(b.partie as PartieContrat)) throw new Refus('Choisissez un client ou un fournisseur.');
  return { nom, couleur: c, partie: b.partie as PartieContrat };
}
const nomPris = (e: unknown) => (e as { code?: string }).code === 'P2002';

contrats.post('/api/contrats/types', ...gerer, traiter(async (req, res) => {
  const t = lireTypeContrat(body(req));
  if (await prisma.typeContrat.count() >= 30) throw new Refus('30 types au plus : regroupez-en avant d’en créer un autre.');
  const position = (await prisma.typeContrat.aggregate({ _max: { position: true } }))._max.position ?? -1;
  try { await prisma.typeContrat.create({ data: { ...t, position: position + 1 } }); }
  catch (e) { if (nomPris(e)) throw new Refus(`Le type « ${t.nom} » existe déjà.`, 409); throw e; }
  res.status(201).json({ types: await listeTypesContrat() });
}));

contrats.put('/api/contrats/types/:id', ...gerer, traiter(async (req, res) => {
  const t = lireTypeContrat(body(req));
  try { await prisma.typeContrat.update({ where: { id: intParam(req, 'id') }, data: t }); }
  catch (e) {
    if (nomPris(e)) throw new Refus(`Le type « ${t.nom} » existe déjà.`, 409);
    if ((e as { code?: string }).code === 'P2025') throw new Refus('Type introuvable.', 404);
    throw e;
  }
  res.json({ types: await listeTypesContrat() });
}));

// ses contrats restent, « sans type » (onDelete: SetNull)
contrats.delete('/api/contrats/types/:id', ...gerer, traiter(async (req, res) => {
  await prisma.typeContrat.deleteMany({ where: { id: intParam(req, 'id') } });
  res.json({ types: await listeTypesContrat() });
}));

contrats.post('/api/contrats', ...gerer, traiter(async (req, res) => {
  const c = await creerContrat(body(req), req.compte.id);
  res.status(201).json({ id: c.id });
}));

contrats.put('/api/contrats/:id', ...gerer, traiter(async (req, res) => {
  await modifierContrat(intParam(req, 'id'), body(req));
  res.json({ ok: true });
}));

// mettre fin (à la fin de la période en cours, ou maintenant) ; reprendre : reconduction tacite, sans date de fin
contrats.post('/api/contrats/:id/terminer', ...gerer, traiter(async (req, res) => {
  await terminerContrat(intParam(req, 'id'), body(req).quand);
  res.json({ ok: true });
}));

contrats.post('/api/contrats/:id/reprendre', ...gerer, traiter(async (req, res) => {
  await reprendreContrat(intParam(req, 'id'));
  res.json({ ok: true });
}));

// page Bénéficiaires : qui est couvert par un contrat client en cours (rien d'autre du contrat)
contrats.get('/api/beneficiaires', ...permission('contrats-beneficiaires'), async (_req, res) => {
  res.json({ contrats: await beneficiairesEnCours() });
});

contrats.delete('/api/contrats/:id', ...gerer, traiter(async (req, res) => {
  await supprimerContrat(intParam(req, 'id'));
  res.json({ ok: true });
}));

// ---- accès client (lien à jeton) : donner/révoquer, depuis la gestion ----
contrats.post('/api/contrats/:id/acces', ...gerer, traiter(async (req, res) => {
  const jeton = await creerAccesContrat(intParam(req, 'id'));
  res.json({ lien: `${config.baseUrl}/gestion/contrat-client.html?jeton=${jeton}` });
}));

contrats.delete('/api/contrats/:id/acces', ...gerer, traiter(async (req, res) => {
  await revoquerAccesContrat(intParam(req, 'id'));
  res.json({ ok: true });
}));

// ---- espace du client lui-même (lien à jeton, sans session ni permission : le jeton fait foi) ----
contrats.get('/api/contrats/acces/:jeton', traiter(async (req, res) => {
  res.json(await lireAccesContrat(String(req.params.jeton)));
}));

// aperçu d'un collage de tablette : rien n'est enregistré ; limité (texte analysé, lien sans compte)
const limiteAnalyse = limiter(1, 30, 'Trop de collages d’affilée : patientez une minute avant de recommencer.');
contrats.post('/api/contrats/acces/:jeton/analyser', limiteAnalyse, traiter(async (req, res) => {
  res.json(await analyserCollageContrat(String(req.params.jeton), body(req).texte));
}));

contrats.put('/api/contrats/acces/:jeton', traiter(async (req, res) => {
  await ecrireAccesContrat(String(req.params.jeton), body(req).beneficiaires);
  res.json({ ok: true });
}));
