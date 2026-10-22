// SOCLE — grades et permissions.
// Une permission est une clé ; un grade en porte une liste ; un compte a les permissions de son grade. Le propriétaire
// du serveur Discord les a toutes. Les grades sont peu nombreux et lus à chaque requête : ils restent en mémoire,
// rechargés après chaque modification.
//
// Règle anti-escalade : hors propriétaire, on ne gère que ce qui est SOUS son propre grade (comptes et grades), et on
// n'accorde que des permissions qu'on détient soi-même.
import { prisma } from './db.js';
import type { Compte, Grade } from '../generated/prisma/client.js';
import type { Permission } from './contrat.js';
import { permissions as permissionsEntreprise } from '../entreprise/permissions.js';
import { fail } from './config.js';

export const PERMISSIONS_SOCLE: Permission[] = [
  { cle: 'comptes', domaine: 'Équipe et site', libelle: 'Gérer les comptes', description: 'Valider ou refuser les demandes, attribuer un grade, supprimer un compte (sous son propre grade)' },
  { cle: 'grades', domaine: 'Équipe et site', libelle: 'Gérer les grades', description: 'Créer, ordonner, modifier les grades et leurs permissions (sous son propre grade)' },
  { cle: 'parametres', domaine: 'Équipe et site', libelle: 'Paramétrer le site', description: 'Régler les liens et réglages du site (page Paramètres)' },
];

// permissions de l'entreprise contrôlées au démarrage : une faute de frappe se voit tout de suite, pas à la première requête
for (const p of permissionsEntreprise) {
  if (!/^[a-z0-9-]{2,40}$/.test(p.cle)) fail(`entreprise/permissions.ts : clé de permission invalide « ${p.cle} » (minuscules, chiffres, tirets)`);
}
export const permissions: readonly Permission[] = [...PERMISSIONS_SOCLE, ...permissionsEntreprise];
const cles = permissions.map(p => p.cle);
const doublon = cles.find((c, i) => cles.indexOf(c) !== i);
if (doublon) fail(`entreprise/permissions.ts : permission « ${doublon} » déclarée deux fois (ou réservée au socle)`);
export const CLES_PERMISSIONS = new Set(cles);

let grades: Grade[] = [];   // du sommet à la base

export async function chargerGrades(): Promise<void> {
  grades = await prisma.grade.findMany({ orderBy: [{ position: 'asc' }, { libelle: 'asc' }] });
}
export const tousLesGrades = (): readonly Grade[] => grades;
export const gradeDe = (cle: string | null | undefined): Grade | undefined => grades.find(g => g.cle === cle);
// rang dans la hiérarchie : 0 = sommet ; sans grade = après tous les grades
export const rang = (cle: string | null | undefined): number => {
  const i = grades.findIndex(g => g.cle === cle);
  return i < 0 ? grades.length : i;
};

type Porteur = Pick<Compte, 'gradeCle' | 'proprietaire'>;

// permissions effectives d'un compte (clés inconnues ignorées : une permission retirée du code ne donne plus rien)
export function permissionsDe(c: Porteur): Set<string> {
  if (c.proprietaire) return new Set(CLES_PERMISSIONS);
  return new Set((gradeDe(c.gradeCle)?.permissions ?? []).filter(p => CLES_PERMISSIONS.has(p)));
}
export const peut = (c: Porteur, permission: string): boolean => c.proprietaire || permissionsDe(c).has(permission);

// l'acteur peut-il gérer ce qui porte ce grade (un compte, ou le grade lui-même) ? Strictement sous le sien.
export const auDessusDe = (acteur: Porteur, gradeCle: string | null | undefined): boolean =>
  acteur.proprietaire || (!!gradeDe(acteur.gradeCle) && rang(gradeCle) > rang(acteur.gradeCle));
// l'acteur peut-il accorder ces permissions ? Seulement celles qu'il détient.
export const peutAccorder = (acteur: Porteur, perms: readonly string[]): boolean => {
  const miennes = permissionsDe(acteur);
  return perms.every(p => miennes.has(p));
};

// grade tel qu'exposé aux pages
export const gradePublic = (g: Grade) => ({
  cle: g.cle, libelle: g.libelle, position: g.position, couleur: g.couleur,
  permissions: g.permissions.filter(p => CLES_PERMISSIONS.has(p)), roleDiscordId: g.roleDiscordId,
});
