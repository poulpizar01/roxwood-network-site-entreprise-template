// ENTREPRISE — sanctions disciplinaires rattachées à une fiche RH (table sanctions) ; leurs types (table
// types_sanction) se gèrent comme les types d'agenda (routes/rh.ts). Permission rh-sanctionner (en plus de rh-voir).
// Une sanction ne se modifie pas : elle se retire si saisie par erreur.
import type { Compte, Employe } from '../generated/prisma/client.js';
import { prisma } from '../socle/db.js';
import { auDessusDe } from '../socle/droits.js';
import { droitsRh, nomComplet, verifierHierarchie } from './rh.js';
import { Refus } from './refus.js';

type Type = { id: number; nom: string; couleur: string };
const versType = (t: Type) => ({ id: t.id, nom: t.nom, couleur: t.couleur });
export const listeTypesSanction = async () => (await prisma.typeSanction.findMany({ orderBy: [{ position: 'asc' }, { nom: 'asc' }] })).map(versType);

function publique(s: { id: number; note: string; auteurNom: string; creeLe: Date; type: Type | null }) {
  return { id: s.id, type: s.type ? versType(s.type) : null, note: s.note, auteurNom: s.auteurNom, creeLe: s.creeLe };
}

export async function sanctionsDe(employeId: number) {
  return (await prisma.sanction.findMany({ where: { employeId }, orderBy: { creeLe: 'desc' }, include: { type: true } })).map(publique);
}

// Qui lit les sanctions d'une fiche, en plus de l'intéressé (Mon compte) : avec rh-sanctions-voir, les grades au-dessus
// du sien ; sa propre fiche reste visible. Le propriétaire du site voit tout.
export const peutVoirSanctions = (acteur: Compte, e: Pick<Employe, 'discordId' | 'gradeCle'>): boolean =>
  acteur.proprietaire || (droitsRh(acteur).has('sanctions-voir') && (auDessusDe(acteur, e.gradeCle) || (!!e.discordId && e.discordId === acteur.discordId)));
const retirableSur = (acteur: Compte, e: Employe) => { try { verifierHierarchie(acteur, e); return true; } catch { return false; } };

// page Sanctions : les plus récentes des fiches que ce compte peut voir ; « retirable » selon le droit et la hiérarchie
export async function sanctionsVisibles(acteur: Compte) {
  const employes = new Map((await prisma.employe.findMany()).filter(e => peutVoirSanctions(acteur, e)).map(e => [e.id, e]));
  const lignes = await prisma.sanction.findMany({ where: { employeId: { in: [...employes.keys()] } }, orderBy: { creeLe: 'desc' }, take: 300, include: { type: true } });
  const gerer = droitsRh(acteur).has('sanctionner');
  return lignes.map(s => {
    const e = employes.get(s.employeId)!;
    return { ...publique(s), employeId: s.employeId, employeNom: nomComplet(e), retirable: gerer && retirableSur(acteur, e) };
  });
}

export async function ajouterSanction(employeId: number, typeId: number, note: unknown, compteId: number, auteurNom: string) {
  if (!await prisma.employe.findUnique({ where: { id: employeId }, select: { id: true } })) throw new Refus('Employé introuvable.', 404);
  if (!await prisma.typeSanction.findUnique({ where: { id: typeId }, select: { id: true } })) throw new Refus('Type de sanction invalide.');
  const data = { employeId, typeId, note: String(note ?? '').trim().slice(0, 500), compteId, auteurNom: auteurNom.slice(0, 64) };
  return publique(await prisma.sanction.create({ data, include: { type: true } }));
}

export async function retirerSanction(employeId: number, id: number): Promise<void> {
  const { count } = await prisma.sanction.deleteMany({ where: { id, employeId } });
  if (!count) throw new Refus('Sanction introuvable.', 404);
}
