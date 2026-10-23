// SOCLE — compte courant (/api/moi), annuaire, gestion des comptes (permission « comptes »).
import { Router } from 'express';
import { prisma } from '../db.js';
import type { Compte } from '../../generated/prisma/client.js';
import { body, connecte, intParam, permission, text, valide } from '../http.js';
import { auDessusDe, gradeDe, permissions, permissionsDe, rang } from '../droits.js';
import { entreprise } from '../../entreprise/index.js';
import { gradesImposes, type GradeImpose } from '../grades-imposes.js';

export const comptes = Router();

const avatar = (c: Pick<Compte, 'discordId' | 'avatar'>) => (c.avatar ? `https://cdn.discordapp.com/avatars/${c.discordId}/${c.avatar}.webp?size=128` : null);
const grade = (cle: string | null) => {
  const g = gradeDe(cle);
  return g ? { cle: g.cle, libelle: g.libelle, couleur: g.couleur } : null;
};
// compte tel qu'exposé à la gestion (jamais de session, jamais de donnée de l'entreprise)
// gradeImpose : raison (« Fiche RH ») quand l'entreprise fixe le grade (grades-imposes.ts) — il ne se change pas ici
const comptePublic = (c: Compte, impose?: GradeImpose) => ({
  id: c.id, discordId: c.discordId, pseudo: c.pseudo, nom: c.nom, avatar: avatar(c), statut: c.statut,
  proprietaire: c.proprietaire, grade: grade(c.gradeCle), creeLe: c.creeLe, connecteLe: c.connecteLe, valideLe: c.valideLe,
  quitteLe: c.quitteLe,   // parti du serveur Discord (vu par le bot, synchro-discord.ts)
  gradeImpose: impose?.raison ?? null,
});

// suppression d'un compte : d'abord ce que l'entreprise lui rattache, puis le compte, dans une seule transaction
const supprimerCompte = (id: number) => prisma.$transaction(async tx => {
  await entreprise.avantSuppressionCompte?.(id, tx);
  await tx.compte.delete({ where: { id } });
});

// ---------- compte courant ----------
comptes.get('/api/moi', ...connecte, async (req, res) => {
  const c = await prisma.compte.findUnique({ where: { id: req.session.compteId } });
  if (!c) { req.session.destroy(() => res.status(401).json({ error: 'non-connecte' })); return; }
  res.json({ ...comptePublic(c), permissions: c.statut === 'valide' ? [...permissionsDe(c)] : [] });
});

comptes.patch('/api/moi', ...valide, async (req, res) => {
  const nom = text(body(req).nom, 64);
  if (!nom) { res.status(400).json({ error: 'Le nom ne peut pas être vide.' }); return; }
  const c = await prisma.compte.update({ where: { id: req.compte.id }, data: { nom } });
  res.json(comptePublic(c));
});

// supprimer son propre compte, validé ou en attente (le propriétaire du serveur Discord aussi : il sera recréé à sa
// prochaine connexion). Pas un compte refusé : recréé à la connexion suivante, il effacerait son refus (de nouveau en
// attente, voire validé d'office par un rôle Discord). Seul un gestionnaire des comptes peut le supprimer.
comptes.delete('/api/moi', ...connecte, async (req, res) => {
  const id = req.session.compteId!;
  const c = await prisma.compte.findUnique({ where: { id }, select: { statut: true } });
  if (c?.statut === 'refuse') { res.status(403).json({ error: 'Ton accès a été refusé : seul un responsable peut supprimer ce compte.' }); return; }
  if (c) await supprimerCompte(id);
  req.session.destroy(() => res.clearCookie('site.sid').json({ ok: true }));
});

// ---------- références pour les pages ----------
// toutes les permissions (socle + entreprise), pour les cases à cocher des grades
comptes.get('/api/permissions', ...valide, (_req, res) => { res.json(permissions); });

// annuaire : comptes validés, du sommet de la hiérarchie à la base (nom, avatar, grade)
comptes.get('/api/annuaire', ...valide, async (_req, res) => {
  const liste = await prisma.compte.findMany({ where: { statut: 'valide' } });
  liste.sort((a, b) => rang(a.gradeCle) - rang(b.gradeCle) || (a.nom ?? a.pseudo).localeCompare(b.nom ?? b.pseudo, 'fr'));
  res.json(liste.map(c => ({ id: c.id, nom: c.nom ?? c.pseudo, avatar: avatar(c), grade: grade(c.gradeCle) })));
});

// ---------- gestion des comptes ----------
comptes.get('/api/comptes', ...permission('comptes'), async (_req, res) => {
  const liste = await prisma.compte.findMany({ orderBy: { creeLe: 'desc' } });
  const imposes = await gradesImposes(liste.map(c => c.discordId));
  res.json(liste.map(c => comptePublic(c, imposes.get(c.discordId))));
});

// valider / refuser, renommer, changer de grade. Hors propriétaire : seulement un compte sous son propre grade, vers un
// grade sous le sien ; jamais son propre compte ; le compte du propriétaire du serveur Discord ne se touche que par lui.
comptes.patch('/api/comptes/:id', ...permission('comptes'), async (req, res) => {
  const cible = await prisma.compte.findUnique({ where: { id: intParam(req, 'id') } });
  if (!cible) { res.status(404).json({ error: 'Compte introuvable.' }); return; }
  const moi = req.compte;
  if (cible.id === moi.id && !moi.proprietaire) { res.status(403).json({ error: 'Ton propre compte se modifie par un autre gestionnaire.' }); return; }
  if (cible.proprietaire && !moi.proprietaire) { res.status(403).json({ error: 'Le compte du propriétaire ne se modifie que par lui.' }); return; }
  if (!auDessusDe(moi, cible.gradeCle)) { res.status(403).json({ error: 'Ce compte a un grade égal ou supérieur au tien.' }); return; }

  const b = body(req), data: Record<string, unknown> = {};
  if (b.statut !== undefined) {
    if (b.statut !== 'valide' && b.statut !== 'refuse' && b.statut !== 'attente') { res.status(400).json({ error: 'Statut inconnu.' }); return; }
    if (cible.proprietaire && b.statut !== 'valide') { res.status(400).json({ error: 'Le propriétaire reste validé.' }); return; }
    data.statut = b.statut;
    if (b.statut === 'valide' && cible.statut !== 'valide') Object.assign(data, { valideLe: new Date(), valideParId: moi.id });
  }
  if (b.nom !== undefined) {
    const nom = text(b.nom, 64);
    if (!nom) { res.status(400).json({ error: 'Le nom ne peut pas être vide.' }); return; }
    data.nom = nom;
  }
  const impose = (await gradesImposes([cible.discordId])).get(cible.discordId);
  if (b.grade !== undefined) {
    if (impose) { res.status(409).json({ error: `Le grade de ce compte est fixé par : ${impose.raison}. Changez-le là-bas.` }); return; }
    const cle = b.grade === null || b.grade === '' ? null : String(b.grade);
    if (cle !== null && !gradeDe(cle)) { res.status(400).json({ error: 'Grade inconnu.' }); return; }
    if (cle !== null && !auDessusDe(moi, cle)) { res.status(403).json({ error: 'Tu ne peux attribuer qu’un grade inférieur au tien.' }); return; }
    data.gradeCle = cle;
  }
  const c = await prisma.compte.update({ where: { id: cible.id }, data });
  res.json(comptePublic(c, impose));
});

comptes.delete('/api/comptes/:id', ...permission('comptes'), async (req, res) => {
  const cible = await prisma.compte.findUnique({ where: { id: intParam(req, 'id') } });
  if (!cible) { res.status(404).json({ error: 'Compte introuvable.' }); return; }
  const moi = req.compte;
  if (cible.id === moi.id) { res.status(400).json({ error: 'Pour supprimer ton propre compte, passe par ta page de compte.' }); return; }
  if (cible.proprietaire && !moi.proprietaire) { res.status(403).json({ error: 'Le compte du propriétaire ne se supprime que par lui.' }); return; }
  if (!auDessusDe(moi, cible.gradeCle)) { res.status(403).json({ error: 'Ce compte a un grade égal ou supérieur au tien.' }); return; }
  await supprimerCompte(cible.id);
  res.json({ ok: true });
});
