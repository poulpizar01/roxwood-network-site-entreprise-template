// ENTREPRISE — routes de la page gestion/quota.html (/api/run), partie run : classement et progression en unités
// vendues depuis lundi (heure de Paris), permission rh-voir. L'objectif par grade se règle dans la fiche du grade
// (page Grades, mêmes routes que les droits d'agenda) : /api/run/quotas, permission « grades ». L'objectif de toute
// l'équipe se règle dans Paramètres → Quota. Logique : entreprise/run.ts. Partie factures : routes/compta.ts.
import { Router } from 'express';
import { prisma } from '../../socle/db.js';
import { auDessusDe, gradeDe } from '../../socle/droits.js';
import { body, permission } from '../../socle/http.js';
import { Refus } from '../rh.js';
import { classementRuns, definirQuotaRun, quotasRun } from '../run.js';
import { tempsServiceSemaine } from '../services.js';
import { traiter } from '../refus.js';
import { jourValide } from '../texte.js';

export const run = Router();

// moiId : la fiche employé reliée au compte connecté (même ID Discord), pour distinguer sa propre carte (« vous »)
// ?semaine=AAAA-MM-JJ : lundi de la semaine consultée (passée ou en cours — jamais future, classementRuns ramène
// alors à la semaine en cours) ; omis ou invalide, c'est la semaine en cours.
// Chaque ligne porte aussi le temps en service de la semaine (services.ts, heures comptées en paie), affiché dans les
// deux tableaux de Quota.
run.get('/api/run', ...permission('rh-voir'), async (req, res) => {
  const semaine = typeof req.query.semaine === 'string' && jourValide(req.query.semaine) ? req.query.semaine : undefined;
  const [classement, moi] = await Promise.all([
    classementRuns(semaine),
    req.compte.discordId ? prisma.employe.findUnique({ where: { discordId: req.compte.discordId }, select: { id: true } }) : null,
  ]);
  const service = await tempsServiceSemaine(classement.debutSemaine);
  const employes = classement.employes.map(e => ({
    ...e, minutesService: service.minutes.get(e.id) ?? 0, servicesATraiter: service.aTraiter.get(e.id) ?? 0, enService: service.enService.has(e.id),
  }));
  const minutesServiceEquipe = employes.reduce((s, e) => s + e.minutesService, 0);
  res.json({ ...classement, employes, minutesServiceEquipe, moiId: moi?.id ?? null });
});

run.get('/api/run/quotas', ...permission('grades'), async (_req, res) => { res.json({ quotas: await quotasRun() }); });
run.put('/api/run/quotas/:grade', ...permission('grades'), traiter(async (req, res) => {
  const grade = String(req.params.grade);
  if (!gradeDe(grade)) throw new Refus('Grade introuvable.', 404);
  // même règle que les droits d'agenda (fiche du grade) : on ne règle que les grades sous le sien
  if (!auDessusDe(req.compte, grade)) throw new Refus('Vous ne gérez que les grades sous le vôtre.', 403);
  const quota = Math.round(Number(body(req).quota));
  if (!Number.isFinite(quota) || quota < 0 || quota > 1_000_000) throw new Refus('L’objectif doit être un nombre entier positif.');
  await definirQuotaRun(grade, quota);
  res.json({ ok: true });
}));
