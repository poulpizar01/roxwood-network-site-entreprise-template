// ENTREPRISE — comptabilité (permission « compta ») : relevé Tablettes collé, écritures et déclaration DOT
// hebdomadaire. La rémunération (salaires, paliers de primes)
// est dans routes/stats.ts.
import { Router } from 'express';
import { prisma } from '../../socle/db.js';
import { gradeDe, tousLesGrades } from '../../socle/droits.js';
import { body, intParam, permission } from '../../socle/http.js';
import { Refus, traiter } from '../refus.js';
import { normaliserTexte } from '../texte.js';
import { analyserCodeSemaine } from '../stats/calcul.js';
import { calculerPaieHoraire, normaliserNom, type GradeHoraire } from '../stats/paie-horaire.js';
import { primesTableur, recapAvecPrimesTableur, remunerations } from '../stats/recap.js';
import { caBrutReleve, estLigneTotal as estTotal, impotDot, indexColonne, minuscules, montantReleve } from '../stats/releve.js';
import { semaineParis } from '../stats/tableur.js';
import { semaines } from '../stats/ventes.js';

export const compta = Router();
const gerer = permission('compta');

// ---------- relevé Tablettes ----------
// Le navigateur découpe le tableau collé en colonnes et en lignes ; le serveur revalide ce résultat (jamais de
// confiance aveugle), garde chaque import, et ne renvoie que le plus récent.
// bornes de chaque élément ; le relevé entier est de toute façon limité à 64 Ko (corps JSON, socle) : la page le vérifie
// avant l'envoi
const MAX_COLONNES = 20, MAX_LIGNES = 500, MAX_CELLULE = 300;

// La ligne récap « TOTAL » collée depuis la tablette saute la case « Rang » (un grade ne se totalise pas), ce qui décale
// le reste de la ligne : on y remet un « - », seulement pour cette ligne et si elle est trop courte. Appliqué à
// l'enregistrement et à la lecture, pour tout relevé enregistré.
function corrigerLigneTotale(colonnes: string[], lignes: string[][]) {
  const iRang = indexColonne(minuscules(colonnes), ['rang', 'grade']);
  if (iRang <= 0 || iRang >= colonnes.length - 1) return lignes;
  return lignes.map(l => (estTotal(l) && l.length < colonnes.length ? [...l.slice(0, iRang), '-', ...l.slice(iRang)] : l));
}

async function dernierReleve() {
  const r = await prisma.importCompta.findFirst({ where: { type: 'tablettes' }, orderBy: [{ importeLe: 'desc' }, { id: 'desc' }] });
  const colonnes = (r?.colonnes as string[] | undefined) ?? [];
  // une réinitialisation enregistre un import sans colonnes : comme « aucun relevé »
  if (!r || !colonnes.length) return null;
  const auteur = r.compteId ? await prisma.compte.findUnique({ where: { id: r.compteId }, select: { nom: true, pseudo: true } }) : null;
  // nom RP (modifiable par chacun) suivi du pseudo Discord (non modifiable sur le site) : on sait qui a importé
  return { colonnes, lignes: corrigerLigneTotale(colonnes, r.lignes as string[][]), importeLe: r.importeLe, importePar: auteur ? (auteur.nom ? `${auteur.nom} (@${auteur.pseudo})` : `@${auteur.pseudo}`) : null };
}
const enregistrerReleve = (colonnes: string[], lignes: string[][], compteId: number) =>
  prisma.importCompta.create({ data: { type: 'tablettes', colonnes, lignes, compteId } });

// Paie à l'heure du relevé (stats/paie-horaire.ts) : taux horaire de chaque grade du site (Rémunération), retrouvé par sa
// clé (fiche RH) comme par son libellé (colonne Rang du relevé), et grade lu dans les fiches RH.
async function paieHoraire(colonnes: string[], lignes: string[][]) {
  const [remu, employes] = await Promise.all([prisma.remunerationGrade.findMany(), prisma.employe.findMany({ select: { prenom: true, nom: true, gradeCle: true } })]);
  const parCle = new Map(remu.map(r => [r.gradeCle, r.tauxHoraire]));
  const taux = new Map<string, GradeHoraire>();
  for (const g of tousLesGrades()) {
    const t: GradeHoraire = { libelle: g.libelle, taux: parCle.get(g.cle) ?? 0 };
    taux.set(g.cle, t);
    taux.set(g.libelle, t);
  }
  return calculerPaieHoraire({ colonnes, lignes, taux, employes: employes.map(e => ({ prenom: e.prenom, nom: e.nom, grade: e.gradeCle })) });
}

compta.get('/api/compta/tablettes', ...gerer, async (_req, res) => {
  const r = await dernierReleve();
  res.json({
    import: r && { colonnes: r.colonnes, lignes: r.lignes, importe_le: r.importeLe, importe_par: r.importePar },
    // CA brut repris par la DOT, calculé ici (même fonction que le résumé) : la ligne TOTAL de la tablette est fausse
    // dès qu'un membre est retiré du relevé
    ca_brut: r ? caBrutReleve(r.colonnes, r.lignes) : null,
    // grades payés à l'heure (stagiaires) : heures de service × taux, ligne par ligne
    paie_horaire: r ? await paieHoraire(r.colonnes, r.lignes) : null,
  });
});

compta.post('/api/compta/tablettes', ...gerer, traiter(async (req, res) => {
  const b = body(req);
  const colonnes = (Array.isArray(b.colonnes) ? b.colonnes : []).map(c => String(c ?? '').trim().slice(0, MAX_CELLULE)).slice(0, MAX_COLONNES).filter(Boolean);
  if (!colonnes.length) throw new Refus('Aucune colonne détectée : la première ligne collée doit contenir les titres des colonnes.');
  const brutes = (Array.isArray(b.lignes) ? b.lignes : []).slice(0, MAX_LIGNES);
  if (!brutes.length) throw new Refus('Aucune ligne de données détectée sous les titres de colonnes.');
  const lignes = corrigerLigneTotale(colonnes, brutes.map(l => (Array.isArray(l) ? l : []).map(c => String(c ?? '').slice(0, MAX_CELLULE))))
    .map(l => colonnes.map((_, i) => l[i] ?? ''));
  await enregistrerReleve(colonnes, lignes, req.compte.id);
  res.json({ ok: true });
}));

// retirer une ligne (un membre) du dernier relevé : nouvel import sans elle ; le nom envoyé sert de garde-fou si le
// relevé a changé entre-temps
compta.delete('/api/compta/tablettes/lignes/:index', ...gerer, traiter(async (req, res) => {
  const r = await dernierReleve();
  if (!r) throw new Refus('Aucun relevé importé.', 404);
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= r.lignes.length) throw new Refus('Ligne introuvable.', 404);
  const nom = body(req).nom;
  if (nom != null && String(r.lignes[index][0] ?? '').trim() !== String(nom).trim()) throw new Refus('Le relevé a changé depuis l’affichage : rechargez la page avant de supprimer.', 409);
  const restantes = r.lignes.filter((_, i) => i !== index);
  await enregistrerReleve(r.colonnes, restantes, req.compte.id);
  res.json({ ok: true, restantes: restantes.length });
}));

// réinitialiser ne supprime rien : un import vide, l'historique reste en base
compta.delete('/api/compta/tablettes', ...gerer, async (req, res) => {
  await enregistrerReleve([], [], req.compte.id);
  res.json({ ok: true });
});

// ---------- écritures de la DOT (dépenses déductibles, retraits) ----------
const TYPES_ECRITURE = ['depense', 'retrait'];

compta.get('/api/compta/dot/ecritures', ...gerer, async (_req, res) => {
  const e = await prisma.ecritureDot.findMany({ orderBy: { id: 'desc' } });
  res.json({ ecritures: e.map(x => ({ id: x.id, type: x.type, date_ecriture: x.dateEcriture, justificatif: x.justificatif, montant: x.montant })) });
});

compta.post('/api/compta/dot/ecritures', ...gerer, traiter(async (req, res) => {
  const b = body(req);
  if (!TYPES_ECRITURE.includes(String(b.type))) throw new Refus('Le type doit être « depense » ou « retrait ».');
  const justificatif = String(b.justificatif ?? '').trim();
  if (!justificatif) throw new Refus('Le justificatif est obligatoire.');
  if (justificatif.length > 200) throw new Refus('Le justificatif est trop long (200 caractères max).');
  const date = String(b.date ?? '').trim();
  if (date && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) throw new Refus('La date doit être au format JJ/MM/AAAA.');
  const montant = Number(b.montant);
  if (b.montant == null || b.montant === '' || !Number.isFinite(montant) || Math.abs(montant) > 2_147_483_647) throw new Refus('Le montant doit être un nombre.');
  // un montant négatif inverserait l'écriture (une dépense augmenterait l'impôt) : on corrige en supprimant la ligne
  if (montant < 0) throw new Refus('Le montant doit être positif : pour annuler une écriture, supprimez-la.');
  const e = await prisma.ecritureDot.create({ data: { type: String(b.type), dateEcriture: date, justificatif, montant: Math.round(montant), compteId: req.compte.id } });
  res.status(201).json({ id: e.id });
}));

compta.delete('/api/compta/dot/ecritures/:id', ...gerer, async (req, res) => {
  const { count } = await prisma.ecritureDot.deleteMany({ where: { id: intParam(req, 'id') } });
  if (!count) { res.status(404).json({ error: 'Écriture introuvable.' }); return; }
  res.json({ ok: true });
});

// réinitialiser UN des deux tableaux (dépenses OU retraits), jamais l'autre
compta.delete('/api/compta/dot/ecritures', ...gerer, traiter(async (req, res) => {
  const type = String(req.query.type ?? '').trim();
  if (!TYPES_ECRITURE.includes(type)) throw new Refus('Le paramètre « type » doit être « depense » ou « retrait ».');
  await prisma.ecritureDot.deleteMany({ where: { type } });
  res.json({ ok: true });
}));

// ---------- déclaration DOT ----------
const ALIAS_NOM = ['nom', 'nom de l\'employé', 'nom du salarié', 'employé', 'employe'];
const ALIAS = { run: ['run', 'runs'], facture: ['facture', 'factures'], vente: ['vente', 'ventes'], rang: ['rang', 'grade', 'poste', 'rôle', 'role'] };
const semaineDemandee = (v: unknown) => String(v ?? '').trim().toUpperCase();
// semaine du tableur en cours : le numéro écrit par la Direction, sinon celle du calendrier
const semaineEnCours = async () => (await prisma.tableurEtat.findUnique({ where: { id: 1 }, select: { semaine: true } }))?.semaine || semaineParis(new Date()).code;

// tableau des salariés « prêt à copier-coller » : RUN / FACTURE / VENTE viennent du relevé Tablettes (retrouvé par nom
// RP), jamais des ventes du bot. Le tableau et le total de la déclaration viennent de ce seul calcul : salaire = fixe
// (si activé) + primes du tableur (si activées) + paie à l'heure ; un interrupteur coupé dans Rémunération ne verse rien.
// Primes : celles de la semaine choisie (archive du tableur), le tableur actuel seulement à défaut, signalé.
// Noms comparés comme la paie à l'heure (sans casse, accents ni tirets) : « Jerome » dans la tablette et « Jérôme »
// dans RH sont la même personne, comptée une fois (sinon son salaire fixe serait déclaré deux fois).
async function salariesDot(semaine: string) {
  const primePour = await primesTableur(semaine);
  const [agents, releve, remu, fiches] = await Promise.all([recapAvecPrimesTableur(semaine, primePour), dernierReleve(), remunerations(), prisma.employe.findMany({ select: { id: true, prenom: true, nom: true, gradeCle: true } })]);
  // paie à l'heure (stagiaires), par nom du relevé : ajoutée au salaire déclaré
  const paieParNom = new Map(releve ? (await paieHoraire(releve.colonnes, releve.lignes)).lignes.map(p => [normaliserNom(p.nom), p.montant]) : []);
  const colonnes = minuscules(releve?.colonnes ?? []);
  const lignes = (releve?.lignes ?? []).filter(l => !estTotal(l));
  const iNom = indexColonne(colonnes, ALIAS_NOM), iRun = indexColonne(colonnes, ALIAS.run), iFacture = indexColonne(colonnes, ALIAS.facture), iVente = indexColonne(colonnes, ALIAS.vente), iRang = indexColonne(colonnes, ALIAS.rang);
  const valeur = (l: string[], i: number) => (i === -1 ? 0 : Math.round(montantReleve(l[i])));
  const utilisees = new Set<string[]>();
  const resultat: Record<string, unknown>[] = agents.map(a => {
    const ligne = iNom === -1 ? undefined : lignes.find(l => { const n = normaliserNom(l[iNom]); return n !== '' && !utilisees.has(l) && (n === normaliserNom(a.identiteRp) || n === normaliserNom(a.identite)); });
    if (ligne) utilisees.add(ligne);
    const run = ligne ? valeur(ligne, iRun) : 0, facture = ligne ? valeur(ligne, iFacture) : 0, vente = ligne ? valeur(ligne, iVente) : 0;
    const paie = ligne ? paieParNom.get(normaliserNom(ligne[iNom])) ?? 0 : 0;
    return {
      employeId: a.employeId, idEmploye: a.idEmploye, statut: a.statut, identite: a.identite, identiteRp: a.identiteRp, grade: a.grade,
      run, facture, vente, caTotalRealise: run + facture + vente, trouveDansTablette: !!ligne,
      salaireFixe: a.salaireVerse, primeTotale: a.primeTotale, paieHoraire: paie, salaireTotal: a.salaireVerse + a.primeTotale + paie,
    };
  });
  // Toute autre personne du relevé est ajoutée : si elle a facturé, elle doit figurer dans la déclaration. Avec une
  // fiche RH (inactive, ou absente du récapitulatif) : son grade et ses primes ; sans fiche, signalée « hors RH » :
  // grade lu dans la colonne Rang, primes de sa ligne du tableur à ce nom.
  if (iNom !== -1) {
    const gradeParLibelle = new Map(tousLesGrades().map(g => [normaliserTexte(g.libelle), g.cle]));
    const ficheParNom = new Map(fiches.map(f => [normaliserNom(`${f.prenom} ${f.nom}`), f]));
    for (const ligne of lignes) {
      if (utilisees.has(ligne)) continue;
      const nom = String(ligne[iNom] ?? '').trim();
      if (!nom) continue;
      const fiche = ficheParNom.get(normaliserNom(nom));
      const rang = iRang !== -1 ? String(ligne[iRang] ?? '').trim() : '';
      const r = remu(fiche ? fiche.gradeCle : gradeParLibelle.get(normaliserTexte(rang).replace(/-/g, ' ')) ?? gradeParLibelle.get(normaliserTexte(rang)));
      const salaireFixe = r.salaireActif ? r.salaireFixe ?? 0 : 0, primeTotale = primePour(fiche?.id ?? null, nom).primeTotale;
      const run = valeur(ligne, iRun), facture = valeur(ligne, iFacture), vente = valeur(ligne, iVente);
      const paie = paieParNom.get(normaliserNom(nom)) ?? 0;
      const grade = fiche ? gradeDe(fiche.gradeCle)?.libelle ?? fiche.gradeCle : rang || '—';
      resultat.push({ employeId: fiche?.id ?? null, identite: nom, identiteRp: nom, grade, run, facture, vente, caTotalRealise: run + facture + vente, trouveDansTablette: true, horsReferentiel: !fiche, salaireFixe, primeTotale, paieHoraire: paie, salaireTotal: salaireFixe + primeTotale + paie });
    }
  }
  // semaine passée sans archive (synchronisation coupée le dimanche soir…) : primes du tableur actuel, peut-être déjà
  // celui de la semaine suivante — à vérifier avant de déclarer
  const avertissementPrimes = primePour.source === 'actuel' && semaine !== await semaineEnCours()
    ? `Aucune archive du tableur pour ${semaine} : les primes sont celles du tableur actuel. Vérifiez-les avant de déclarer.`
    : null;
  return { agents: resultat, tabletteTrouvee: !!releve, avertissementPrimes };
}

compta.get('/api/compta/dot/salaries', ...gerer, traiter(async (req, res) => {
  const semaine = semaineDemandee(req.query.semaine);
  if (!semaine) throw new Refus('Le paramètre « semaine » est obligatoire (ex : S36-26).');
  res.json(await salariesDot(semaine));
}));

// Résumé de la déclaration : CA brut (dernier relevé) − dépenses = bénéfice imposable → tranche du barème → impôts ;
// puis primes de la semaine et retraits. Le relevé utilisé (date, auteur, nombre de lignes) est montré pour que la
// Direction vérifie avant de valider une déclaration réelle.
compta.get('/api/compta/dot/resume', ...gerer, async (req, res) => {
  const semaine = semaineDemandee(req.query.semaine);
  const [releve, ecritures, bareme] = await Promise.all([dernierReleve(), prisma.ecritureDot.findMany(), prisma.baremeImposition.findMany({ orderBy: { seuilMin: 'asc' } })]);
  const ca = releve ? caBrutReleve(releve.colonnes, releve.lignes) : null;
  const depenses = ecritures.filter(e => e.type === 'depense').reduce((s, e) => s + e.montant, 0);
  const retraits = ecritures.filter(e => e.type === 'retrait').reduce((s, e) => s + e.montant, 0);
  const imposable = ca === null ? null : ca - depenses;
  // sous la première tranche ou en perte : 0 $ d'impôt, jamais le taux de la dernière tranche (stats/releve.ts)
  const { tranche, impots } = imposable === null ? { tranche: null, impots: null } : impotDot(imposable, bareme);
  const apresImpots = imposable === null || impots === null ? null : imposable - impots;
  // total des salaires = somme du tableau des salariés (même calcul, paie à l'heure et personnes hors RH comprises)
  const primes = semaine ? (await salariesDot(semaine)).agents.reduce((s, a) => s + Number(a.salaireTotal || 0), 0) : null;
  res.json({
    semaine: semaine || null, caBrut: ca, caBrutTrouve: ca !== null,
    caBrutSource: releve && ca !== null ? { importeLe: releve.importeLe, importePar: releve.importePar, nbLignes: releve.lignes.filter(l => !estTotal(l)).length } : null,
    depenseDeductible: depenses, beneficeImposable: imposable, tauxImposition: tranche ? tranche.taux : imposable === null ? null : 0, montantImpots: impots,
    beneficeApresImpots: apresImpots, montantTotalPrimes: primes,
    beneficeApresPrimes: apresImpots === null || primes === null ? null : apresImpots - primes,
    // « bénéfice net » tel que décrit par la Direction : après impôts, moins les retraits (les primes sont une ligne à part)
    retraits, beneficeNet: apresImpots === null ? null : apresImpots - retraits,
    plafonds: tranche ? { salaireMaxEmploye: tranche.salaireMaxEmploye, salaireMaxPatron: tranche.salaireMaxPatron, primeMaxEmploye: tranche.primeMaxEmploye, primeMaxPatron: tranche.primeMaxPatron } : null,
  });
});

// semaines proposées pour la déclaration (de la plus ancienne ayant des ventes à la semaine en cours, sans trou)
// + les semaines du tableur (archivées et en cours) : numérotées par la Direction, elles peuvent différer du calendrier
compta.get('/api/compta/semaines', ...gerer, async (_req, res) => {
  const [liste, archives, enCours] = await Promise.all([semaines(), prisma.tableurArchive.findMany({ select: { semaine: true } }), semaineEnCours()]);
  const codes = new Set(liste.semaines.map(s => s.code));
  const ajout = [enCours, ...archives.map(a => a.semaine)].filter(c => !codes.has(c) && (codes.add(c), true)).map(code => ({ code, debut: null, fin: null, lignes: 0 }));
  const ordre = (c: string) => { const a = analyserCodeSemaine(c); return a ? a.anneeIso * 100 + a.numero : -1; };
  // jamais au-delà de la semaine en cours du tableur (le calendrier peut avoir une semaine d'avance sur la Direction)
  res.json({ semaines: [...liste.semaines, ...ajout].filter(s => ordre(s.code) <= ordre(enCours)).sort((x, y) => ordre(y.code) - ordre(x.code)) });
});
