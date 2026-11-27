// SOCLE — grades et permissions.
// Une permission est une clé ; un grade en porte une liste ; un compte a les permissions de son grade. Un super-admin
// (ID Discord déclaré dans SUPER_ADMIN_DISCORD_IDS, voir config.ts et routes/auth.ts) les a toutes. La permission
// « admin » (Administrateur) les donne toutes aussi, présentes et futures, mais sans lever la hiérarchie. Les grades sont peu
// nombreux et lus à chaque requête : ils restent en mémoire, rechargés après chaque modification.
//
// Règle anti-escalade : hors super-admin, on ne gère que ce qui est SOUS son propre grade (comptes et grades), et on
// n'accorde que des permissions qu'on détient soi-même.
import { prisma } from './db.js';
import type { Compte, Grade } from '../generated/prisma/client.js';
import type { Permission } from './contrat.js';
import { permissions as permissionsEntreprise } from '../entreprise/permissions.js';
import { fail } from './config.js';

export const PERMISSIONS_SOCLE: Permission[] = [
  { cle: 'admin', domaine: 'Équipe et site', libelle: 'Administrateur', description: 'Toutes les permissions, présentes et à venir. La hiérarchie s’applique : on ne gère que les comptes et grades sous le sien', sensible: true },
  { cle: 'comptes', domaine: 'Équipe et site', libelle: 'Gérer les comptes', description: 'Valider ou refuser les demandes, attribuer un grade, supprimer un compte (sous son propre grade)', sensible: true },
  { cle: 'grades', domaine: 'Équipe et site', libelle: 'Gérer les grades', description: 'Créer, ordonner, modifier les grades et leurs permissions (sous son propre grade)', sensible: true },
  { cle: 'parametres', domaine: 'Équipe et site', libelle: 'Paramétrer le site', description: 'Régler les liens et réglages du site (page Paramètres)', sensible: true },
  { cle: 'webhooks', domaine: 'Équipe et site', libelle: 'Gérer les webhooks', description: 'Configurer les abonnements du bot Discord (clés), et consulter les événements reçus pour diagnostiquer un échec', sensible: true },
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

const parCle = new Map(permissions.map(p => [p.cle, p]));
for (const p of permissions) for (const r of p.requiert ?? [])
  if (!parCle.has(r)) fail(`entreprise/permissions.ts : permission « ${p.cle} » exige « ${r} », introuvable`);

// liste de permissions complétée par ce qu'elles exigent (enregistrement d'un grade : cocher une permission coche
// aussi celles qu'elle suppose, même si l'interface a été contournée), en cascade (si « a » exige « b » et « b » exige
// « c », « a » exige aussi « c »). Clés inconnues de la table filtrées. Pure (table en paramètre) : testable sans dépendre
// des permissions de l'entreprise.
export function completerSelon(perms: readonly string[], table: readonly Permission[]): string[] {
  const parClePerm = new Map(table.map(p => [p.cle, p]));
  const dependances = (cle: string): Set<string> => {
    const vues = new Set<string>(), aTraiter = [cle];
    while (aTraiter.length) {
      for (const r of parClePerm.get(aTraiter.pop()!)?.requiert ?? []) if (!vues.has(r)) { vues.add(r); aTraiter.push(r); }
    }
    return vues;
  };
  const s = new Set(perms);
  for (const p of perms) for (const r of dependances(p)) s.add(r);
  return [...s].filter(p => parClePerm.has(p));
}
export const completerPermissions = (perms: readonly string[]): string[] => completerSelon(perms, permissions);

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

// ce que donne une liste de permissions : les clés connues (une permission retirée du code ne donne plus rien), ou
// toutes avec « admin ». Pure (table en paramètre) : testable sans grades en base.
export const effectivesSelon = (perms: readonly string[], toutes: ReadonlySet<string>): Set<string> =>
  new Set(perms.includes('admin') ? toutes : perms.filter(p => toutes.has(p)));
// permissions effectives d'un compte
export function permissionsDe(c: Porteur): Set<string> {
  if (c.proprietaire) return new Set(CLES_PERMISSIONS);
  return effectivesSelon(gradeDe(c.gradeCle)?.permissions ?? [], CLES_PERMISSIONS);
}
export const peut = (c: Porteur, permission: string): boolean => c.proprietaire || permissionsDe(c).has(permission);
// Super-admin ou Administrateur : à employer là où un droit se règle hors des permissions (ex. le tableau de l'agenda).
// Jamais pour passer outre la hiérarchie : seul le super-admin (proprietaire) le fait.
export const estAdmin = (c: Porteur): boolean => peut(c, 'admin');

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
