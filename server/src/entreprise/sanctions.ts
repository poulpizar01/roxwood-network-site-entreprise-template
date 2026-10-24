// ENTREPRISE — sanctions disciplinaires rattachées à une fiche RH (table sanctions). Permission rh-sanctionner (en
// plus de rh-voir, comme les autres droits RH). Une sanction ne se modifie pas : elle se retire si saisie par erreur.
import { prisma } from '../socle/db.js';
import { Refus } from './refus.js';

export const TYPES_SANCTION = ['avertissement_oral', 'avertissement_ecrit', 'mise_a_pied', 'licenciement'] as const;
export type TypeSanction = typeof TYPES_SANCTION[number];

function publique(s: { id: number; type: string; note: string; auteurNom: string; creeLe: Date }) {
  return { id: s.id, type: s.type, note: s.note, auteurNom: s.auteurNom, creeLe: s.creeLe };
}

export async function sanctionsDe(employeId: number) {
  return (await prisma.sanction.findMany({ where: { employeId }, orderBy: { creeLe: 'desc' } })).map(publique);
}

export async function ajouterSanction(employeId: number, type: string, note: unknown, compteId: number, auteurNom: string) {
  if (!TYPES_SANCTION.includes(type as TypeSanction)) throw new Refus('Type de sanction invalide.');
  if (!await prisma.employe.findUnique({ where: { id: employeId }, select: { id: true } })) throw new Refus('Employé introuvable.', 404);
  const data = { employeId, type, note: String(note ?? '').trim().slice(0, 500), compteId, auteurNom: auteurNom.slice(0, 64) };
  return publique(await prisma.sanction.create({ data }));
}

export async function retirerSanction(employeId: number, id: number): Promise<void> {
  const { count } = await prisma.sanction.deleteMany({ where: { id, employeId } });
  if (!count) throw new Refus('Sanction introuvable.', 404);
}
