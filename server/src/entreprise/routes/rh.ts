// ENTREPRISE — routes des ressources humaines (/api/rh/…), page gestion/rh.html. Toutes exigent rh-voir ; chaque
// action vérifie en plus sa propre permission (logique : entreprise/rh.ts).
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Employe } from '../../generated/prisma/client.js';
import { prisma } from '../../socle/db.js';
import { auDessusDe, gradeDe, peut } from '../../socle/droits.js';
import { actualiserGrades } from '../../socle/grades-imposes.js';
import { body, couleur, entier, intParam, permission, text } from '../../socle/http.js';
import { arriveesBot, droitsRh, ecarter, fichePublique, gradesEmployes, lireChamps, nomComplet, Refus, refusUnicite, reglerBot, traiterEnSuspens, trierEmployes, verifierHierarchie, verifierUnicite, type DroitRh } from '../rh.js';
import { reglage } from '../../socle/reglages.js';
import { ajouterSanction, listeTypesSanction, retirerSanction, toutesSanctions } from '../sanctions.js';
import { traiter } from '../refus.js';
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

// Le grade d'une fiche active est celui du compte sur le site (index.ts, gradesImposes). Donner un autre grade à un
// compte déjà validé, c'est changer ses droits, comme dans Comptes : il faut aussi la permission « comptes ». Un compte
// en attente n'a aucun droit tant qu'il n'est pas validé (dans Comptes, donc par quelqu'un qui l'a).
async function verifierDroitsDuCompte(req: Request, discordId: string | null | undefined, gradeCle: string) {
  if (!discordId || peut(req.compte, 'comptes')) return;
  const c = await prisma.compte.findUnique({ where: { discordId }, select: { statut: true, gradeCle: true } });
  if (c?.statut === 'valide' && c.gradeCle !== gradeCle) {
    throw new Refus('Ce grade change les droits sur le site d’un compte déjà validé : il faut aussi la permission « Gérer les comptes ».', 403);
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
  const compte = e.discordId ? await prisma.compte.findUnique({ where: { discordId: e.discordId }, select: { nom: true, pseudo: true, gradeCle: true, statut: true } }) : null;
  res.json({
    ...fichePublique(e, droitsRh(req.compte)),
    modifiable: (() => { try { verifierHierarchie(req.compte, e); return true; } catch { return false; } })(),
    compteDuSite: compte ? { nom: compte.nom ?? compte.pseudo, grade: gradeDe(compte.gradeCle)?.libelle ?? null, statut: compte.statut } : null,
  });
});

// sanctions : onglet dédié de Ressources humaines, toutes les fiches confondues
rh.get('/api/rh/sanctions', ...voir, async (req, res) => {
  res.json({ sanctions: await toutesSanctions(), types: await listeTypesSanction(), peutSanctionner: droitsRh(req.compte).has('sanctionner') });
});

rh.post('/api/rh/employes/:id/sanctions', ...voir, exiger('sanctionner', 'Vous n’avez pas le droit de gérer les sanctions.'), traiter(async (req, res) => {
  const b = body(req), id = intParam(req, 'id'), typeId = entier(b.typeId);
  if (typeId === null) throw new Refus('Type de sanction invalide.');
  const nomActeur = req.compte.nom || req.compte.pseudo;
  const s = await ajouterSanction(id, typeId, b.note, req.compte.id, nomActeur);
  res.status(201).json(s);
}));

rh.delete('/api/rh/employes/:id/sanctions/:sid', ...voir, exiger('sanctionner', 'Vous n’avez pas le droit de gérer les sanctions.'), traiter(async (req, res) => {
  await retirerSanction(intParam(req, 'id'), intParam(req, 'sid'));
  res.json({ ok: true });
}));

// ---- types de sanction : classement libre (nom, couleur), comme les types d'agenda ----
function lireTypeSanction(b: Record<string, unknown>) {
  const nom = text(b.nom, 40), c = couleur(b.couleur);
  if (!nom) throw new Refus('Donnez un nom au type.');
  if (!c) throw new Refus('Couleur invalide.');
  return { nom, couleur: c };
}
const nomPris = (e: unknown) => (e as { code?: string }).code === 'P2002';

rh.post('/api/rh/types-sanction', ...voir, exiger('sanctionner', 'Vous n’avez pas le droit de gérer les types de sanction.'), traiter(async (req, res) => {
  const t = lireTypeSanction(body(req));
  if (await prisma.typeSanction.count() >= 30) throw new Refus('30 types au plus : regroupez-en avant d’en créer un autre.');
  const position = (await prisma.typeSanction.aggregate({ _max: { position: true } }))._max.position ?? -1;
  try { await prisma.typeSanction.create({ data: { ...t, position: position + 1 } }); }
  catch (e) { if (nomPris(e)) throw new Refus(`Le type « ${t.nom} » existe déjà.`, 409); throw e; }
  res.status(201).json({ types: await listeTypesSanction() });
}));

rh.put('/api/rh/types-sanction/:id', ...voir, exiger('sanctionner', 'Vous n’avez pas le droit de gérer les types de sanction.'), traiter(async (req, res) => {
  const t = lireTypeSanction(body(req));
  try { await prisma.typeSanction.update({ where: { id: intParam(req, 'id') }, data: t }); }
  catch (e) {
    if (nomPris(e)) throw new Refus(`Le type « ${t.nom} » existe déjà.`, 409);
    if ((e as { code?: string }).code === 'P2025') throw new Refus('Type introuvable.', 404);
    throw e;
  }
  res.json({ types: await listeTypesSanction() });
}));

// ses sanctions restent, « sans type » (onDelete: SetNull)
rh.delete('/api/rh/types-sanction/:id', ...voir, exiger('sanctionner', 'Vous n’avez pas le droit de gérer les types de sanction.'), traiter(async (req, res) => {
  await prisma.typeSanction.deleteMany({ where: { id: intParam(req, 'id') } });
  res.json({ types: await listeTypesSanction() });
}));

rh.post('/api/rh/employes', ...voir, exiger('creer', 'Vous n’avez pas le droit d’ajouter un employé.'), traiter(async (req, res) => {
  const b = body(req);
  // téléphone et RIB à la création : ignorés sans rh-sensible
  if (!droitsRh(req.compte).has('sensible')) { delete b.telephone; delete b.rib; }
  const champs = lireChamps(b, null);
  verifierHierarchie(req.compte, null, champs.gradeCle);
  pasSaPropreFiche(req, champs.discordId);
  if (champs.gradeCle) await verifierDroitsDuCompte(req, champs.discordId, champs.gradeCle);
  await verifierUnicite(champs);
  const e = await prisma.employe.create({ data: { statut: 'actif', ...champs } as Parameters<typeof prisma.employe.create>[0]['data'] }).catch(refusUnicite);
  await actualiserGrades([e.discordId]);
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
  if (champs.idUnique && champs.idUnique !== existante.idUnique) champs.idProvisoire = false;
  if (!Object.keys(champs).length) throw new Refus('Rien à modifier.');
  const apres = { discordId: champs.discordId !== undefined ? champs.discordId : existante.discordId, gradeCle: champs.gradeCle ?? existante.gradeCle, statut: champs.statut ?? existante.statut };
  if (apres.statut === 'actif') await verifierDroitsDuCompte(req, apres.discordId, apres.gradeCle);
  await verifierUnicite(champs, id);
  await prisma.employe.update({ where: { id }, data: champs }).catch(refusUnicite);
  await actualiserGrades([existante.discordId, apres.discordId]);   // l'ancien compte relié perd le grade de la fiche
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
  } else await verifierDroitsDuCompte(req, e.discordId, e.gradeCle);   // réactiver redonne le grade de la fiche
  await prisma.employe.update({ where: { id: e.id }, data: { statut, dateDepart } });
  await actualiserGrades([e.discordId]);   // départ : le compte retombe sur son rôle Discord
  res.json({ ok: true, employe: nomComplet(e) });
}
rh.post('/api/rh/employes/:id/desactiver', ...voir, exiger('desactiver', 'Vous n’avez pas le droit de désactiver un employé.'), traiter((req, res) => changerStatut(req, res, 'inactif')));
rh.post('/api/rh/employes/:id/reactiver', ...voir, exiger('reactiver', 'Vous n’avez pas le droit de réactiver un employé.'), traiter((req, res) => changerStatut(req, res, 'actif')));

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
