// ENTREPRISE — sanctions disciplinaires rattachées à une fiche RH (table sanctions) ; leurs types (table
// types_sanction) se gèrent comme les types d'agenda (routes/rh.ts). Permission rh-sanctionner (en plus de rh-voir).
// Une sanction ne se modifie pas : elle se retire si saisie par erreur.
import { prisma } from '../socle/db.js';
import { nomComplet } from './rh.js';
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

// toutes les sanctions, de tous les employés (onglet « Sanctions » de Ressources humaines)
export async function toutesSanctions() {
  const lignes = await prisma.sanction.findMany({ orderBy: { creeLe: 'desc' }, take: 300, include: { type: true } });
  const employes = new Map((await prisma.employe.findMany({ where: { id: { in: [...new Set(lignes.map(l => l.employeId))] } } })).map(e => [e.id, e]));
  return lignes.map(s => {
    const e = employes.get(s.employeId);
    return { ...publique(s), employeId: s.employeId, employeNom: e ? nomComplet(e) : 'Employé supprimé' };
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
