// ENTREPRISE — demandes entrantes du site (module « demandes ») : contact et demande de devis, déposées par une personne dont
// l'identité est prouvée par Discord (vérification légère du socle, jamais saisie), suivies dans la gestion, converties en
// contrat client. Permissions « demandes-voir » et « demandes-gerer » (suppose demandes-voir, vérifié par les routes).
import { prisma } from '../socle/db.js';
import { ID_DISCORD } from '../socle/discord.js';
import type { IdentiteVerifiee } from '../socle/routes/discord-leger.js';
import { Refus } from './refus.js';
import { creerSalonDossier } from './salon-dossier.js';

export const TYPES_DEMANDE = ['contact', 'devis'] as const;
export type TypeDemande = typeof TYPES_DEMANDE[number];
export const STATUTS_DEMANDE = ['nouvelle', 'en_cours', 'traitee', 'refusee'] as const;
export type StatutDemande = typeof STATUTS_DEMANDE[number];

// transitions exactes (jamais un statut imposé à la main hors de ce chemin) : une demande refusée peut être rouverte (le refus
// était peut-être une erreur) ; « traitee » n'est atteint que par la conversion en contrat ou « Marquer traitée » (contact).
const TRANSITIONS: Record<StatutDemande, StatutDemande[]> = { nouvelle: ['en_cours', 'refusee'], en_cours: ['traitee', 'refusee'], traitee: [], refusee: ['en_cours'] };
export const statutDemandeValide = (actuel: StatutDemande, nouveau: StatutDemande) => (TRANSITIONS[actuel] ?? []).includes(nouveau);
const LIBELLES: Record<StatutDemande, string> = { nouvelle: 'Nouvelle', en_cours: 'En cours', traitee: 'Traitée', refusee: 'Refusée' };

const texte = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

// ---- lecture des champs (fonction pure, testée) ----
export function lireChampsDemande(b: Record<string, unknown>) {
  if (!TYPES_DEMANDE.includes(b.type as TypeDemande)) throw new Refus('Choisissez un type de demande.');
  const nom = texte(b.nom, 100);
  if (!nom) throw new Refus('Le nom est obligatoire.');
  const message = texte(b.message, 2000);
  if (!message) throw new Refus('Le message est obligatoire.');
  const type = b.type as TypeDemande;
  return {
    type, nom, message,
    entrepriseNom: texte(b.entrepriseNom, 100) || null,
    contactTelephone: texte(b.contactTelephone, 30) || null,
    // service, date et budget n'ont de sens que pour un devis : ignorés pour un simple contact
    prestation: type === 'devis' ? texte(b.prestation, 120) || null : null,
    dateSouhaitee: type === 'devis' ? texte(b.dateSouhaitee, 100) || null : null,
    budget: type === 'devis' ? texte(b.budget, 60) || null : null,
  };
}

// ---- formulaire public : identité Discord exigée (lue du cookie signé par la route, jamais du corps) ----
export async function creerDemande(b: Record<string, unknown>, identite: IdentiteVerifiee | null) {
  if (!identite) throw new Refus('Connectez-vous avec Discord pour envoyer votre demande.', 401);
  const champs = lireChampsDemande(b);
  // une demande ouverte à la fois par personne : la suivante attend que la première soit traitée ou refusée (l'équipe la
  // retrouve dans son salon) ; empêche aussi qu'une même personne ouvre des salons à la chaîne
  if (await prisma.demande.count({ where: { discordId: identite.id, statut: { in: ['nouvelle', 'en_cours'] } } })) {
    throw new Refus('Vous avez déjà une demande en cours de traitement : l’équipe y répond avant que vous puissiez en envoyer une autre.', 409);
  }
  const demande = await prisma.demande.create({ data: { ...champs, discordId: identite.id, pseudoDiscord: identite.pseudo.slice(0, 100) } });
  try {
    const precedente = await prisma.demande.findFirst({ where: { discordId: identite.id, salonDiscordId: { not: null }, id: { not: demande.id } }, orderBy: { creeLe: 'desc' }, select: { salonDiscordId: true } });
    const salonId = await creerSalonDossier('demandes_categorie_discord', `demande-${demande.id}-${demande.nom}`, identite.id, precedente?.salonDiscordId ?? null);
    if (salonId) await prisma.demande.update({ where: { id: demande.id }, data: { salonDiscordId: salonId } });
  } catch (e) { console.error('[demandes] salon Discord', e); }   // la demande existe : le salon se crée à la main (ou plus tard) sinon
  return demande;
}

// ---- gestion ----
// prisEnChargeParId et le contrat n'ont pas de relation Prisma : noms résolus ici
export async function listerDemandes() {
  // celles à traiter, plus les traitées ou refusées de l'année : la liste ne grossit pas sans fin
  const depuis = new Date(Date.now() - 365 * 86_400_000);
  const demandes = await prisma.demande.findMany({ where: { OR: [{ statut: { in: ['nouvelle', 'en_cours'] } }, { creeLe: { gte: depuis } }] }, orderBy: { creeLe: 'desc' }, take: 1000 });
  const comptes = await prisma.compte.findMany({ where: { id: { in: [...new Set(demandes.map(d => d.prisEnChargeParId).filter((id): id is number => id !== null))] } }, select: { id: true, nom: true, pseudo: true } });
  const nomCompte = new Map(comptes.map(c => [c.id, c.nom || c.pseudo]));
  const contrats = await prisma.contrat.findMany({ where: { id: { in: [...new Set(demandes.map(d => d.contratId).filter((id): id is number => id !== null))] } }, select: { id: true, partenaire: true } });
  const partenaire = new Map(contrats.map(c => [c.id, c.partenaire]));
  return demandes.map(({ discordId: _id, ...d }) => ({
    ...d, prisEnChargeParNom: d.prisEnChargeParId === null ? null : nomCompte.get(d.prisEnChargeParId) ?? null,
    contratPartenaire: d.contratId === null ? null : partenaire.get(d.contratId) ?? null,
  }));
}

async function demandeOu404(id: number) {
  const d = await prisma.demande.findUnique({ where: { id } });
  if (!d) throw new Refus('Demande introuvable.', 404);
  return d;
}
const suiviPar = async (id: number | null) => {
  const c = id === null ? null : await prisma.compte.findUnique({ where: { id }, select: { nom: true, pseudo: true } });
  return c ? ` par ${c.nom || c.pseudo}` : '';
};

// changement conditionné à l'état lu (updateMany) : deux personnes qui agissent en même temps ne prennent pas la demande deux fois
export async function changerStatutDemande(id: number, statut: unknown, compteId: number): Promise<void> {
  const demande = await demandeOu404(id);
  const actuel = demande.statut as StatutDemande;
  if (!STATUTS_DEMANDE.includes(statut as StatutDemande)) throw new Refus('Statut invalide.');
  const nouveau = statut as StatutDemande;
  if (actuel === 'en_cours' && nouveau === 'en_cours') throw new Refus(`Déjà prise en charge${await suiviPar(demande.prisEnChargeParId)}. Rechargez la page.`, 409);
  if (!statutDemandeValide(actuel, nouveau)) throw new Refus(`Cette demande est déjà « ${LIBELLES[actuel]} » : rechargez la page.`, 409);
  const { count } = await prisma.demande.updateMany({ where: { id, statut: actuel }, data: { statut: nouveau, ...(nouveau === 'en_cours' ? { prisEnChargeParId: compteId } : {}) } });
  if (!count) throw new Refus('Cette demande vient d’être modifiée par quelqu’un d’autre : rechargez la page.', 409);
}

// « Reprendre le suivi » : une demande en cours suivie par quelqu'un d'autre (absent, parti…) change de responsable
export async function reprendreSuiviDemande(id: number, compteId: number): Promise<void> {
  const demande = await demandeOu404(id);
  if (demande.statut !== 'en_cours') throw new Refus('Seule une demande en cours peut changer de responsable : rechargez la page.', 409);
  if (demande.prisEnChargeParId === compteId) throw new Refus('Vous suivez déjà cette demande.', 409);
  await prisma.demande.update({ where: { id }, data: { prisEnChargeParId: compteId } });
}

export async function modifierNotesDemande(id: number, notes: unknown): Promise<void> {
  await demandeOu404(id);
  await prisma.demande.update({ where: { id }, data: { notes: texte(notes, 2000) } });
}

// salon posé à la main (ou recréé) par-dessus celui ouvert à l'envoi
export async function modifierSalonDemande(id: number, salonDiscordId: unknown): Promise<void> {
  await demandeOu404(id);
  const v = salonDiscordId === null || salonDiscordId === undefined || salonDiscordId === '' ? null : String(salonDiscordId);
  if (v !== null && !ID_DISCORD.test(v)) throw new Refus('Salon Discord invalide.');
  await prisma.demande.update({ where: { id }, data: { salonDiscordId: v } });
}

// « Créer le salon » : secours quand l'ouverture automatique a échoué (bot absent à l'envoi, catégorie réglée depuis)
export async function creerSalonPourDemande(id: number): Promise<string> {
  const d = await demandeOu404(id);
  if (d.salonDiscordId) throw new Refus('Cette demande a déjà un salon.', 409);
  const salon = await creerSalonDossier('demandes_categorie_discord', `demande-${d.id}-${d.nom}`, d.discordId);
  if (!salon) throw new Refus('Le salon n’a pas pu être créé : le bot Discord doit être relié et la catégorie des salons de demandes réglée dans Paramètres → Discord.', 409);
  await prisma.demande.update({ where: { id }, data: { salonDiscordId: salon } });
  return salon;
}

// ---- conversion en contrat client : le salon de la demande devient celui du contrat ; la demande est « traitée » ----
export async function convertirEnContrat(demandeId: number, b: Record<string, unknown>, compteId: number) {
  const demande = await demandeOu404(demandeId);
  // import tardif : contrats.ts remonte jusqu'à index.ts, que les routes de ce module (importées par index.ts) ne peuvent pas attendre
  const { creerContrat } = await import('./contrats.js');
  if (demande.statut !== 'en_cours') throw new Refus('Prenez d’abord la demande en charge : seule une demande en cours se convertit en contrat.', 409);
  const contrat = await creerContrat({ ...b, partenaire: b.partenaire ?? demande.entrepriseNom ?? demande.nom, partie: 'client', salonDiscordId: demande.salonDiscordId }, compteId);
  // conditionné à l'état « en cours » : deux conversions simultanées ne créent pas deux liens (le second contrat resterait seul)
  const { count } = await prisma.demande.updateMany({ where: { id: demandeId, statut: 'en_cours' }, data: { statut: 'traitee', contratId: contrat.id } });
  if (!count) throw new Refus(`Le contrat « ${contrat.partenaire} » a été créé, mais la demande vient d’être modifiée par quelqu’un d’autre : vérifiez-la.`, 409);
  return contrat;
}

export const nombreDemandesNouvelles = () => prisma.demande.count({ where: { statut: 'nouvelle' } });
