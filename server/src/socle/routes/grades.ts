// SOCLE — grades et leurs permissions (permission « grades »).
// Hors propriétaire : on ne crée, modifie, ordonne ou supprime que des grades SOUS le sien, et on n'y coche que des
// permissions qu'on détient (droits.ts). Le propriétaire du serveur Discord a toujours tout : personne ne peut s'enfermer dehors.
import { Router, type Request, type Response } from 'express';
import { prisma } from '../db.js';
import { Prisma } from '../../generated/prisma/client.js';
import { body, couleur, permission, text, valide } from '../http.js';
import { rolesDiscord, rolesDiscordConfigures, RolesIndisponibles } from '../roles-discord.js';
import { auDessusDe, chargerGrades, CLES_PERMISSIONS, completerPermissions, gradeDe, gradePublic, peut, peutAccorder, rang, tousLesGrades } from '../droits.js';
import { entreprise } from '../../entreprise/index.js';

export const grades = Router();

// liste des permissions d'une requête : connues, sans doublon
const lirePermissions = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every(p => typeof p === 'string' && CLES_PERMISSIONS.has(p)) ? [...new Set(v as string[])] : null;
// rôle Discord : identifiant numérique, ou vide
const lireRole = (v: unknown): string | null | undefined =>
  v === null || v === '' ? null : typeof v === 'string' && /^\d{5,32}$/.test(v) ? v : undefined;
// Lier un grade à un rôle Discord valide d'office, à leur connexion, les comptes qui portent ce rôle : c'est aussi
// gérer les comptes. Hors propriétaire, il faut donc les deux permissions (« grades » seule ne suffit pas).
const roleRefuse = (moi: Request['compte'], res: Response): boolean => {
  if (peut(moi, 'comptes')) return false;
  res.status(403).json({ error: 'Tu ne peux pas lier ce grade à un rôle Discord : ce lien valide des comptes, il faut donc aussi la permission « Gérer les comptes ».' });
  return true;
};

// conflit d'unicité (clé ou rôle Discord déjà pris) : 409 lisible plutôt qu'une erreur serveur
async function enregistrer(res: Response, action: () => Promise<unknown>): Promise<boolean> {
  try { await action(); }
  catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') { res.status(409).json({ error: 'Clé ou rôle Discord déjà utilisé par un autre grade.' }); return false; }
    throw e;
  }
  await chargerGrades();
  return true;
}
const repondreListe = (res: Response) => res.json(tousLesGrades().map(gradePublic));

grades.get('/api/grades', ...valide, (_req, res) => { repondreListe(res); });

// rôles du serveur Discord, pour les choisir par leur nom (roles-discord.ts) ; sans jeton de bot : configure false
grades.get('/api/grades/roles-discord', ...permission('grades'), async (_req, res) => {
  if (!rolesDiscordConfigures()) { res.json({ configure: false, roles: [] }); return; }
  try { res.json({ configure: true, roles: await rolesDiscord() }); }
  catch (e) {
    if (!(e instanceof RolesIndisponibles)) throw e;
    res.json({ configure: true, roles: [], erreur: `Liste des rôles indisponible. ${e.message} En attendant, saisis l’identifiant du rôle.` });
  }
});

grades.post('/api/grades', ...permission('grades'), async (req: Request, res) => {
  const b = body(req), moi = req.compte;
  const libelle = text(b.libelle, 40);
  const cle = text(b.cle, 20).toLowerCase() || libelle.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
  const perms = lirePermissions(b.permissions ?? []), role = lireRole(b.roleDiscordId ?? null);
  if (!libelle || !/^[a-z0-9-]{1,20}$/.test(cle)) { res.status(400).json({ error: 'Libellé requis (la clé : minuscules, chiffres, tirets).' }); return; }
  if (!perms || role === undefined) { res.status(400).json({ error: 'Permissions ou rôle Discord invalides.' }); return; }
  // complétées par ce qu'elles exigent (ex. cocher « rh-modifier » coche aussi « rh-voir ») avant de vérifier qu'on les détient
  const completes = completerPermissions(perms);
  if (!peutAccorder(moi, completes)) { res.status(403).json({ error: 'Tu ne peux accorder que des permissions que tu détiens.' }); return; }
  if (role && roleRefuse(moi, res)) return;
  // nouveau grade : en bas de la hiérarchie (donc sous celui de son créateur)
  const position = Math.max(-1, ...tousLesGrades().map(g => g.position)) + 1;
  if (await enregistrer(res, () => prisma.grade.create({ data: { cle, libelle, position, couleur: couleur(b.couleur), permissions: completes, roleDiscordId: role } }))) repondreListe(res.status(201));
});

grades.patch('/api/grades/:cle', ...permission('grades'), async (req, res) => {
  const g = gradeDe(String(req.params.cle)), moi = req.compte;
  if (!g) { res.status(404).json({ error: 'Grade introuvable.' }); return; }
  if (!auDessusDe(moi, g.cle)) { res.status(403).json({ error: 'Ce grade est égal ou supérieur au tien.' }); return; }
  const b = body(req), data: Prisma.GradeUpdateInput = {};
  if (b.libelle !== undefined) { const l = text(b.libelle, 40); if (!l) { res.status(400).json({ error: 'Libellé requis.' }); return; } data.libelle = l; }
  if (b.couleur !== undefined) data.couleur = couleur(b.couleur);
  if (b.permissions !== undefined) {
    const perms = lirePermissions(b.permissions);
    if (!perms) { res.status(400).json({ error: 'Permissions invalides.' }); return; }
    // complétées par ce qu'elles exigent, comme à la création
    const completes = completerPermissions(perms);
    // on ne peut ni ajouter ni retirer une permission qu'on n'a pas (sinon un gestionnaire limité retirerait celles des autres).
    // actuelles : filtrées comme permissionsDe() — une clé retirée du code (plus dans CLES_PERMISSIONS) ne compte déjà plus pour
    // personne ; la considérer encore « détenue » par le grade l'aurait rendue impossible à retirer, même pour le propriétaire.
    const actuelles = g.permissions.filter(p => CLES_PERMISSIONS.has(p));
    const changees = [...completes.filter(p => !actuelles.includes(p)), ...actuelles.filter(p => !completes.includes(p))];
    if (!peutAccorder(moi, changees)) { res.status(403).json({ error: 'Tu ne peux changer que des permissions que tu détiens.' }); return; }
    data.permissions = completes;
  }
  if (b.roleDiscordId !== undefined) {
    const role = lireRole(b.roleDiscordId);
    if (role === undefined) { res.status(400).json({ error: 'Rôle Discord invalide (identifiant numérique).' }); return; }
    if (role !== g.roleDiscordId && roleRefuse(moi, res)) return;
    data.roleDiscordId = role;
  }
  if (await enregistrer(res, () => prisma.grade.update({ where: { cle: g.cle }, data }))) repondreListe(res);
});

// nouvel ordre complet (liste de clés, du sommet à la base). Hors propriétaire, les grades jusqu'au sien inclus restent en place.
grades.put('/api/grades/ordre', ...permission('grades'), async (req, res) => {
  const ordre = body(req).ordre, actuels = tousLesGrades().map(g => g.cle), moi = req.compte;
  if (!Array.isArray(ordre) || ordre.length !== actuels.length || !actuels.every(c => ordre.includes(c))) { res.status(400).json({ error: 'L’ordre doit contenir chaque grade une fois.' }); return; }
  if (!moi.proprietaire) {
    const fixes = rang(moi.gradeCle) + 1;
    if (!gradeDe(moi.gradeCle) || actuels.slice(0, fixes).some((c, i) => ordre[i] !== c)) { res.status(403).json({ error: 'Tu ne peux déplacer que des grades inférieurs au tien.' }); return; }
  }
  await prisma.$transaction((ordre as string[]).map((cle, position) => prisma.grade.update({ where: { cle }, data: { position } })));
  await chargerGrades();
  repondreListe(res);
});

grades.delete('/api/grades/:cle', ...permission('grades'), async (req, res) => {
  const g = gradeDe(String(req.params.cle));
  if (!g) { res.status(404).json({ error: 'Grade introuvable.' }); return; }
  if (!auDessusDe(req.compte, g.cle)) { res.status(403).json({ error: 'Ce grade est égal ou supérieur au tien.' }); return; }
  const porteurs = await prisma.compte.count({ where: { gradeCle: g.cle } });
  if (porteurs) { res.status(409).json({ error: `Ce grade est encore porté par ${porteurs} compte(s) : change-leur de grade d’abord.` }); return; }
  try {
    await prisma.$transaction(async tx => {
      await entreprise.avantSuppressionGrade?.(g.cle, tx);
      await tx.grade.delete({ where: { cle: g.cle } });
    });
  } catch (err) {
    // l'entreprise peut refuser la suppression (ex. grade encore porté par une fiche RH active) : son message est fait pour être montré tel quel
    res.status(409).json({ error: err instanceof Error ? err.message : 'Suppression impossible.' });
    return;
  }
  await chargerGrades();
  repondreListe(res);
});
