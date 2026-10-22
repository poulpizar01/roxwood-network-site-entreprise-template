// ENTREPRISE — routes de la page gestion/paie.html (permission « paie ») : salaire de base et primes par palier de
// quota (run, facture) par grade, et le simulateur (chiffres saisis à la main, ou vraies données d'un employé sur une
// semaine). Logique : entreprise/paie.ts.
import { Router } from 'express';
import { prisma } from '../../socle/db.js';
import { auDessusDe, gradeDe } from '../../socle/droits.js';
import { body, permission } from '../../socle/http.js';
import {
  calculerPaie, definirPaliers, definirSalaireBase, DOMAINES_PALIER, employesPourSimulateur,
  paieGrades, statsEmployeSemaine, type Palier,
} from '../paie.js';
import { Refus, traiter } from '../refus.js';
import { jourValide } from '../texte.js';

export const paie = Router();
const gerer = permission('paie');

paie.get('/api/paie/grades', ...gerer, async (_req, res) => { res.json({ grades: await paieGrades() }); });

paie.put('/api/paie/grades/:grade/salaire', ...gerer, traiter(async (req, res) => {
  const grade = String(req.params.grade);
  if (!gradeDe(grade)) throw new Refus('Grade introuvable.', 404);
  if (!auDessusDe(req.compte, grade)) throw new Refus('Vous ne gérez que les grades sous le vôtre.', 403);
  const b = body(req);
  const salaireActif = !!b.salaireActif;
  const salaireFixe = Math.round(Number(b.salaireFixe));
  if (salaireActif && (!Number.isFinite(salaireFixe) || salaireFixe < 0 || salaireFixe > 1_000_000)) {
    throw new Refus('Le salaire de base doit être un nombre entier positif.');
  }
  await definirSalaireBase(grade, salaireActif ? salaireFixe : null, salaireActif);
  res.json({ ok: true });
}));

paie.put('/api/paie/grades/:grade/paliers/:domaine', ...gerer, traiter(async (req, res) => {
  const grade = String(req.params.grade);
  if (!gradeDe(grade)) throw new Refus('Grade introuvable.', 404);
  if (!auDessusDe(req.compte, grade)) throw new Refus('Vous ne gérez que les grades sous le vôtre.', 403);
  const domaine = String(req.params.domaine);
  if (!DOMAINES_PALIER.includes(domaine as typeof DOMAINES_PALIER[number])) throw new Refus('Le domaine doit être « run » ou « facture ».', 404);
  const liste = Array.isArray(body(req).paliers) ? body(req).paliers as unknown[] : [];
  if (liste.length > 20) throw new Refus('20 paliers au maximum.');
  const seuilsVus = new Set<number>();
  const paliers: Palier[] = liste.map(p => {
    const o = (p ?? {}) as Record<string, unknown>;
    const seuil = Math.round(Number(o.seuil));
    const prime = Math.round(Number(o.prime));
    if (!Number.isFinite(seuil) || seuil < 0 || seuil > 1_000_000) throw new Refus('Chaque seuil doit être un nombre entier positif.');
    if (!Number.isFinite(prime) || prime < 0 || prime > 1_000_000) throw new Refus('Chaque prime doit être un nombre entier positif.');
    if (seuilsVus.has(seuil)) throw new Refus('Deux paliers ne peuvent pas avoir le même seuil.');
    seuilsVus.add(seuil);
    return { seuil, prime };
  });
  await definirPaliers(grade, domaine as typeof DOMAINES_PALIER[number], paliers);
  res.json({ ok: true });
}));

paie.get('/api/paie/employes', ...gerer, async (_req, res) => { res.json({ employes: await employesPourSimulateur() }); });

// simulateur : grade+runs+factures saisis à la main, ou employeId(+semaine) pour reprendre ses vraies données
paie.get('/api/paie/simuler', ...gerer, traiter(async (req, res) => {
  const q = req.query;
  const grades = await paieGrades();
  let gradeCle: string, runs: number, factures: number, source: 'manuel' | 'reel', debutSemaine: string | null = null;
  if (q.employeId != null && q.employeId !== '') {
    const employeId = Math.round(Number(q.employeId));
    const employe = Number.isFinite(employeId) ? await prisma.employe.findUnique({ where: { id: employeId } }) : null;
    if (!employe) throw new Refus('Employé introuvable.', 404);
    const semaine = typeof q.semaine === 'string' && jourValide(q.semaine) ? q.semaine : undefined;
    const stats = await statsEmployeSemaine(employeId, semaine);
    gradeCle = employe.gradeCle; runs = stats.runs; factures = stats.factures; source = 'reel'; debutSemaine = stats.debutSemaine;
  } else {
    gradeCle = String(q.grade ?? '');
    if (!gradeDe(gradeCle)) throw new Refus('Grade introuvable.', 404);
    runs = Math.max(0, Math.round(Number(q.runs ?? 0))) || 0;
    factures = Math.max(0, Math.round(Number(q.factures ?? 0))) || 0;
    source = 'manuel';
  }
  const config = grades.find(g => g.cle === gradeCle);
  if (!config) throw new Refus('Grade introuvable.', 404);
  const resultat = calculerPaie({
    salaireFixe: config.salaireFixe, salaireActif: config.salaireActif,
    paliersRun: config.paliersRun, runs, paliersFacture: config.paliersFacture, factures,
  });
  res.json({ grade: gradeCle, gradeLibelle: config.libelle, runs, factures, source, debutSemaine, ...resultat });
}));
