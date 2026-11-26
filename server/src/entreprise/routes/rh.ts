// ENTREPRISE — routes des ressources humaines (/api/rh/…), page gestion/rh.html. Toutes exigent rh-voir ; chaque
// action vérifie en plus sa propre permission (logique : entreprise/rh.ts).
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Employe } from '../../generated/prisma/client.js';
import { prisma } from '../../socle/db.js';
import { auDessusDe, gradeDe } from '../../socle/droits.js';
import { actualiserGrades } from '../../socle/grades-imposes.js';
import { body, couleur, entier, intParam, permission, text } from '../../socle/http.js';
import { enregistrerImage, recevoirImage, retirerImage } from '../../socle/images.js';
import { peutVoirPiece, peutLireNotes, arriveesBot, changerPieceIdentite, consignerHistorique, droitsRh, ecarter, fichePublique, gradesEmployes, historiqueDe, lignesHistorique, lireChamps, nomComplet, Refus, refusUnicite, reglerBot, supprimerFiche, traiterEnSuspens, trierEmployes, pasSaPropreFiche, verifierDroitsDuCompte, verifierHierarchie, verifierUnicite, type DroitRh } from '../rh.js';
import { reglage } from '../../socle/reglages.js';
import { ajouterSanction, listeTypesSanction, retirerSanction, toutesSanctions } from '../sanctions.js';
import { terminerServiceDe } from '../services.js';
import { traiter } from '../refus.js';
import { jourParis, jourValide, versDate } from '../texte.js';

export const rh = Router();
const voir = permission('rh-voir');

// une permission RH en plus de rh-voir
const exiger = (droit: DroitRh, message: string) => (req: Request, res: Response, next: NextFunction) => {
  if (droitsRh(req.compte).has(droit)) next();
  else res.status(403).json({ error: message });
};
// fiche visée par une route de la page :id : introuvable → 404 ; grade égal ou supérieur, ou sa propre fiche → refus
// (même règle que la modification de la fiche). À appeler avant tout effet de bord.
async function ficheSousMonGrade(req: Request): Promise<Employe> {
  const e = await prisma.employe.findUnique({ where: { id: intParam(req, 'id') } });
  if (!e) throw new Refus('Employé introuvable.', 404);
  verifierHierarchie(req.compte, e);
  return e;
}

rh.get('/api/rh/employes', ...voir, async (req, res) => {
  const droits = droitsRh(req.compte);
  // en service : pour l'action « Terminer son service » directement depuis la liste, sans ouvrir la fiche
  const enService = new Set((await prisma.service.findMany({ where: { fin: null }, select: { employeId: true } })).map(s => s.employeId));
  const employes = trierEmployes((await prisma.employe.findMany()).map(e => ({ ...fichePublique(e, droits), enService: enService.has(e.id) })));
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

// fiche détaillée : identité + compte du site relié (même ID Discord) + service en cours (bouton « Terminer »)
rh.get('/api/rh/employes/:id', ...voir, async (req, res) => {
  const e = await prisma.employe.findUnique({ where: { id: intParam(req, 'id') } });
  if (!e) { res.status(404).json({ error: 'Employé introuvable.' }); return; }
  const [compte, service] = await Promise.all([
    e.discordId ? prisma.compte.findUnique({ where: { discordId: e.discordId }, select: { nom: true, pseudo: true, gradeCle: true, statut: true } }) : null,
    prisma.service.findFirst({ where: { employeId: e.id, fin: null }, select: { debut: true } }),
  ]);
  res.json({
    ...fichePublique(e, droitsRh(req.compte)),
    ...(peutVoirPiece(req.compte, e) && { pieceIdentiteUrl: e.pieceIdentiteUrl, pieceIdentiteUrlMini: e.pieceIdentiteUrlMini }),
    ...(peutLireNotes(req.compte, e) && { notes: e.notes }),
    modifiable: (() => { try { verifierHierarchie(req.compte, e); return true; } catch { return false; } })(),
    compteDuSite: compte ? { nom: compte.nom ?? compte.pseudo, grade: gradeDe(compte.gradeCle)?.libelle ?? null, statut: compte.statut } : null,
    enServiceDepuis: service?.debut ?? null,
  });
});

// historique de la fiche (onglet Activité) : écrit par le serveur, lisible avec rh-voir
rh.get('/api/rh/employes/:id/historique', ...voir, traiter(async (req, res) => {
  const id = intParam(req, 'id');
  const e = await prisma.employe.findUnique({ where: { id } });
  if (!e) throw new Refus('Employé introuvable.', 404);
  // « pièce » et « contact » (téléphone, RIB) ne se lisent qu'avec le droit de voir ces données elles-mêmes
  const droits = droitsRh(req.compte), notes = peutLireNotes(req.compte, e);
  res.json({ historique: (await historiqueDe(id)).filter(h => (h.type !== 'piece' || peutVoirPiece(req.compte, e)) && (h.type !== 'contact' || droits.has('sensible-voir')) && (h.type !== 'notes' || notes)) });
}));

// pièce d'identité : rh-piece, sur une fiche sous son grade ; la fiche est contrôlée avant de traiter l'image
const nomActeur = (req: Request) => req.compte.nom || req.compte.pseudo || 'Compte';
rh.post('/api/rh/employes/:id/piece-identite', ...voir, exiger('piece', 'Vous n’avez pas le droit de gérer les pièces d’identité.'), async (req, res, next) => {
  try { await ficheSousMonGrade(req); next(); } catch (e) { if (e instanceof Refus) res.status(e.status).json({ error: e.message }); else next(e); }
}, ...recevoirImage, traiter(async (req, res) => {
  const image = await enregistrerImage('identites', req.file);
  // échec de l'enregistrement : le fichier tout juste déposé est retiré (jamais un fichier sans trace en base)
  try { await changerPieceIdentite(intParam(req, 'id'), image, nomActeur(req)); }
  catch (e) {
    // retrait impossible (stockage injoignable) : la file de nettoyage le réessaiera, jamais une pièce en ligne sans trace en base
    await retirerImage(image).catch(() => prisma.imageRetiree.create({ data: { cle: image.cle, url: image.url, cleMini: image.cleMini, urlMini: image.urlMini } }).catch(() => {}));
    throw e;
  }
  res.json({ ok: true });
}));

rh.delete('/api/rh/employes/:id/piece-identite', ...voir, exiger('piece', 'Vous n’avez pas le droit de gérer les pièces d’identité.'), traiter(async (req, res) => {
  await changerPieceIdentite((await ficheSousMonGrade(req)).id, null, nomActeur(req));
  res.json({ ok: true });
}));

// terminer le service en cours de cette fiche (bouton RH) : utile quand le bot ne l'a pas annoncé, sans attendre la
// clôture automatique de 16 h
rh.post('/api/rh/employes/:id/service/terminer', ...voir, exiger('modifier', 'Vous n’avez pas le droit de modifier un employé.'), traiter(async (req, res) => {
  await terminerServiceDe((await ficheSousMonGrade(req)).id);
  res.json({ ok: true });
}));

// sanctions : onglet dédié de Ressources humaines, toutes les fiches confondues
rh.get('/api/rh/sanctions', ...permission('rh-sanctions-voir'), async (req, res) => {
  res.json({ sanctions: await toutesSanctions(), types: await listeTypesSanction(), peutSanctionner: droitsRh(req.compte).has('sanctionner') });
});

rh.post('/api/rh/employes/:id/sanctions', ...voir, exiger('sanctionner', 'Vous n’avez pas le droit de gérer les sanctions.'), traiter(async (req, res) => {
  const b = body(req), typeId = entier(b.typeId);
  const { id } = await ficheSousMonGrade(req);
  if (typeId === null) throw new Refus('Type de sanction invalide.');
  const nomActeur = req.compte.nom || req.compte.pseudo;
  const s = await ajouterSanction(id, typeId, b.note, req.compte.id, nomActeur);
  res.status(201).json(s);
}));

rh.delete('/api/rh/employes/:id/sanctions/:sid', ...voir, exiger('sanctionner', 'Vous n’avez pas le droit de gérer les sanctions.'), traiter(async (req, res) => {
  await retirerSanction((await ficheSousMonGrade(req)).id, intParam(req, 'sid'));
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
  if (!droitsRh(req.compte).has('notes-voir')) delete b.notes;
  const champs = lireChamps(b, null);
  verifierHierarchie(req.compte, null, champs.gradeCle);
  pasSaPropreFiche(req.compte, champs.discordId);
  if (champs.gradeCle) await verifierDroitsDuCompte(req.compte, champs.discordId, champs.gradeCle);
  await verifierUnicite(champs);
  const e = await prisma.$transaction(async tx => {
    const f = await tx.employe.create({ data: { statut: 'actif', ...champs } as Parameters<typeof prisma.employe.create>[0]['data'] });
    await consignerHistorique(tx, f.id, nomActeur(req), [{ type: 'creation', texte: 'Fiche créée' }]);
    return f;
  }).catch(refusUnicite);
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
  if (b.notes !== undefined && !peutLireNotes(req.compte, existante)) throw new Refus('Vous n’avez pas accès aux notes de cette fiche.', 403);
  const champs = lireChamps(b, existante);
  verifierHierarchie(req.compte, existante, champs.gradeCle);
  pasSaPropreFiche(req.compte, champs.discordId);
  if (champs.idUnique && champs.idUnique !== existante.idUnique) champs.idProvisoire = false;
  if (!Object.keys(champs).length) throw new Refus('Rien à modifier.');
  const apres = { discordId: champs.discordId !== undefined ? champs.discordId : existante.discordId, gradeCle: champs.gradeCle ?? existante.gradeCle, statut: champs.statut ?? existante.statut };
  if (apres.statut === 'actif') {
    if (existante.statut !== 'actif') gradeExistePourReactivation(apres.gradeCle);   // réactivation par le champ Statut
    await verifierDroitsDuCompte(req.compte, apres.discordId, apres.gradeCle);
  }
  await verifierUnicite(champs, id);
  await prisma.$transaction(async tx => {
    await tx.employe.update({ where: { id }, data: champs });
    await consignerHistorique(tx, id, nomActeur(req), lignesHistorique(existante, champs));
  }).catch(refusUnicite);
  await actualiserGrades([existante.discordId, apres.discordId]);   // l'ancien compte relié perd le grade de la fiche
  res.json({ ok: true });
}));

// départ : statut inactif + date de départ (aujourd'hui si elle n'est pas donnée) ; réactivation : statut actif, date
// de départ effacée. Rien d'autre ne change : l'historique reste rattaché à la fiche.
// une fiche inactive garde la clé de son grade : si ce grade a été supprimé depuis, la réactivation lui rendrait un
// grade qui n'existe plus (aucun droit, paie à zéro)
function gradeExistePourReactivation(gradeCle: string) {
  if (!gradeDe(gradeCle)) throw new Refus('Le grade de cette fiche n’existe plus : choisissez-en un autre avant de la réactiver.');
}

async function changerStatut(req: Request, res: Response, statut: 'actif' | 'inactif') {
  const e: Employe | null = await prisma.employe.findUnique({ where: { id: intParam(req, 'id') } });
  if (!e) throw new Refus('Employé introuvable.', 404);
  verifierHierarchie(req.compte, e);
  if (e.statut === statut) { res.json({ ok: true, inchange: true }); return; }
  let dateDepart: Date | null = null;
  if (statut === 'inactif') {
    const v = String(body(req).dateDepart ?? '') || jourParis();
    if (!jourValide(v)) throw new Refus('La date de départ doit être une date valide (AAAA-MM-JJ).');
    dateDepart = versDate(v);
    if (e.dateArrivee && dateDepart < e.dateArrivee) throw new Refus('La date de départ ne peut pas précéder la date d’arrivée.');
  } else { gradeExistePourReactivation(e.gradeCle); await verifierDroitsDuCompte(req.compte, e.discordId, e.gradeCle); }   // réactiver redonne le grade de la fiche
  await prisma.$transaction(async tx => {
    await tx.employe.update({ where: { id: e.id }, data: { statut, dateDepart } });
    await consignerHistorique(tx, e.id, nomActeur(req), lignesHistorique(e, { statut, dateDepart }));
  });
  await actualiserGrades([e.discordId]);   // départ : le compte retombe sur son rôle Discord
  res.json({ ok: true, employe: nomComplet(e) });
}
rh.post('/api/rh/employes/:id/desactiver', ...voir, exiger('desactiver', 'Vous n’avez pas le droit de désactiver un employé.'), traiter((req, res) => changerStatut(req, res, 'inactif')));
rh.delete('/api/rh/employes/:id', ...voir, exiger('supprimer', 'Vous n’avez pas le droit de supprimer une fiche.'), traiter(async (req, res) => {
  const e = await ficheSousMonGrade(req);
  res.json({ ok: true, employe: await supprimerFiche(e.id) });
}));
rh.post('/api/rh/employes/:id/reactiver', ...voir, exiger('reactiver', 'Vous n’avez pas le droit de réactiver un employé.'), traiter((req, res) => changerStatut(req, res, 'actif')));

// candidatures reçues du bot Discord et réglages de leur lecture
rh.get('/api/rh/bot', ...voir, async (_req, res) => { res.json({ ...(await arriveesBot()), grades: gradesEmployes() }); });
rh.put('/api/rh/bot/reglages', ...voir, exiger('parametrer', 'Vous n’avez pas le droit de régler la réception des candidatures.'), traiter(async (req, res) => {
  await reglerBot(body(req), req.compte);
  res.json({ ok: true });
}));
rh.post('/api/rh/bot/arrivees/:id/traiter', ...voir, exiger('creer', 'Vous n’avez pas le droit d’ajouter un employé.'), traiter(async (req, res) => {
  // la fiche sera créée au grade d'arrivée : comme une création à la main, il doit être sous celui de l'approbateur
  const gradeArrivee = await reglage('rh.grade_arrivee');
  verifierHierarchie(req.compte, null, gradeArrivee);
  // et comme une création à la main : ni sa propre fiche, ni le grade d'un compte supérieur déjà relié à ce Discord
  const arrivee = await prisma.arriveeBot.findUnique({ where: { id: intParam(req, 'id') }, select: { discordId: true } });
  pasSaPropreFiche(req.compte, arrivee?.discordId);
  if (gradeArrivee) await verifierDroitsDuCompte(req.compte, arrivee?.discordId, gradeArrivee);
  const r = await traiterEnSuspens(intParam(req, 'id'));
  res.json({ ok: r.resultat !== 'refusee', ...r });
}));
rh.post('/api/rh/bot/arrivees/:id/ecarter', ...voir, exiger('creer', 'Vous n’avez pas le droit d’ajouter un employé.'), traiter(async (req, res) => {
  await ecarter(intParam(req, 'id'));
  res.json({ ok: true });
}));
