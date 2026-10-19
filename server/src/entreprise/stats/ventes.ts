// ENTREPRISE — ventes reçues du bot : lecture pour le moteur de calcul, rattachement aux fiches RH, enregistrement
// idempotent, totaux par semaine.
import type { Employe, Vente } from '../../generated/prisma/client.js';
import { prisma } from '../../socle/db.js';
import { Refus } from '../refus.js';
import { analyserCodeSemaine, classifierLignes, lundiDeSemaineISO, normaliserPseudo, semaineISO, type LigneClassee } from './calcul.js';

// ordre des colonnes A à P du Sheet d'origine, lu tel quel par classifierLignes
const COLONNES = ['numeroVente', 'dateVente', 'identite', 'formateur', 'identiteClient', 'numeroTel', 'interieur', 'garage',
  'garageIndispo', 'garageRefus', 'entrepriseIdentite', 'idEntreprise', 'type', 'loc', 'achat', 'semaine'] as const;

export type LigneVente = LigneClassee & { id: number; employeId: number | null; cleAgent: string; cleFormateur: string };

// Toutes les ventes classées par le moteur, avec leur id et leurs clés de regroupement : la fiche RH quand la vente y
// est rattachée (« e:12 »), sinon le texte reçu (« t:pseudo »). pourCalculs : sans les doublons marqués (paie, totaux) —
// l'historique brut, lui, montre tout. semaine : seulement ses ventes (le récapitulatif d'une semaine ne relit pas toute la
// table pour chaque employé).
export async function lireLignes(pourCalculs: boolean, semaine?: string) {
  const ventes = await prisma.vente.findMany({ where: semaine ? { semaine } : {}, orderBy: { id: 'asc' } });
  const { lignes, anomalies } = classifierLignes(ventes.map(v => COLONNES.map(c => v[c])));
  const exclues = pourCalculs ? new Set((await prisma.venteDoublon.findMany({ select: { ligneDoublonId: true } })).map(d => d.ligneDoublonId)) : new Set<number>();
  const completes: LigneVente[] = lignes.map((l, i) => {
    const v = ventes[i];
    return {
      ...l, id: v.id, employeId: v.employeId,
      cleAgent: v.employeId ? `e:${v.employeId}` : `t:${l.identiteNormalisee}`,
      cleFormateur: v.formateurEmployeId ? `e:${v.formateurEmployeId}` : l.formateurNormalise ? `t:${l.formateurNormalise}` : '',
    };
  });
  return { lignes: completes.filter(l => !exclues.has(l.id)), anomalies };
}

// employé désigné par une vente : l'ID Discord fait foi s'il est fourni (un pseudo peut changer), sinon le pseudo de la
// fiche ; jamais le nom
export async function trouverEmploye(discordId: unknown, pseudo: unknown): Promise<Employe | null> {
  const id = String(discordId ?? '').trim();
  if (/^\d{15,22}$/.test(id)) {
    const e = await prisma.employe.findUnique({ where: { discordId: id } });
    if (e) return e;
  }
  const p = normaliserPseudo(pseudo);
  return p ? prisma.employe.findUnique({ where: { discordPseudoNormalise: p } }) : null;
}

// une fiche vient de recevoir (ou de changer) son pseudo Discord : ses ventes encore sans employé lui sont rattachées ;
// une vente déjà rattachée ne change jamais d'employé
export async function rattacherVentes(e: Pick<Employe, 'id' | 'discordPseudoNormalise'>): Promise<void> {
  if (!e.discordPseudoNormalise) return;
  await prisma.vente.updateMany({ where: { employeId: null, identiteNormalisee: e.discordPseudoNormalise }, data: { employeId: e.id } });
  await prisma.vente.updateMany({ where: { formateurEmployeId: null, formateurNormalise: e.discordPseudoNormalise }, data: { formateurEmployeId: e.id } });
}

const texte = (v: unknown) => String(v ?? '').trim();

// vente reçue (bot : compteId null, eventId obligatoire ; site : compte qui la saisit)
export async function enregistrerVente(b: Record<string, unknown>, compteId: number | null): Promise<{ deja: boolean }> {
  if (!texte(b.identite)) throw new Refus('Le vendeur (Identité) est obligatoire.');
  if (b.type !== 'Vente' && b.type !== 'Location') throw new Refus('Le type doit être « Vente » ou « Location ».');
  if (!/^S\d{1,2}-\d{2}$/i.test(texte(b.semaine))) throw new Refus('La semaine doit être au format « S36-26 ».');
  if (b.dateVente && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(texte(b.dateVente))) throw new Refus('La date doit être au format JJ/MM/AAAA.');
  if (b.achat != null && b.achat !== '' && !Number.isFinite(Number(b.achat))) throw new Refus('Le montant (Achat) doit être un nombre.');
  if (b.type === 'Location' && b.loc != null && b.loc !== '' && !Number.isFinite(Number(b.loc))) throw new Refus('La quantité (Loc) doit être un nombre.');
  for (const c of ['numeroVente', 'identite', 'formateur', 'identiteClient', 'numeroTel', 'interieur', 'garage', 'garageIndispo', 'garageRefus', 'entrepriseIdentite', 'idEntreprise']) {
    if (texte(b[c]).length > 200) throw new Refus('Un des champs dépasse 200 caractères.');
  }
  const v = {
    numeroVente: texte(b.numeroVente), dateVente: texte(b.dateVente), identite: texte(b.identite), formateur: texte(b.formateur),
    identiteClient: texte(b.identiteClient), numeroTel: texte(b.numeroTel), interieur: texte(b.interieur), garage: texte(b.garage),
    garageIndispo: texte(b.garageIndispo), garageRefus: texte(b.garageRefus), entrepriseIdentite: texte(b.entrepriseIdentite),
    idEntreprise: texte(b.idEntreprise), type: b.type,
    loc: b.type === 'Location' && b.loc !== '' && b.loc != null ? Math.trunc(Number(b.loc)) : null,
    achat: b.achat != null && b.achat !== '' ? Math.round(Number(b.achat)) : 0,
    semaine: texte(b.semaine).toUpperCase(),
  };
  if (!Number.isSafeInteger(v.achat) || Math.abs(v.achat) > 2_147_483_647 || (v.loc !== null && Math.abs(v.loc) > 2_147_483_647)) throw new Refus('Montant ou quantité hors limites.');

  // Idempotence (bot seulement) : un renvoi après une coupure réseau porte le même eventId. Mêmes données : déjà
  // traité ; données différentes : refus, plutôt que d'écraser ou de doubler une vente.
  let eventId: string | null = null;
  if (compteId === null) {
    eventId = texte(b.eventId);
    if (!eventId) throw new Refus('eventId est obligatoire.');
    if (eventId.length > 200) throw new Refus('eventId dépasse 200 caractères.');
  }
  const identique = (e: Vente) => COLONNES.every(c => e[c] === v[c]);
  if (eventId) {
    const existante = await prisma.vente.findUnique({ where: { eventId } });
    if (existante) { if (identique(existante)) return { deja: true }; throw new Refus('Cet eventId a déjà été utilisé avec des données différentes.', 409); }
  }

  // rattachement à la fiche RH dès l'arrivée ; une vente d'un vendeur inconnu est gardée, sans employé (RH → « À
  // rattacher »). Le bot rapporte des ventes faites en jeu : jamais refusées ; une saisie du site ne vise pas un inactif.
  const [employe, formateur] = await Promise.all([trouverEmploye(b.discordId, v.identite), v.formateur ? trouverEmploye(b.formateurDiscordId, v.formateur) : null]);
  if (compteId !== null && employe && employe.statut !== 'actif') throw new Refus(`${employe.prenom} ${employe.nom} est inactif dans RH : impossible de lui attribuer une nouvelle vente.`, 409);
  try {
    await prisma.vente.create({ data: { ...v, identiteNormalisee: normaliserPseudo(v.identite), formateurNormalise: normaliserPseudo(v.formateur), compteId, eventId, employeId: employe?.id ?? null, formateurEmployeId: formateur?.id ?? null } });
    return { deja: false };
  } catch (e) {
    // deux envois du même eventId au même instant : celui qui perd la course revérifie ce qui a été enregistré
    const concurrente = eventId ? await prisma.vente.findUnique({ where: { eventId } }) : null;
    if (concurrente) { if (identique(concurrente)) return { deja: true }; throw new Refus('Cet eventId a déjà été utilisé avec des données différentes.', 409); }
    throw e;
  }
}

const ordreSemaine = (code: string) => { const a = analyserCodeSemaine(code); return a ? a.anneeIso * 100 + a.numero : -1; };
const bornes = (lundi: Date) => { const dimanche = new Date(lundi); dimanche.setUTCDate(lundi.getUTCDate() + 6); return { debut: lundi.toISOString().slice(0, 10), fin: dimanche.toISOString().slice(0, 10) }; };

// Totaux agence et liste des semaines SANS TROU, de la plus ancienne ayant des données à la semaine en cours (une
// semaine sans vente apparaît à zéro : on peut préparer sa DOT à zéro, et elle ne « disparaît » pas du sélecteur).
// Totaux par semaine comptés par la base, aux mêmes unités que le récapitulatif (stats/calcul.ts : une ligne avec
// intérieur ET garage compte 2 ventes, une location compte sa quantité ; doublons marqués exclus). La table
// des ventes n'est jamais purgée (historique de la paie), la relire en entière à chaque ouverture de Statistiques ou de
// la DOT coûterait un peu plus chaque semaine.
async function totauxParSemaine() {
  const lignes = await prisma.$queryRaw<{ semaine: string; lignes: bigint; ventes: bigint; locations: bigint }[]>`
    SELECT v.semaine, COUNT(*) AS lignes,
      COALESCE(SUM(CASE WHEN v.type = 'Vente' THEN (v.interieur <> '')::int + (v.garage <> '')::int ELSE 0 END), 0) AS ventes,
      COALESCE(SUM(CASE WHEN v.type = 'Location' THEN ((v.interieur <> '')::int + (v.garage <> '')::int) * COALESCE(v.loc, 0) ELSE 0 END), 0) AS locations
    FROM ventes v
    WHERE NOT EXISTS (SELECT 1 FROM ventes_doublons d WHERE d.ligne_doublon_id = v.id)
    GROUP BY v.semaine`;
  return lignes.map(l => ({ semaine: l.semaine, lignes: Number(l.lignes), ventes: Number(l.ventes), locations: Number(l.locations) }));
}

export async function semaines() {
  const parSemaine = new Map<string, { lignes: number; ventes: number; locations: number }>();
  let totalVentes = 0, totalLocations = 0;
  for (const t of await totauxParSemaine()) {
    totalVentes += t.ventes;
    totalLocations += t.locations;
    if (!t.semaine) continue;   // semaine absente : exclue de tous les récapitulatifs
    parSemaine.set(t.semaine, { lignes: t.lignes, ventes: t.ventes, locations: t.locations });
  }
  const liste = [...parSemaine.entries()].map(([code, c]) => {
    const a = analyserCodeSemaine(code);
    return { code, ...(a ? bornes(lundiDeSemaineISO(a.anneeIso, a.numero)) : { debut: null, fin: null }), lignes: c.lignes, ordre: ordreSemaine(code) };
  });
  const recente = [...liste].sort((x, y) => y.ordre - x.ordre)[0] ?? null;
  // semaines manquantes, semaine ISO par semaine ISO (une année compte 52 ou 53 semaines : seul le calendrier le sait)
  const iso = semaineISO(new Date()), ordreCourant = iso.anneeIso * 100 + iso.numero;
  const connus = liste.map(w => w.ordre).filter(o => o > 0);
  const ordreMin = connus.length ? Math.min(...connus, ordreCourant) : ordreCourant;
  const presents = new Set(liste.map(w => w.code));
  const curseur = lundiDeSemaineISO(Math.floor(ordreMin / 100), ordreMin % 100);
  for (let garde = 0; garde < 520; garde++) {
    const w = semaineISO(curseur), ordre = w.anneeIso * 100 + w.numero;
    if (ordre > ordreCourant) break;
    const code = `S${w.numero}-${String(w.anneeIso).slice(-2)}`;
    if (!presents.has(code)) liste.push({ code, ...bornes(new Date(curseur)), lignes: 0, ordre });
    curseur.setUTCDate(curseur.getUTCDate() + 7);
  }
  const c = recente ? parSemaine.get(recente.code)! : { ventes: 0, locations: 0 };
  return {
    semaines: liste.sort((x, y) => y.ordre - x.ordre).map(({ ordre: _o, ...w }) => w),
    totalVentes, totalLocations,
    semaineRecente: recente?.code ?? null, ventesSemaine: c.ventes, locationsSemaine: c.locations,
  };
}
