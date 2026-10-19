// ENTREPRISE — routes des ressources humaines (/api/rh/…), page gestion/rh.html. Toutes exigent rh-voir ; chaque
// action vérifie en plus sa propre permission (logique : entreprise/rh.ts).
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Employe } from '../../generated/prisma/client.js';
import { prisma } from '../../socle/db.js';
import { auDessusDe, gradeDe } from '../../socle/droits.js';
import { body, intParam, permission } from '../../socle/http.js';
import { arriveesBot, droitsRh, ecarter, fichePublique, gradesEmployes, lireChamps, nomComplet, Refus, refusUnicite, reglerBot, traiterEnSuspens, trierEmployes, verifierHierarchie, verifierUnicite, type DroitRh } from '../rh.js';
import { reglage } from '../../socle/reglages.js';
import { traiter } from '../refus.js';
import { relireTableur } from '../stats/tableur.js';
import { rattacherVentes } from '../stats/ventes.js';
import { jourValide, versDate } from '../texte.js';

export const rh = Router();
const voir = permission('rh-voir');

// une permission RH en plus de rh-voir
const exiger = (droit: DroitRh, message: string) => (req: Request, res: Response, next: NextFunction) => {
  if (droitsRh(req.compte).has(droit)) next();
  else res.status(403).json({ error: message });
};
// Sa propre fiche se crée et se relie par un supérieur : sinon un agent qui a rh-creer ou rh-modifier choisirait le
// grade de la fiche qui fixe sa paie (verifierHierarchie ne reconnaît « sa » fiche que par son ID Discord).
function pasSaPropreFiche(req: Request, discordId: string | null | undefined) {
  if (!req.compte.proprietaire && discordId && discordId === req.compte.discordId) {
    throw new Refus('Votre propre fiche est créée ou reliée à votre compte Discord par un supérieur.', 403);
  }
}

rh.get('/api/rh/employes', ...voir, async (req, res) => {
  const droits = droitsRh(req.compte);
  const employes = trierEmployes((await prisma.employe.findMany()).map(e => fichePublique(e, droits)));
  const actifs = employes.filter(e => e.statut === 'actif');
  const parGrade = new Map<string, number>();
  for (const e of actifs) parGrade.set(e.grade, (parGrade.get(e.grade) ?? 0) + 1);
  res.json({
    employes,
    effectif: {
      actifs: actifs.length, inactifs: employes.length - actifs.length,
      parGrade: gradesEmployes().filter(g => parGrade.has(g.cle)).map(g => ({ grade: g.libelle, nombre: parGrade.get(g.cle) })),
    },
    grades: gradesEmployes(),
    // grades qu'on peut donner à une fiche : sous le sien (tous pour le propriétaire)
    attribuables: gradesEmployes().map(g => g.cle).filter(cle => req.compte.proprietaire || auDessusDe(req.compte, cle)),
    droits: [...droits],
  });
});

// fiche détaillée : identité + compte du site relié (même ID Discord)
rh.get('/api/rh/employes/:id', ...voir, async (req, res) => {
  const e = await prisma.employe.findUnique({ where: { id: intParam(req, 'id') } });
  if (!e) { res.status(404).json({ error: 'Employé introuvable.' }); return; }
  const [compte, ventes, tableur, semainesArchivees] = await Promise.all([
    e.discordId ? prisma.compte.findUnique({ where: { discordId: e.discordId }, select: { nom: true, pseudo: true, gradeCle: true, statut: true } }) : null,
    prisma.vente.aggregate({ where: { employeId: e.id }, _count: true, _max: { creeLe: true } }),
    prisma.ligneTableur.findFirst({ where: { employeId: e.id }, select: { nbVentes: true, nbLocations: true } }),
    prisma.tableurArchiveLigne.count({ where: { employeId: e.id } }),
  ]);
  res.json({
    ...fichePublique(e, droitsRh(req.compte)),
    modifiable: (() => { try { verifierHierarchie(req.compte, e); return true; } catch { return false; } })(),
    // ce que les autres modules ont rattaché à l'employé (lecture seule)
    historique: {
      ventesEnregistrees: ventes._count, derniereVente: ventes._max.creeLe,
      tableurSemaineEnCours: tableur ? { ventes: tableur.nbVentes, locations: tableur.nbLocations } : null,
      semainesArchivees,
    },
    compteDuSite: compte ? { nom: compte.nom ?? compte.pseudo, grade: gradeDe(compte.gradeCle)?.libelle ?? null, statut: compte.statut } : null,
  });
});

rh.post('/api/rh/employes', ...voir, exiger('creer', 'Vous n’avez pas le droit d’ajouter un employé.'), traiter(async (req, res) => {
  const b = body(req);
  // téléphone et RIB à la création : ignorés sans rh-sensible
  if (!droitsRh(req.compte).has('sensible')) { delete b.telephone; delete b.rib; }
  const champs = lireChamps(b, null);
  verifierHierarchie(req.compte, null, champs.gradeCle);
  pasSaPropreFiche(req, champs.discordId);
  await verifierUnicite(champs);
  const e = await prisma.employe.create({ data: { statut: 'actif', ...champs } as Parameters<typeof prisma.employe.create>[0]['data'] }).catch(refusUnicite);
  await rattacherVentes(e);
  relireTableur();
  res.status(201).json({ id: e.id });
}));

rh.patch('/api/rh/employes/:id', ...voir, exiger('modifier', 'Vous n’avez pas le droit de modifier un employé.'), traiter(async (req, res) => {
  const id = intParam(req, 'id'), droits = droitsRh(req.compte), b = body(req);
  const existante = await prisma.employe.findUnique({ where: { id } });
  if (!existante) throw new Refus('Employé introuvable.', 404);
  // données sensibles : modifiables seulement avec la permission qui permet de les voir
  if ((b.telephone !== undefined || b.rib !== undefined) && !droits.has('sensible')) throw new Refus('Vous n’avez pas accès au téléphone ni au RIB.', 403);
  // le statut change par désactivation / réactivation, avec leurs propres permissions
  if (b.statut !== undefined && b.statut !== existante.statut && !droits.has(b.statut === 'inactif' ? 'desactiver' : 'reactiver')) {
    throw new Refus('Vous n’avez pas le droit de changer le statut de cet employé.', 403);
  }
  const champs = lireChamps(b, existante);
  verifierHierarchie(req.compte, existante, champs.gradeCle);
  pasSaPropreFiche(req, champs.discordId);
  if (champs.idEmploye && champs.idEmploye !== existante.idEmploye) champs.idProvisoire = false;
  if (!Object.keys(champs).length) throw new Refus('Rien à modifier.');
  await verifierUnicite(champs, id);
  await rattacherVentes(await prisma.employe.update({ where: { id }, data: champs }).catch(refusUnicite));
  relireTableur();
  res.json({ ok: true });
}));

// départ : statut inactif + date de départ (aujourd'hui si elle n'est pas donnée) ; réactivation : statut actif, date
// de départ effacée. Rien d'autre ne change : l'historique reste rattaché à la fiche.
async function changerStatut(req: Request, res: Response, statut: 'actif' | 'inactif') {
  const e: Employe | null = await prisma.employe.findUnique({ where: { id: intParam(req, 'id') } });
  if (!e) throw new Refus('Employé introuvable.', 404);
  verifierHierarchie(req.compte, e);
  if (e.statut === statut) { res.json({ ok: true, inchange: true }); return; }
  let dateDepart: Date | null = null;
  if (statut === 'inactif') {
    const v = String(body(req).dateDepart ?? '') || new Date().toISOString().slice(0, 10);
    if (!jourValide(v)) throw new Refus('La date de départ doit être une date valide (AAAA-MM-JJ).');
    dateDepart = versDate(v);
    if (e.dateArrivee && dateDepart < e.dateArrivee) throw new Refus('La date de départ ne peut pas précéder la date d’arrivée.');
  }
  await prisma.employe.update({ where: { id: e.id }, data: { statut, dateDepart } });
  res.json({ ok: true, employe: nomComplet(e) });
}
rh.post('/api/rh/employes/:id/desactiver', ...voir, exiger('desactiver', 'Vous n’avez pas le droit de désactiver un employé.'), traiter((req, res) => changerStatut(req, res, 'inactif')));
rh.post('/api/rh/employes/:id/reactiver', ...voir, exiger('reactiver', 'Vous n’avez pas le droit de réactiver un employé.'), traiter((req, res) => changerStatut(req, res, 'actif')));

// « À rattacher » : ce que les autres modules ont reçu sans fiche correspondante — vendeurs des ventes du bot dont le
// pseudo n'est sur aucune fiche, lignes du tableur dont le nom n'est le « Prénom Nom » d'aucune fiche. RH crée alors la
// fiche (ou complète le pseudo, ou le nom, d'une fiche existante) : elles s'y rattachent d'elles-mêmes.
rh.get('/api/rh/a-rattacher', ...voir, async (_req, res) => {
  const [vendeurs, tableur] = await Promise.all([
    prisma.$queryRaw<{ pseudo: string; ventes: bigint; derniere_semaine: string }[]>`
      SELECT min(btrim(identite)) AS pseudo, count(*) AS ventes, max(semaine) AS derniere_semaine
        FROM ventes WHERE employe_id IS NULL AND identite_normalisee <> ''
       GROUP BY identite_normalisee ORDER BY count(*) DESC`,
    prisma.ligneTableur.findMany({ where: { employeId: null }, orderBy: { ligneSheet: 'asc' } }),
  ]);
  res.json({
    vendeurs: vendeurs.map(v => ({ pseudo: v.pseudo, ventes: Number(v.ventes), derniereSemaine: v.derniere_semaine })),
    tableur: tableur.map(l => ({ nom: l.nomSheet, grade: l.gradeSheet, ventes: l.nbVentes, locations: l.nbLocations })),
  });
});

// candidatures reçues du bot Discord et réglages de leur lecture
rh.get('/api/rh/bot', ...voir, async (_req, res) => { res.json({ ...(await arriveesBot()), grades: gradesEmployes() }); });
rh.put('/api/rh/bot/reglages', ...voir, exiger('parametrer', 'Vous n’avez pas le droit de régler la réception des candidatures.'), traiter(async (req, res) => {
  await reglerBot(body(req), req.compte);
  res.json({ ok: true });
}));
rh.post('/api/rh/bot/arrivees/:id/traiter', ...voir, exiger('creer', 'Vous n’avez pas le droit d’ajouter un employé.'), traiter(async (req, res) => {
  // la fiche sera créée au grade d'arrivée : comme une création à la main, il doit être sous celui de l'approbateur
  verifierHierarchie(req.compte, null, await reglage('rh.grade_arrivee'));
  const r = await traiterEnSuspens(intParam(req, 'id'));
  res.json({ ok: r.resultat !== 'refusee', ...r });
}));
rh.post('/api/rh/bot/arrivees/:id/ecarter', ...voir, exiger('creer', 'Vous n’avez pas le droit d’ajouter un employé.'), traiter(async (req, res) => {
  await ecarter(intParam(req, 'id'));
  res.json({ ok: true });
}));
