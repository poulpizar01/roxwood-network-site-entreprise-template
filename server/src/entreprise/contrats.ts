// ENTREPRISE — contrats passés avec d'autres entreprises du serveur (réparations, soins…) : registre interne, sans
// échange avec leur site (chaque entreprise a sa propre base, pas d'API commune entre sites). Permission dédiée
// « contrats ». Cycle : en négociation → actif → terminé (verse une écriture DOT, recette si on est payé, dépense si
// on paie, pour la semaine en cours — jamais recréée si déjà versée) ou annulé.
import { prisma } from '../socle/db.js';
import { estVerrouillee, refuserSiVerrouillee, semaineCourante, semaineDate } from './dot.js';
import { Refus } from './refus.js';
import { jourParis } from './texte.js';

export const SENS_CONTRAT = ['on_paie', 'on_est_paye'] as const;
export type SensContrat = typeof SENS_CONTRAT[number];
export const STATUTS_CONTRAT = ['negociation', 'actif', 'termine', 'annule'] as const;
export type StatutContrat = typeof STATUTS_CONTRAT[number];

const texte = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

function lireChamps(b: Record<string, unknown>) {
  const partenaire = texte(b.partenaire, 100);
  if (!partenaire) throw new Refus('Le nom du partenaire est obligatoire.');
  const objet = texte(b.objet, 200);
  if (!objet) throw new Refus('L’objet du contrat est obligatoire.');
  if (!SENS_CONTRAT.includes(b.sens as SensContrat)) throw new Refus('Choisissez si on paie ou si on est payé.');
  const montant = Number(b.montant);
  if (!Number.isFinite(montant) || montant <= 0 || montant > 2_147_483_647) throw new Refus('Le montant doit être un nombre positif.');
  return { partenaire, objet, sens: b.sens as SensContrat, montant: Math.round(montant), notes: texte(b.notes, 500) };
}

export const listerContrats = () => prisma.contrat.findMany({ orderBy: [{ statut: 'asc' }, { creeLe: 'desc' }] });

export async function creerContrat(b: Record<string, unknown>, compteId: number) {
  return prisma.contrat.create({ data: { ...lireChamps(b), compteId } });
}

export async function modifierContrat(id: number, b: Record<string, unknown>): Promise<void> {
  const c = await prisma.contrat.findUnique({ where: { id } });
  if (!c) throw new Refus('Contrat introuvable.', 404);
  if (c.statut === 'termine') throw new Refus('Un contrat terminé ne se modifie plus.', 409);
  await prisma.contrat.update({ where: { id }, data: lireChamps(b) });
}

export async function supprimerContrat(id: number): Promise<void> {
  const c = await prisma.contrat.findUnique({ where: { id } });
  if (!c) throw new Refus('Contrat introuvable.', 404);
  if (c.statut === 'termine') throw new Refus('Un contrat terminé ne se supprime plus : son écriture DOT reste la trace.', 409);
  await prisma.contrat.delete({ where: { id } });
}

// passer un contrat à ce statut ; clôturer (« termine ») verse une écriture DOT pour la semaine en cours
export async function changerStatutContrat(id: number, statut: string, compteId: number): Promise<void> {
  if (!STATUTS_CONTRAT.includes(statut as StatutContrat)) throw new Refus('Statut invalide.');
  const c = await prisma.contrat.findUnique({ where: { id } });
  if (!c) throw new Refus('Contrat introuvable.', 404);
  if (c.statut === 'termine' || c.statut === 'annule') throw new Refus('Ce contrat est déjà clos.', 409);
  if (statut !== 'termine') { await prisma.contrat.update({ where: { id }, data: { statut } }); return; }
  if (c.ecritureId) { await prisma.contrat.update({ where: { id }, data: { statut } }); return; }   // déjà versée
  const semaine = semaineCourante();
  refuserSiVerrouillee(await estVerrouillee(semaine));
  const e = await prisma.ecritureDot.create({
    data: {
      type: c.sens === 'on_paie' ? 'depense' : 'recette', semaine: semaineDate(semaine),
      dateEcriture: jourParis().split('-').reverse().join('/'),
      justificatif: `Contrat — ${c.partenaire} : ${c.objet}`.slice(0, 200), montant: c.montant, compteId,
    },
  });
  await prisma.contrat.update({ where: { id }, data: { statut, ecritureId: e.id } });
}
