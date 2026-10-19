// ENTREPRISE — Google Sheets de la Direction (« Chiffres du tableur », primes de « Mon profil » et de la DOT).
// Lecture de l'export CSV public de l'onglet (classeur partagé « toute personne disposant
// du lien — lecteur ») : ni compte de service ni clé côté serveur. Colonne D = nom, E = grade, L = ventes, M = locations.
// Les MONTANTS de primes ne sont jamais lus dans le Sheet (colonnes N/O) : recalculés avec les barèmes du site
// (baremes_primes, réglables dans Comptabilité), le seul endroit où changer un montant.
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../socle/db.js';
import { gradeDe, tousLesGrades } from '../../socle/droits.js';
import { sheetRegle } from '../parametres.js';
import { nomComplet } from '../rh.js';
import { normaliserPseudo, normaliserTexte } from '../texte.js';
import { primesSelonGrade, semaineISO, type Palier } from './calcul.js';
// import circulaire avec recap.ts (qui lit lireBaremes ici) : sans effet, seules des fonctions sont échangées
import { remunerations } from './recap.js';

export class TableurNonConfigure extends Error {
  constructor() { super('Synchronisation en attente : réglez le lien du Google Sheets dans Paramètres.'); }
}

// Analyseur CSV minimal mais correct (guillemets, virgules et retours à la ligne dans un champ, "" → ") : suffisant pour
// un export Google Sheets, sans dépendance.
export function analyserCSV(texte: string): string[][] {
  const lignes: string[][] = [];
  let ligne: string[] = [], champ = '', dansGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (dansGuillemets) {
      if (c === '"') { if (texte[i + 1] === '"') { champ += '"'; i++; } else dansGuillemets = false; }
      else champ += c;
    } else if (c === '"') dansGuillemets = true;
    else if (c === ',') { ligne.push(champ); champ = ''; }
    else if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; }
    else if (c !== '\r') champ += c;   // \r : les fins de ligne \r\n sont gérées par le \n qui suit
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}

// sans délai, une lecture bloquée resterait en vol, et les passes suivantes s'empileraient
// taille bornée : un onglet récapitulatif pèse quelques Ko ; au-delà, c'est le mauvais onglet (ou tout un classeur)
const DELAI_MS = 20_000, TAILLE_MAX = 2 * 1024 * 1024;
async function lireCSV(sheet: { id: string; gid: string }): Promise<string[][]> {
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${sheet.id}/export?format=csv&gid=${sheet.gid}`, { signal: AbortSignal.timeout(DELAI_MS) });
  const tropGros = () => new Error('Onglet du Google Sheets trop volumineux : le lien doit viser l’onglet du récapitulatif.');
  if (Number(r.headers.get('content-length') ?? 0) > TAILLE_MAX) throw tropGros();
  // lu par morceaux et abandonné au-delà de la limite (Google n'annonce pas toujours la taille) : jamais tout un
  // classeur en mémoire pour découvrir ensuite qu'il est trop gros
  const morceaux: Uint8Array[] = [];
  let taille = 0;
  for await (const m of (r.body ?? []) as AsyncIterable<Uint8Array>) {
    taille += m.length;
    if (taille > TAILLE_MAX) throw tropGros();
    morceaux.push(m);
  }
  const texte = Buffer.concat(morceaux).toString('utf8');
  // un classeur non partagé renvoie la page de connexion Google (HTML, statut 200 après redirection)
  if (!r.ok || /^\s*<(!doctype|html)/i.test(texte)) throw new Error('Impossible de lire le Google Sheets. Vérifiez que son partage est réglé sur « Tous les utilisateurs disposant du lien — Lecteur ».');
  return analyserCSV(texte);
}

const nombreEntier = (v: unknown) => {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[  \s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

// Lignes d'agents du Sheet : un nom en colonne D et un grade du site en colonne E (libellé, sans casse ni accents). Les
// titres de section et la ligne d'en-tête n'ont pas de grade connu : ignorés.
export function analyserLignesSheet(brutes: string[][], libelles: string[] = tousLesGrades().map(g => g.libelle)) {
  const gradeParLibelle = new Map(libelles.map(l => [normaliserTexte(l), l]));
  return brutes.flatMap((ligne, index) => {
    const nom = String(ligne[3] ?? '').trim();
    const grade = gradeParLibelle.get(normaliserTexte(ligne[4] ?? ''));
    if (!nom || !grade) return [];
    return [{ ligneSheet: index + 2, nom, nomNormalise: normaliserTexte(nom), pseudo: String(ligne[2] ?? '').trim(), grade, nbVentes: nombreEntier(ligne[11]), nbLocations: nombreEntier(ligne[12]) }];
  });
}

// Lignes d'agents écartées faute de grade connu : un nom, un grade écrit, des compteurs (colonnes L et M) numériques ou
// vides — ce qui exclut titres de section et en-têtes. Sans ce signalement, un agent dont le grade est mal écrit (ou un
// grade pas encore créé sur le site) disparaîtrait des primes sans rien dire. Renvoie les grades inconnus et leur nombre.
export function gradesInconnus(brutes: string[][], libelles: string[] = tousLesGrades().map(g => g.libelle)) {
  const connus = new Set(libelles.map(l => normaliserTexte(l)));
  const compteur = (v: unknown) => /^[\s  ]*[\d\s  .,]*$/.test(String(v ?? ''));
  const inconnus = new Map<string, number>();
  for (const ligne of brutes) {
    const nom = String(ligne[3] ?? '').trim(), grade = String(ligne[4] ?? '').trim();
    if (!nom || !grade || connus.has(normaliserTexte(grade)) || !compteur(ligne[11]) || !compteur(ligne[12])) continue;
    inconnus.set(grade, (inconnus.get(grade) ?? 0) + 1);
  }
  return [...inconnus].map(([grade, lignes]) => ({ grade, lignes }));
}

// N° de semaine écrit par la Direction : la case sous l'intitulé « N° de la Semaine » (ou à sa droite). La semaine du
// tableur finit quand la Direction le remet à zéro (lundi vers 11h30) et change ce numéro, pas au calendrier. Sans
// intitulé, le seul code « S41-26 » présent dans l'onglet ; null : aucun, ou plusieurs sans intitulé (ambigu).
const CODE_SEMAINE = /^S\d{1,2}-\d{2}$/i;
export function semaineDuSheet(brutes: string[][]): string | null {
  const code = (v: unknown) => { const t = String(v ?? '').trim(); return CODE_SEMAINE.test(t) ? t.toUpperCase() : null; };
  for (let r = 0; r < brutes.length; r++) {
    for (let c = 0; c < brutes[r].length; c++) {
      const t = normaliserTexte(brutes[r][c]);
      if (!t.startsWith('n') || !t.includes('semaine')) continue;
      for (let k = 1; k <= 4 && r + k < brutes.length; k++) { const v = code(brutes[r + k][c]); if (v) return v; }
      const aDroite = code(brutes[r][c + 1]);
      if (aDroite) return aDroite;
    }
  }
  const tous = new Set(brutes.flat().map(code).filter((v): v is string => !!v));
  return tous.size === 1 ? [...tous][0] : null;
}

// Synchronisation complète : relit tout le Sheet et remplace le contenu de tableur_lignes (s'il a changé). RH fait foi :
// chaque ligne est rattachée à la fiche dont le « Prénom Nom » est EXACTEMENT le nom écrit (sans casse ni accents,
// jamais de ressemblance ; deux fiches au même nom : aucune), sinon à celle dont le pseudo Discord est celui de la
// colonne C. Une ligne sans fiche est signalée dans RH « À rattacher ».
// Compte du site relié (« Mon profil ») : celui de l'employé (même ID Discord que sa fiche, sinon même pseudo
// Discord) ; jamais d'après le nom RP du compte.
// Deux synchronisations ne tournent jamais en même temps : la seconde attend la première.
let enCours: Promise<Awaited<ReturnType<typeof synchroniserUneFois>>> | null = null;
export function synchroniser() {
  enCours ??= synchroniserUneFois().finally(() => { enCours = null; });
  return enCours;
}

async function synchroniserUneFois() {
  const sheet = sheetRegle();
  if (!sheet) throw new TableurNonConfigure();
  const brutes = (await lireCSV(sheet)).slice(1);
  const lignes = analyserLignesSheet(brutes), inconnus = gradesInconnus(brutes), semaine = semaineDuSheet(brutes);
  const etatAvant = await prisma.tableurEtat.findUnique({ where: { id: 1 } });
  // Numéro changé par la Direction : la semaine précédente est figée (son dernier relevé non nul) AVANT que la nouvelle
  // lecture n'écrase ses chiffres. Sans numéro dans le tableur : archivage au calendrier (dimanche 23:59), comme avant ;
  // pas pendant la minute de 23:59 elle-même, la tâche d'archivage s'en charge alors.
  if (semaine) {
    if (etatAvant?.semaine && etatAvant.semaine !== semaine && Array.isArray(etatAvant.instantane)) {
      await figerSemaine(etatAvant.semaine, etatAvant.instantane as unknown as LigneSource[], etatAvant.instantaneDu ?? new Date());
    }
  } else await archiverSiDue({ grace: 60_000 });

  const [employes, comptes] = await Promise.all([
    prisma.employe.findMany({ select: { id: true, prenom: true, nom: true, discordId: true, discordPseudoNormalise: true } }),
    prisma.compte.findMany({ where: { statut: 'valide' }, select: { id: true, discordId: true, pseudo: true } }),
  ]);
  const employeParNom = new Map<string, typeof employes[number] | null>();
  for (const e of employes) {
    const cle = normaliserTexte(`${e.prenom} ${e.nom}`);
    if (cle) employeParNom.set(cle, employeParNom.has(cle) ? null : e);   // homonymes : ambigu, aucune
  }
  // en secours, le pseudo Discord de la colonne C, identique à celui de la fiche (unique en base) : un nom RP écrit
  // autrement dans le tableur (faute de frappe, surnom) n'empêche plus le rattachement
  const employeParPseudo = new Map(employes.filter(e => e.discordPseudoNormalise).map(e => [e.discordPseudoNormalise!, e]));
  const compteParDiscord = new Map(comptes.map(c => [c.discordId, c.id]));
  const compteParPseudo = new Map(comptes.map(c => [normaliserTexte(c.pseudo), c.id]));
  // compte du site relié : par la fiche RH (ID Discord, sinon pseudo Discord), jamais par le nom RP du compte, que
  // chacun change librement (un agent prendrait le nom d'un collègue pour voir ses chiffres et ses primes)
  const compteDe = (e: typeof employes[number] | null | undefined) =>
    !e ? null : e.discordId ? compteParDiscord.get(e.discordId) ?? null : e.discordPseudoNormalise ? compteParPseudo.get(normaliserTexte(e.discordPseudoNormalise)) ?? null : null;

  const donnees = lignes.map(l => {
    const e = employeParNom.get(l.nomNormalise) ?? (l.pseudo ? employeParPseudo.get(normaliserPseudo(l.pseudo)) : null) ?? null;
    return {
      ligneSheet: l.ligneSheet, nomSheet: l.nom, nomNormalise: l.nomNormalise, gradeSheet: l.grade, nbVentes: l.nbVentes, nbLocations: l.nbLocations,
      employeId: e?.id ?? null, compteId: compteDe(e),
    };
  });
  // rien de changé depuis la lecture précédente (le cas le plus courant) : seule la date de lecture avance (l'archivage
  // s'y fie pour savoir de quelle semaine datent les chiffres), sans tout effacer et réécrire
  const empreinte = (d: { ligneSheet: number | null; nomSheet: string; gradeSheet: string; nbVentes: number; nbLocations: number; employeId: number | null; compteId: number | null }) => JSON.stringify([d.ligneSheet, d.nomSheet, d.gradeSheet, d.nbVentes, d.nbLocations, d.employeId, d.compteId]);
  const avant = await prisma.ligneTableur.findMany({ orderBy: { id: 'asc' } });
  if (avant.length === donnees.length && avant.every((a, i) => empreinte(a) === empreinte(donnees[i]))) await prisma.ligneTableur.updateMany({ data: { majLe: new Date() } });
  else await prisma.$transaction([prisma.ligneTableur.deleteMany(), prisma.ligneTableur.createMany({ data: donnees })]);
  const avertissement = inconnus.length
    ? `${inconnus.reduce((n, i) => n + i.lignes, 0)} ligne(s) ignorée(s), grade inconnu du site : ${inconnus.map(i => `« ${i.grade} »`).join(', ')}. Corrigez le grade dans le tableur ou créez-le dans la page Grades.`.slice(0, 500)
    : '';
  // dernier relevé non nul de la semaine : une remise à zéro faite avant le changement de numéro ne l'efface pas
  const nonNul = donnees.some(d => d.nbVentes || d.nbLocations), maintenant = new Date();
  const instantane = !semaine ? { instantane: Prisma.DbNull, instantaneDu: null }
    : nonNul ? { instantane: donnees.map(({ nomNormalise: _n, ...d }) => d), instantaneDu: maintenant }
      : semaine !== etatAvant?.semaine ? { instantane: Prisma.DbNull, instantaneDu: null } : {};
  const etat = { derniereSync: maintenant, statut: 'ok', erreur: '', avertissement, semaine: semaine ?? '', nbLignes: donnees.length, nbApparies: donnees.filter(d => d.compteId !== null).length };
  await prisma.tableurEtat.upsert({ where: { id: 1 }, create: { id: 1, ...etat, ...instantane }, update: { ...etat, ...instantane } });
  const sansFiche = donnees.filter(d => d.employeId === null).length;
  if (sansFiche) console.log(`[tableur] ${sansFiche} ligne(s) du tableur sans fiche RH (voir RH → À rattacher)`);
  return { ...etat, sansFicheRh: sansFiche };
}

// Fiche RH créée ou modifiée (nom, pseudo, ID Discord) : le tableur est relu tout de suite pour la rattacher, plutôt
// qu'à la prochaine passe ; en tâche de fond, la réponse à la page n'attend pas Google.
export const relireTableur = (): void => { if (sheetRegle()) void synchroniserSansErreur(); };

// Pour la synchronisation automatique : jamais d'exception. L'échec est journalisé et enregistré (visible dans la page).
export async function synchroniserSansErreur() {
  try { return await synchroniser(); }
  catch (e) {
    // réglage absent : ce n'est pas une panne, pas la peine de remplir les journaux toutes les 5 minutes
    const nonConfigure = e instanceof TableurNonConfigure;
    const etat = { derniereSync: new Date(), statut: nonConfigure ? 'desactive' : 'erreur', erreur: String((e as Error)?.message ?? e).slice(0, 500), avertissement: '', nbLignes: 0, nbApparies: 0 };
    await prisma.tableurEtat.upsert({ where: { id: 1 }, create: { id: 1, ...etat }, update: etat }).catch(e2 => console.error('[tableur] état non enregistré :', e2));
    if (!nonConfigure) console.error('[tableur] échec de la synchronisation :', e);
    return { ...etat, sansFicheRh: 0 };
  }
}

// ---------- « Chiffres du tableur » : vue actuelle et archives ----------

export const lireBaremes = async () => {
  const b = await prisma.baremePrime.findMany();
  return { ventes: b.filter(x => x.type === 'vente') as Palier[], locations: b.filter(x => x.type === 'location') as Palier[] };
};

const employeResume = (e: { id: number; idEmploye: string; prenom: string; nom: string; discordPseudo: string; gradeCle: string; statut: string } | null | undefined) =>
  e ? { id: e.id, idEmploye: e.idEmploye, nomComplet: nomComplet(e), grade: gradeDe(e.gradeCle)?.libelle ?? e.gradeCle, statut: e.statut } : null;

// ligne du tableur telle qu'enregistrée (table tableur_lignes ou relevé gardé dans tableur_etat.instantane)
type LigneSource = { ligneSheet: number | null; nomSheet: string; gradeSheet: string; nbVentes: number; nbLocations: number; employeId: number | null; compteId: number | null };

// Chiffres actuels : chaque ligne lue, ses primes (barèmes du site), sa fiche RH et le compte relié. Nom et grade
// viennent de RH quand la ligne a sa fiche (RH fait foi). Sert à l'écran ET à l'archive.
export async function lireActuel() {
  const lignes = await prisma.ligneTableur.findMany({ orderBy: { ligneSheet: 'asc' } });
  let lueLe: Date | null = null;
  for (const l of lignes) if (!lueLe || l.majLe > lueLe) lueLe = l.majLe;
  return { lignes: await calculerLignes(lignes), lueLe: lueLe as Date | null };
}

async function calculerLignes(lignes: LigneSource[]) {
  const [baremes, remu] = await Promise.all([lireBaremes(), remunerations()]);
  const [employes, comptes] = await Promise.all([
    prisma.employe.findMany({ where: { id: { in: lignes.map(l => l.employeId).filter((x): x is number => x !== null) } } }),
    prisma.compte.findMany({ where: { id: { in: lignes.map(l => l.compteId).filter((x): x is number => x !== null) } }, select: { id: true, nom: true, pseudo: true } }),
  ]);
  const employeDe = new Map(employes.map(e => [e.id, e])), compteDe = new Map(comptes.map(c => [c.id, c.nom ?? c.pseudo]));
  const gradeParLibelle = new Map(tousLesGrades().map(g => [normaliserTexte(g.libelle), g.cle]));
  return lignes.map(l => {
    const fiche = l.employeId ? employeDe.get(l.employeId) : null;
    // primes selon le grade (interrupteurs de Rémunération) : celui de la fiche RH, sinon celui écrit dans le tableur
    const { primeVente, primeLocations } = primesSelonGrade(remu(fiche?.gradeCle ?? gradeParLibelle.get(normaliserTexte(l.gradeSheet)) ?? null), baremes, l.nbVentes, l.nbLocations);
    const employe = employeResume(fiche);
    return {
      ligneSheet: l.ligneSheet, nom: employe?.nomComplet ?? l.nomSheet, nomTableur: l.nomSheet, grade: employe?.grade ?? l.gradeSheet,
      ventes: l.nbVentes, locations: l.nbLocations, primeVente, primeLocations, primeTotale: primeVente + primeLocations,
      employe, compte: l.compteId ? compteDe.get(l.compteId) ?? null : null,
    };
  });
}

// Fige une semaine du tableur sous son numéro, primes calculées avec les barèmes du moment. Un numéro déjà archivé est
// remplacé : après une faute de frappe corrigée (S14 puis S41), c'est la dernière fin de semaine qui fait foi.
async function figerSemaine(code: string, source: LigneSource[], donneesDu: Date) {
  const lignes = await calculerLignes(source);
  await prisma.$transaction([
    prisma.tableurArchive.deleteMany({ where: { semaine: code } }),
    prisma.tableurArchive.create({
      data: {
        semaine: code, archiveLe: new Date(), donneesDu, enRetard: false,
        lignes: { create: lignes.map(l => ({ ligneSheet: l.ligneSheet, nom: l.nom, grade: l.grade || '', ventes: l.ventes, locations: l.locations, primeVente: l.primeVente, primeLocations: l.primeLocations, compte: l.compte, employeId: l.employe?.id ?? null })) },
      },
    }),
  ]);
  console.log(`[tableur] semaine ${code} archivée (${lignes.length} employé(s), numéro changé dans le tableur)`);
}

// ---------- semaines à l'heure de Paris (lundi 00:00 → dimanche 23:59, été comme hiver) ----------
const FORMAT_PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const JOURS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
function partiesParis(date: Date) {
  const p = Object.fromEntries(FORMAT_PARIS.formatToParts(date).map(x => [x.type, x.value]));
  return { annee: +p.year, mois: +p.month, jour: +p.day, heure: +p.hour, minute: +p.minute, jourSemaine: JOURS[p.weekday] };
}
// instant correspondant à une date et une heure de Paris
function instantParis(annee: number, mois: number, jour: number, heure: number, minute: number) {
  const commeSiUtc = Date.UTC(annee, mois - 1, jour, heure, minute);
  const p = partiesParis(new Date(commeSiUtc));
  return new Date(commeSiUtc - (Date.UTC(p.annee, p.mois - 1, p.jour, p.heure, p.minute) - commeSiUtc));
}
// semaine (heure de Paris) qui contient cet instant : { code: "S41-26", debut: lundi 00:00, fin: dimanche 23:59 }
export function semaineParis(date: Date) {
  const p = partiesParis(date);
  const jourCivil = new Date(Date.UTC(p.annee, p.mois - 1, p.jour));
  const { numero, anneeIso } = semaineISO(jourCivil);
  const decaler = (jours: number) => { const d = new Date(jourCivil); d.setUTCDate(d.getUTCDate() + jours); return d; };
  const lundi = decaler(1 - p.jourSemaine), dimanche = decaler(7 - p.jourSemaine);
  return {
    code: `S${numero}-${String(anneeIso).slice(-2)}`,
    debut: instantParis(lundi.getUTCFullYear(), lundi.getUTCMonth() + 1, lundi.getUTCDate(), 0, 0),
    fin: instantParis(dimanche.getUTCFullYear(), dimanche.getUTCMonth() + 1, dimanche.getUTCDate(), 23, 59),
  };
}
// dernière semaine dont l'heure d'archivage est passée : la semaine en cours à partir du dimanche 23:59, sinon la précédente
export function semaineArchivable(maintenant: Date) {
  const enCours = semaineParis(maintenant);
  return maintenant >= enCours.fin ? enCours : semaineParis(new Date(enCours.debut.getTime() - 60_000));
}

// Fige les chiffres de la semaine écoulée, une seule fois. Seulement des chiffres lus pendant cette semaine-là : sinon
// (premier démarrage en milieu de semaine, synchro désactivée…) rien n'est archivé, plutôt que d'enregistrer les
// chiffres d'une semaine sous le numéro d'une autre. grace : délai minimal après dimanche 23:59 avant d'agir.
export async function archiverSiDue({ maintenant = new Date(), grace = 0 } = {}) {
  const semaine = semaineArchivable(maintenant);
  if (maintenant.getTime() - semaine.fin.getTime() < grace) return { archivee: false, semaine: semaine.code, raison: 'pas encore' };
  if (await prisma.tableurArchive.findUnique({ where: { semaine: semaine.code }, select: { id: true } })) return { archivee: false, semaine: semaine.code, raison: 'déjà archivée' };
  const { lignes, lueLe } = await lireActuel();
  if (!lignes.length || !lueLe) return { archivee: false, semaine: semaine.code, raison: 'tableur jamais lu' };
  if (semaineParis(lueLe).code !== semaine.code) return { archivee: false, semaine: semaine.code, raison: 'chiffres d’une autre semaine' };
  const enRetard = maintenant.getTime() - semaine.fin.getTime() > 5 * 60_000;
  try {
    await prisma.tableurArchive.create({
      data: {
        semaine: semaine.code, archiveLe: maintenant, donneesDu: lueLe, enRetard,
        lignes: { create: lignes.map(l => ({ ligneSheet: l.ligneSheet, nom: l.nom, grade: l.grade || '', ventes: l.ventes, locations: l.locations, primeVente: l.primeVente, primeLocations: l.primeLocations, compte: l.compte, employeId: l.employe?.id ?? null })) },
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return { archivee: false, semaine: semaine.code, raison: 'déjà archivée' };   // archivée entre-temps
    throw e;
  }
  console.log(`[tableur] semaine ${semaine.code} archivée (${lignes.length} employé(s))${enRetard ? ' — en retard' : ''}`);
  return { archivee: true, semaine: semaine.code };
}

// archive d'une semaine, au format de lireActuel ; chiffres, primes et grade figés, nom relu dans la fiche RH
export async function lireArchive(code: string) {
  const a = await prisma.tableurArchive.findUnique({ where: { semaine: code }, include: { lignes: { orderBy: [{ ligneSheet: 'asc' }, { id: 'asc' }] } } });
  if (!a) return null;
  const employes = new Map((await prisma.employe.findMany({ where: { id: { in: a.lignes.map(l => l.employeId).filter((x): x is number => x !== null) } } })).map(e => [e.id, e]));
  return {
    semaine: a.semaine, archiveLe: a.archiveLe, donneesDu: a.donneesDu, enRetard: a.enRetard,
    lignes: a.lignes.map(l => {
      const employe = employeResume(l.employeId ? employes.get(l.employeId) : null);
      return { ligneSheet: l.ligneSheet, nom: employe?.nomComplet ?? l.nom, grade: l.grade, ventes: l.ventes, locations: l.locations, primeVente: l.primeVente, primeLocations: l.primeLocations, primeTotale: l.primeVente + l.primeLocations, employe, compte: l.compte };
    }),
  };
}

// Synchronisation toutes les 5 minutes (une lecture d'environ 5 Ko, rien d'écrit si rien n'a changé) et dès que le
// lien change dans Paramètres. Archivage : quand le n° de semaine du tableur change ; sans ce numéro, au calendrier,
// contrôlé toutes les 30 s (dimanche 23:59 heure de Paris : une dernière lecture puis l'archive ; si le serveur était
// arrêté à cette heure-là, archive au redémarrage).
const lienActuel = () => JSON.stringify(sheetRegle());
export function planifierTableur(): void {
  let lienLu = lienActuel();
  synchroniserSansErreur();
  setInterval(synchroniserSansErreur, 5 * 60_000).unref();
  let derniereArchivee: string | null = null;
  setInterval(async () => {
    try {
      // lien réglé ou changé dans Paramètres : lu aussitôt, sans attendre la prochaine passe
      if (lienActuel() !== lienLu) { lienLu = lienActuel(); await synchroniserSansErreur(); }
      // le tableur porte son numéro de semaine : archivé quand la Direction le change (synchroniserUneFois)
      if ((await prisma.tableurEtat.findUnique({ where: { id: 1 }, select: { semaine: true } }))?.semaine) return;
      const semaine = semaineParis(new Date()), t = Date.now();
      if (t >= semaine.fin.getTime() && t - semaine.fin.getTime() < 60_000 && derniereArchivee !== semaine.code) await synchroniserSansErreur();
      const r = await archiverSiDue();
      if (r.archivee || r.raison === 'déjà archivée') derniereArchivee = r.semaine;
    } catch (e) { console.error('[tableur] échec de l’archivage hebdomadaire :', e); }
  }, 30_000).unref();
}
