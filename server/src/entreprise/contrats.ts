// ENTREPRISE — contrats passés avec d'autres entreprises du serveur (réparations, soins…) : registre interne, sans
// échange avec leur site (chaque entreprise a sa propre base, pas d'API commune entre sites), et sans lien avec la
// DOT. Permission dédiée « contrats ». Montant par période (journalier, hebdomadaire, mensuel) ; sans date de fin, le
// contrat est reconduit tacitement ; y mettre fin, c'est lui poser une date de fin (incluse) : terminé le lendemain
// (contratTermine, revérifié à chaque lecture, et la tâche quotidienne qui pose le statut). Terminé : liste du client
// figée, absent de la page Bénéficiaires. Calendrier de périodes : contrats-periodes.ts. Facturation d'un contrat
// client : son échéancier (echeanciers.ts), régénéré ici à chaque changement qui touche ses dates (synchroniserEcheancierContrat).
import crypto from 'node:crypto';
import { prisma } from '../socle/db.js';
import { lireBeneficiaires, lireCollage, type Beneficiaire } from './contrats-beneficiaires.js';
import { contratTermine, finPeriodeEnCours, prochaineEcheance, PERIODICITES, type Periodicite } from './contrats-periodes.js';
import { contratAEcheancesFacturees, echeanciersDeContrats, synchroniserEcheancierContrat } from './echeanciers.js';
import { joursAccesContrats } from './parametres.js';
import { Refus } from './refus.js';
import { JOURS_SEMAINE, jourParis, jourSemaineParis, jourValide, versDate, versJour } from './texte.js';

export const STATUTS_CONTRAT = ['actif', 'termine'] as const;

// qui est l'autre partie du contrat (onglets de la page, et classement des types, même vocabulaire) :
// « client » paie l'entreprise, « fournisseur » est payé par elle.
export const PARTIES_CONTRAT = ['client', 'fournisseur'] as const;
export type PartieContrat = typeof PARTIES_CONTRAT[number];

const texte = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const JOURS_FIN_PROCHE = 7;   // « Expire bientôt » et bandeau du client : dernière semaine d'un contrat à durée fixe

type TypeContrat = { id: number; nom: string; couleur: string; partie: string };
const versType = (t: TypeContrat) => ({ id: t.id, nom: t.nom, couleur: t.couleur, partie: t.partie });
export const listeTypesContrat = async () => (await prisma.typeContrat.findMany({ orderBy: [{ position: 'asc' }, { nom: 'asc' }] })).map(versType);

type LigneContrat = { id: number; statut: string; periodicite: string; dateDebut: Date; dateFin: Date | null };
const calendrier = (c: LigneContrat) => ({ dateDebut: versJour(c.dateDebut), dateFin: c.dateFin ? versJour(c.dateFin) : null, periodicite: c.periodicite as Periodicite });
// fin d'un contrat à durée fixe dans les 7 prochains jours (le jour même compris)
const finProche = (dateFin: string | null, aujourdhui: string) =>
  dateFin !== null && dateFin >= aujourdhui && (versDate(dateFin).getTime() - versDate(aujourdhui).getTime()) / 864e5 < JOURS_FIN_PROCHE;

async function lireChamps(b: Record<string, unknown>, existant?: LigneContrat & { verrou: boolean }) {
  const partenaire = texte(b.partenaire, 100);
  if (!partenaire) throw new Refus('Le nom du partenaire est obligatoire.');
  if (!PARTIES_CONTRAT.includes(b.partie as PartieContrat)) throw new Refus('Choisissez un client ou un fournisseur.');
  const partie = b.partie as PartieContrat;
  const montant = Number(b.montant);
  if (!Number.isFinite(montant) || montant <= 0 || montant > 2_147_483_647) throw new Refus('Le montant doit être un nombre positif.');
  if (!PERIODICITES.includes(b.periodicite as Periodicite)) throw new Refus('Choisissez la périodicité : journalier, hebdomadaire ou mensuel.');
  const periodicite = b.periodicite as Periodicite;
  if (!jourValide(b.dateDebut)) throw new Refus('La date de début est invalide (jj/mm/aaaa).');
  const dateDebut = b.dateDebut;
  const dateFin = b.dateFin === null || b.dateFin === undefined || b.dateFin === '' ? null : b.dateFin;
  if (dateFin !== null && !jourValide(dateFin)) throw new Refus('La date de fin est invalide (jj/mm/aaaa).');
  if (dateFin !== null && dateFin < dateDebut) throw new Refus('La date de fin ne peut pas précéder la date de début.');
  // une date de fin trop éloignée (faute de frappe sur l'année) ferait générer des dizaines de milliers d'échéances
  // d'un coup (synchroniserEcheancierContrat, journalier) à chaque modification du contrat
  if (dateFin !== null && (versDate(dateFin).getTime() - versDate(dateDebut).getTime()) / 864e5 > 3660)
    throw new Refus('La date de fin ne peut pas dépasser 10 ans après la date de début.');
  // les échéances déjà facturées se calent sur la date de début et la périodicité : les changer décalerait tout
  if (existant?.verrou && (periodicite !== existant.periodicite || dateDebut !== versJour(existant.dateDebut)))
    throw new Refus('Ce contrat a déjà des factures : sa date de début et sa périodicité ne changent plus. Pour changer de rythme, mettez fin à ce contrat et créez-en un nouveau.', 409);
  const typeIdBrut = b.typeId === null || b.typeId === undefined || b.typeId === '' ? null : Number(b.typeId);
  let typeId: number | null = null;
  if (typeIdBrut !== null && Number.isInteger(typeIdBrut)) {
    const type = await prisma.typeContrat.findUnique({ where: { id: typeIdBrut } });
    if (!type || type.partie !== partie) throw new Refus('Ce type ne correspond pas au client ou fournisseur choisi.');
    typeId = typeIdBrut;
  }
  // date de fin passée : terminé ; date de fin changée (repoussée, retirée) : rouvert ; inchangée : statut gardé (un
  // contrat terminé « maintenant » a pour date de fin aujourd'hui, une simple retouche des notes ne le rouvre pas)
  const memeFin = (existant?.dateFin ? versJour(existant.dateFin) : null) === dateFin;
  const statut = dateFin !== null && dateFin < jourParis() ? 'termine' : existant?.statut === 'termine' && memeFin ? 'termine' : 'actif';
  return {
    partenaire, partie, montant: Math.round(montant), notes: texte(b.notes, 500), typeId, periodicite,
    dateDebut: versDate(dateDebut), dateFin: dateFin === null ? null : versDate(dateFin), statut,
  };
}

// jeton jamais renvoyé en liste (secret d'accès) : seulement accesActif, pour afficher l'état du bouton. Chaque
// contrat porte ses bénéficiaires, son état effectif et, pour un client, son échéancier de facturation.
export async function listerContrats() {
  const lignes = await prisma.contrat.findMany({
    orderBy: [{ creeLe: 'desc' }],
    include: { type: true, beneficiaires: { orderBy: { nom: 'asc' }, select: { nom: true, idUnique: true } } },
  });
  const aujourdhui = jourParis();
  const echeanciers = await echeanciersDeContrats(lignes.filter(c => c.partie === 'client').map(c => c.id));
  return lignes.map(({ jeton, ...c }) => {
    const cal = calendrier(c);
    const termine = contratTermine({ statut: c.statut, dateFin: cal.dateFin }, aujourdhui);
    const e = echeanciers.get(c.id);
    return {
      ...c, ...cal, statut: termine ? 'termine' : 'actif', accesActif: !!jeton,
      finProche: !termine && finProche(cal.dateFin, aujourdhui),
      prochaineEcheance: termine ? null : prochaineEcheance(cal, aujourdhui),
      finPeriodeEnCours: finPeriodeEnCours(cal.dateDebut, cal.periodicite, aujourdhui),
      echeancierId: e?.id ?? null,
      // les 13 dernières échéances (passées et à venir proches), pour l'aperçu de la fiche
      echeances: e?.echeances.slice(-13) ?? [],
      aFacturer: e?.aFacturer ?? null,
    };
  });
}

async function contratOu404(id: number) {
  const c = await prisma.contrat.findUnique({ where: { id } });
  if (!c) throw new Refus('Contrat introuvable.', 404);
  return c;
}

export async function creerContrat(b: Record<string, unknown>, compteId: number) {
  const c = await prisma.contrat.create({ data: { ...await lireChamps(b), compteId } });
  await synchroniserEcheancierContrat(c);
  return c;
}

export async function modifierContrat(id: number, b: Record<string, unknown>): Promise<void> {
  const c = await contratOu404(id);
  const verrou = await contratAEcheancesFacturees(id);
  const c2 = await prisma.contrat.update({ where: { id }, data: await lireChamps(b, { ...c, verrou }) });
  await synchroniserEcheancierContrat(c2);
}

export async function supprimerContrat(id: number): Promise<void> {
  await contratOu404(id);
  await prisma.contrat.delete({ where: { id } });
}

// mettre fin : « fin-periode » pose la date de fin à la fin de la période en cours (le contrat court jusque-là) ;
// « maintenant » le termine aujourd'hui. Reprendre : retire la date de fin, reconduction tacite.
export async function terminerContrat(id: number, quand: unknown): Promise<void> {
  const c = await contratOu404(id);
  const aujourdhui = jourParis(), cal = calendrier(c);
  if (contratTermine({ statut: c.statut, dateFin: cal.dateFin }, aujourdhui)) throw new Refus('Ce contrat est déjà terminé.', 409);
  let c2;
  if (quand === 'maintenant') {
    // un contrat qui n'a pas encore commencé finit à sa date de début (jamais une fin avant le début)
    const fin = aujourdhui < cal.dateDebut ? cal.dateDebut : aujourdhui;
    c2 = await prisma.contrat.update({ where: { id }, data: { statut: 'termine', dateFin: versDate(fin) } });
  } else if (quand === 'fin-periode') {
    c2 = await prisma.contrat.update({ where: { id }, data: { dateFin: versDate(finPeriodeEnCours(cal.dateDebut, cal.periodicite, aujourdhui)) } });
  } else throw new Refus('Choisissez quand le contrat prend fin.');
  await synchroniserEcheancierContrat(c2);   // échéances non facturées au-delà de la nouvelle date de fin : retirées
}

export async function reprendreContrat(id: number): Promise<void> {
  await contratOu404(id);
  const c2 = await prisma.contrat.update({ where: { id }, data: { statut: 'actif', dateFin: null } });
  await synchroniserEcheancierContrat(c2);   // reconduction tacite : échéancier étendu de 12 échéances d'avance
}

// tâche quotidienne : pose le statut des contrats dont la date de fin est passée (les lectures le revérifient déjà)
export async function terminerContratsEchus(): Promise<number> {
  const { count } = await prisma.contrat.updateMany({ where: { statut: 'actif', dateFin: { lt: versDate(jourParis()) } }, data: { statut: 'termine' } });
  return count;
}
export function planifierFinContrats(): void {
  const run = () => terminerContratsEchus().then(n => { if (n) console.log(`[contrats] ${n} contrat(s) terminé(s) à leur date de fin`); })
    .catch(e => console.error('[contrats] fin automatique', e));
  run();
  setInterval(run, 3600e3).unref();   // toutes les heures : le changement de jour est vu dans l'heure
}

// ---- accès client (lien à jeton) : le client remplit lui-même sa liste de bénéficiaires, sans compte ni session —
// seulement sur un contrat client en cours, et seulement les jours réglés dans Paramètres (joursAccesContrats) ----
const jourAutoriseAujourdhui = (): boolean => joursAccesContrats().includes(jourSemaineParis());

// prochain jour (à partir de demain) où la liste s'ouvre, AAAA-MM-JJ ; null si aucun jour n'est réglé ou si le
// contrat sera fini avant
function prochaineOuverture(aujourdhui: string, dateFin: string | null): string | null {
  const jours = joursAccesContrats();
  for (let i = 1; i <= 7; i++) {
    const d = new Date(versDate(aujourdhui).getTime() + i * 864e5);
    const jour = versJour(d);
    if (dateFin !== null && jour > dateFin) return null;
    if (jours.includes(JOURS_SEMAINE[(d.getUTCDay() + 6) % 7])) return jour;
  }
  return null;
}

export async function creerAccesContrat(id: number): Promise<string> {
  const c = await contratOu404(id);
  if (c.partie !== 'client') throw new Refus('Seul un contrat avec un client peut recevoir un accès.');
  if (c.jeton) return c.jeton;   // déjà donné : on renvoie le même lien plutôt que d'en créer un second
  const jeton = crypto.randomBytes(24).toString('hex');
  await prisma.contrat.update({ where: { id }, data: { jeton } });
  return jeton;
}

export async function revoquerAccesContrat(id: number): Promise<void> {
  await prisma.contrat.updateMany({ where: { id }, data: { jeton: null } });
}

async function contratDuJeton(jeton: string) {
  const c = await prisma.contrat.findUnique({ where: { jeton }, include: { type: true } });
  if (!c) throw new Refus('Ce lien d’accès est introuvable ou a été révoqué.', 404);
  const aujourdhui = jourParis(), cal = calendrier(c);
  const termine = contratTermine({ statut: c.statut, dateFin: cal.dateFin }, aujourdhui);
  return { c, cal, aujourdhui, termine, modifiable: !termine && jourAutoriseAujourdhui() };
}

// lu par le client lui-même (sans session) depuis son lien : seules les informations nécessaires à sa page, jamais le
// montant ni les notes
export async function lireAccesContrat(jeton: string) {
  const { c, cal, aujourdhui, termine, modifiable } = await contratDuJeton(jeton);
  const beneficiaires = await prisma.contratBeneficiaire.findMany({ where: { contratId: c.id }, orderBy: { nom: 'asc' }, select: { nom: true, idUnique: true } });
  return {
    partenaire: c.partenaire, type: c.type ? { nom: c.type.nom, couleur: c.type.couleur } : null,
    termine, dateFin: cal.dateFin, finProche: !termine && finProche(cal.dateFin, aujourdhui),
    modifiable, jours: joursAccesContrats(),
    prochaineOuverture: termine || modifiable ? null : prochaineOuverture(aujourdhui, cal.dateFin),
    beneficiaires, majLe: c.beneficiairesMajLe,
  };
}

// aperçu d'un collage (rien n'est enregistré) : seulement quand la liste est modifiable, texte borné
export async function analyserCollageContrat(jeton: string, texteColle: unknown) {
  const { modifiable } = await contratDuJeton(jeton);
  if (!modifiable) throw new Refus('La liste ne peut pas être modifiée aujourd’hui.', 403);
  const t = String(texteColle ?? '');
  if (t.length > 30_000) throw new Refus('Ce collage est trop long : copiez seulement l’onglet des membres.', 413);
  return lireCollage(t);
}

export async function ecrireAccesContrat(jeton: string, beneficiaires: unknown): Promise<void> {
  const { c, termine, modifiable } = await contratDuJeton(jeton);
  if (termine) throw new Refus('Ce contrat est terminé : sa liste n’est plus modifiable.', 403);
  if (!modifiable) throw new Refus('La liste ne peut pas être modifiée aujourd’hui.', 403);
  const r = lireBeneficiaires(beneficiaires);
  if ('refus' in r) throw new Refus(r.refus);
  await remplacerBeneficiaires(c.id, r.liste);
}

async function remplacerBeneficiaires(contratId: number, liste: Beneficiaire[]): Promise<void> {
  await prisma.$transaction([
    prisma.contratBeneficiaire.deleteMany({ where: { contratId } }),
    prisma.contratBeneficiaire.createMany({ data: liste.map(b => ({ contratId, nom: b.nom, idUnique: b.idUnique })) }),
    prisma.contrat.update({ where: { id: contratId }, data: { beneficiairesMajLe: new Date() } }),
  ]);
}

// ---- page Bénéficiaires (permission « contrats-beneficiaires ») : contrats clients en cours et leurs listes,
// rien d'autre (ni montant, ni notes, ni lien d'accès) ----
export async function beneficiairesEnCours() {
  const aujourdhui = jourParis();
  const lignes = await prisma.contrat.findMany({
    where: { partie: 'client', statut: 'actif' },
    orderBy: { partenaire: 'asc' },
    include: { type: true, beneficiaires: { orderBy: { nom: 'asc' }, select: { nom: true, idUnique: true } } },
  });
  return lignes
    .filter(c => !contratTermine({ statut: c.statut, dateFin: c.dateFin ? versJour(c.dateFin) : null }, aujourdhui) && versJour(c.dateDebut) <= aujourdhui)
    .map(c => ({
      id: c.id, partenaire: c.partenaire, type: c.type ? { nom: c.type.nom, couleur: c.type.couleur } : null,
      majLe: c.beneficiairesMajLe, beneficiaires: c.beneficiaires,
    }));
}
