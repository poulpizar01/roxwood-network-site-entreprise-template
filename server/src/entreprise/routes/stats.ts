// ENTREPRISE — ventes & statistiques, tableur de la Direction, rémunération (/api/stats/…, /api/tableur/…), et primes
// de « Mon profil ». Logique : entreprise/stats/. Le bot de ventes s'authentifie par sa clé (pas de session).
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { prisma } from '../../socle/db.js';
import { auDessusDe, gradeDe, tousLesGrades } from '../../socle/droits.js';
import { body, entier, intParam, permission, valide } from '../../socle/http.js';
import { configEntreprise } from '../config.js';
import { lienRegle, sheetRegle } from '../parametres.js';
import { Refus, traiter } from '../refus.js';
import { infoPalier, primesSelonGrade } from '../stats/calcul.js';
import { remunerations } from '../stats/recap.js';
import { lireActuel, lireArchive, lireBaremes, semaineParis, synchroniserSansErreur } from '../stats/tableur.js';
import { enregistrerVente, semaines } from '../stats/ventes.js';

export const stats = Router();
const voir = permission('ventes'), gerer = permission('ventes-gerer'), compta = permission('compta');

// ---------- ventes ----------

// clé du bot, comparée à temps constant (empreintes de même longueur quelle que soit l'entrée)
const cleBotValide = (req: Request) => {
  const recue = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '')?.[1] ?? '';
  const empreinte = (v: string) => crypto.createHash('sha256').update(v).digest();
  return !!configEntreprise.statsBotSecret && crypto.timingSafeEqual(empreinte(recue), empreinte(configEntreprise.statsBotSecret));
};

// POST /api/stats/ventes — appelée par le bot de ventes (Authorization: Bearer <STATS_BOT_SECRET>), sans session
stats.post('/api/stats/ventes', traiter(async (req, res) => {
  if (!configEntreprise.statsBotSecret) { res.status(503).json({ error: 'Réception des ventes non configurée (STATS_BOT_SECRET).' }); return; }
  if (!cleBotValide(req)) { res.status(401).json({ error: 'Clé du bot invalide.' }); return; }
  const r = await enregistrerVente(body(req), null);
  res.status(r.deja ? 200 : 201).json({ ok: true, ...(r.deja && { dejaTraite: true }) });
}));

stats.get('/api/stats/semaines', ...voir, async (_req, res) => { res.json(await semaines()); });

// ---------- tableur de la Direction ----------

// « Chiffres du tableur » : la semaine en cours, ou ?semaine=S40-26 (archive figée le dimanche à 23:59)
stats.get('/api/stats/tableur', ...voir, traiter(async (req, res) => {
  const archives = (await prisma.tableurArchive.findMany({ orderBy: { id: 'desc' }, select: { semaine: true, archiveLe: true } }));
  const demandee = String(req.query.semaine ?? '').trim().toUpperCase();
  if (demandee) {
    const archive = await lireArchive(demandee);
    if (!archive) throw new Refus(`Aucune archive pour la semaine ${demandee}.`, 404);
    res.json({ archive, archives, lignes: archive.lignes });
    return;
  }
  const [actuel, etat] = await Promise.all([lireActuel(), prisma.tableurEtat.findUnique({ where: { id: 1 } })]);
  res.json({ configure: !!sheetRegle(), semaineEnCours: etat?.semaine || semaineParis(new Date()).code, derniereSync: etat?.derniereSync ?? null, statut: etat?.statut ?? null, archives, lignes: actuel.lignes });
}));

// état de la synchronisation et lignes lues (page Synchro du tableur)
stats.get('/api/tableur/etat', ...voir, async (_req, res) => {
  // état seul (jamais l'instantané gardé pour l'archive, ni rien que la page n'affiche)
  const [etat, lignes] = await Promise.all([prisma.tableurEtat.findUnique({ where: { id: 1 }, select: { statut: true, derniereSync: true, erreur: true, avertissement: true, nbLignes: true, nbApparies: true } }), prisma.ligneTableur.findMany({ orderBy: { ligneSheet: 'asc' } })]);
  const comptes = new Map((await prisma.compte.findMany({ where: { id: { in: lignes.map(l => l.compteId).filter((x): x is number => x !== null) } }, select: { id: true, nom: true, pseudo: true } })).map(c => [c.id, c.nom ?? c.pseudo]));
  res.json({
    configure: !!sheetRegle(), etat,
    lignes: lignes.map(l => ({ nom: l.nomSheet, grade: l.gradeSheet, ventes: l.nbVentes, locations: l.nbLocations, fiche: l.employeId !== null, compte: l.compteId ? comptes.get(l.compteId) ?? null : null })),
  });
});

// état seul de la lecture, pour la page Paramètres (qui règle le lien sans forcément voir les ventes)
stats.get('/api/tableur/etat-lecture', ...permission('parametres'), async (_req, res) => {
  const etat = await prisma.tableurEtat.findUnique({ where: { id: 1 }, select: { statut: true, derniereSync: true, erreur: true, avertissement: true, nbLignes: true } });
  res.json({ configure: !!sheetRegle(), etat });
});

stats.post('/api/tableur/synchroniser', ...gerer, async (_req, res) => {
  if (!sheetRegle()) { res.status(503).json({ error: 'Synchronisation en attente : réglez le lien du Google Sheets dans Paramètres.' }); return; }
  // l'échec est enregistré comme pour la synchronisation automatique (visible dans l'état), puis rapporté
  const etat = await synchroniserSansErreur();
  if (etat.statut !== 'ok') { res.status(502).json({ error: etat.erreur || 'Échec de la synchronisation.' }); return; }
  res.json({ ok: true, etat });
});

// ---------- primes de « Mon profil » ----------
// Ventes et locations de la ligne du tableur reliée à ce compte, primes recalculées avec les barèmes du site. Toujours
// des zéros tant qu'aucune ligne n'est reliée.
stats.get('/api/profil/primes', ...valide, async (req, res) => {
  const [ligne, baremes, etat, remu] = await Promise.all([
    prisma.ligneTableur.findFirst({ where: { compteId: req.compte.id } }),
    lireBaremes(),
    prisma.tableurEtat.findUnique({ where: { id: 1 } }),
    remunerations(),
  ]);
  // primes selon le grade (interrupteurs de Rémunération) : celui de la fiche RH reliée, sinon celui du compte
  const fiche = ligne?.employeId ? await prisma.employe.findUnique({ where: { id: ligne.employeId }, select: { gradeCle: true } }) : null;
  const ventes = ligne?.nbVentes ?? 0, locations = ligne?.nbLocations ?? 0;
  const r = remu(fiche?.gradeCle ?? req.compte.gradeCle);
  const p = primesSelonGrade(r, baremes, ventes, locations);
  // prochain palier (Accueil) : null quand la prime est coupée pour ce grade, rien à viser
  const paliers = { ventes: r.primeVenteActive === false ? null : infoPalier(baremes.ventes, ventes), locations: r.primeLocationActive === false ? null : infoPalier(baremes.locations, locations) };
  res.json({ synchronise: !!ligne, configure: !!sheetRegle(), ventes, locations, ...p, paliers, derniereSync: etat?.derniereSync ?? null });
});

// ---------- rémunération (Comptabilité) ----------
// Salaire fixe et interrupteurs par grade du site, paliers de primes : ils alimentent la DOT et les primes partout.
// Règle anti-escalade, comme les fiches RH : hors propriétaire, on ne règle que la rémunération des grades SOUS le sien
// (sinon un agent qui a « compta » relèverait son propre salaire). Les paliers valent pour tous les grades, le sien
// compris : réservés au grade le plus haut (personne au-dessus) et au propriétaire.
type Acteur = { proprietaire: boolean; gradeCle: string | null };
const reglableGrade = (c: Acteur, cle: string) => auDessusDe(c, cle);
const baremesModifiables = (c: Acteur) => {
  if (c.proprietaire) return true;
  const g = gradeDe(c.gradeCle);
  return !!g && !tousLesGrades().some(x => x.position < g.position);
};
const exigerBaremes = (req: Request) => {
  if (!baremesModifiables(req.compte)) throw new Refus('Les paliers de primes valent pour tous les grades, le vôtre compris : seul le grade le plus haut peut les modifier.', 403);
};

stats.get('/api/stats/remuneration', ...compta, async (req, res) => {
  const [lignes, baremes] = await Promise.all([prisma.remunerationGrade.findMany(), prisma.baremePrime.findMany({ orderBy: [{ type: 'asc' }, { seuil: 'asc' }] })]);
  const parGrade = new Map(lignes.map(l => [l.gradeCle, l]));
  res.json({
    grades: tousLesGrades().map(g => {
      const r = parGrade.get(g.cle);
      return { grade: g.cle, libelle: g.libelle, couleur: g.couleur, salaireFixe: r?.salaireFixe ?? 0, salaireActif: r?.salaireActif ?? false, primeVenteActive: r?.primeVenteActive ?? true, primeLocationActive: r?.primeLocationActive ?? true, tauxHoraire: r?.tauxHoraire ?? 0, modifiable: reglableGrade(req.compte, g.cle) };
    }),
    baremesModifiables: baremesModifiables(req.compte),
    baremesVentes: baremes.filter(b => b.type === 'vente').map(({ id, seuil, montant }) => ({ id, seuil, montant })),
    baremesLocations: baremes.filter(b => b.type === 'location').map(({ id, seuil, montant }) => ({ id, seuil, montant })),
  });
});

stats.patch('/api/stats/remuneration/grades/:cle', ...compta, traiter(async (req, res) => {
  const g = gradeDe(String(req.params.cle));
  if (!g) throw new Refus('Grade invalide.');
  if (!reglableGrade(req.compte, g.cle)) throw new Refus('Vous ne réglez que la rémunération des grades en dessous du vôtre.', 403);
  const b = body(req), data: Record<string, unknown> = {};
  if (b.salaireFixe !== undefined) {
    const n = b.salaireFixe === null || b.salaireFixe === '' ? 0 : Number(b.salaireFixe);
    if (!Number.isFinite(n) || n < 0 || n > 2_147_483_647) throw new Refus('Le montant du salaire doit être un nombre positif.');
    data.salaireFixe = Math.round(n);
  }
  if (b.tauxHoraire !== undefined) {
    const n = b.tauxHoraire === null || b.tauxHoraire === '' ? 0 : Number(b.tauxHoraire);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new Refus('Le taux horaire doit être un nombre positif.');
    data.tauxHoraire = Math.round(n);
  }
  for (const c of ['salaireActif', 'primeVenteActive', 'primeLocationActive'] as const) if (b[c] !== undefined) data[c] = b[c] === true;
  if (!Object.keys(data).length) throw new Refus('Rien à modifier.');
  await prisma.remunerationGrade.upsert({ where: { gradeCle: g.cle }, create: { gradeCle: g.cle, ...data }, update: data });
  res.json({ ok: true });
}));

function lirePalier(b: Record<string, unknown>, partiel: boolean) {
  const data: { seuil?: number; montant?: number } = {};
  if (!partiel || b.seuil !== undefined) {
    const seuil = entier(b.seuil);
    if (!seuil) throw new Refus('Le seuil (nombre à atteindre) doit être un nombre entier positif.');
    data.seuil = seuil;
  }
  if (!partiel || b.montant !== undefined) {
    const montant = Number(b.montant);
    if (!Number.isFinite(montant) || montant < 0 || montant > 2_147_483_647) throw new Refus('Le montant de la prime doit être un nombre positif.');
    data.montant = Math.round(montant);
  }
  return data;
}
const conflitPalier = (e: unknown) => {
  if ((e as { code?: string }).code === 'P2002') throw new Refus('Un palier existe déjà pour ce seuil — modifiez-le plutôt.', 409);
  throw e;
};

stats.post('/api/stats/baremes', ...compta, traiter(async (req, res) => {
  exigerBaremes(req);
  const b = body(req);
  if (b.type !== 'vente' && b.type !== 'location') throw new Refus('Le type doit être « vente » ou « location ».');
  const p = await prisma.baremePrime.create({ data: { type: b.type, ...lirePalier(b, false) } as { type: string; seuil: number; montant: number } }).catch(conflitPalier);
  res.status(201).json({ id: p.id });
}));
stats.patch('/api/stats/baremes/:id', ...compta, traiter(async (req, res) => {
  exigerBaremes(req);
  const data = lirePalier(body(req), true);
  if (!Object.keys(data).length) throw new Refus('Rien à modifier.');
  const { count } = await prisma.baremePrime.updateMany({ where: { id: intParam(req, 'id') }, data }).catch(conflitPalier);
  if (!count) throw new Refus('Palier introuvable.', 404);
  res.json({ ok: true });
}));
stats.delete('/api/stats/baremes/:id', ...compta, traiter(async (req, res) => {
  exigerBaremes(req);
  const { count } = await prisma.baremePrime.deleteMany({ where: { id: intParam(req, 'id') } });
  if (!count) { res.status(404).json({ error: 'Palier introuvable.' }); return; }
  res.json({ ok: true });
}));

// outils du menu : lien du registre (réglé dans Paramètres, servi aux seuls comptes validés)
stats.get('/api/outils', ...valide, (_req, res) => {
  res.json({ registre: lienRegle('registre_url') || null });
});
