// ENTREPRISE — comptabilité (permission « compta » : relevé Tablettes et DOT ; permission « factures » séparée : gestion
// des factures) : relevé Tablettes collé, écritures et résumé DOT hebdomadaire.
import { Router, type Request, type Response } from 'express';
import { prisma } from '../../socle/db.js';
import { auDessusDe, gradeDe, tousLesGrades } from '../../socle/droits.js';
import { body, intParam, permission } from '../../socle/http.js';
import { classementFactures, definirQuotaFacture, quotasFacture } from '../facture.js';
import { calculerPaie, paieGrades } from '../paie.js';
import { Refus, traiter } from '../refus.js';
import { nomComplet } from '../rh.js';
import { calculerPaieHoraire, normaliserNom, type GradeHoraire } from '../stats/paie-horaire.js';
import { caBrutReleve, estLigneTotal as estTotal, impotDot, indexColonne, minuscules, montantReleve } from '../stats/releve.js';
import { debutSemaineParis, jourValide, versDate } from '../texte.js';

export const compta = Router();
const gerer = permission('compta');
const gererFactures = permission('factures');

// ---------- relevé Tablettes ----------
// Le navigateur découpe le tableau collé en colonnes et en lignes ; le serveur revalide ce résultat (jamais de
// confiance aveugle), garde chaque import, et ne renvoie que le plus récent.
// bornes de chaque élément ; le relevé entier est de toute façon limité à 64 Ko (corps JSON, socle) : la page le vérifie
// avant l'envoi
const MAX_COLONNES = 20, MAX_LIGNES = 500, MAX_CELLULE = 300;

// La ligne récap « TOTAL » collée depuis la tablette saute la case « Rang » (un grade ne se totalise pas), ce qui décale
// le reste de la ligne : on y remet un « - », seulement pour cette ligne et si elle est trop courte. Appliqué à
// l'enregistrement et à la lecture, pour tout relevé enregistré.
function corrigerLigneTotale(colonnes: string[], lignes: string[][]) {
  const iRang = indexColonne(minuscules(colonnes), ['rang', 'grade']);
  if (iRang <= 0 || iRang >= colonnes.length - 1) return lignes;
  return lignes.map(l => (estTotal(l) && l.length < colonnes.length ? [...l.slice(0, iRang), '-', ...l.slice(iRang)] : l));
}

async function dernierReleve() {
  const r = await prisma.importCompta.findFirst({ where: { type: 'tablettes' }, orderBy: [{ importeLe: 'desc' }, { id: 'desc' }] });
  const colonnes = (r?.colonnes as string[] | undefined) ?? [];
  // une réinitialisation enregistre un import sans colonnes : comme « aucun relevé »
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
  if (!TYPES_ECRITURE.includes(String(b.type))) throw new Refus('Le type doit être « depense » ou « retrait ».');
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
  if (!TYPES_ECRITURE.includes(type)) throw new Refus('Le paramètre « type » doit être « depense » ou « retrait ».');
  await prisma.ecritureDot.deleteMany({ where: { type } });
  res.json({ ok: true });
}));

// ---------- factures (table factures, source order | monitoring | manuel) ----------
const SOURCES_FACTURE = ['order', 'monitoring', 'manuel'];
const STATUTS_PAYES = ['PAID', 'PAYEE'];   // valeurs de statutPaiement valant « payée », bot ou saisie manuelle

// nom affiché de l'auteur d'une saisie manuelle (même règle que dernierReleve)
async function avecAuteurs<T extends { compteId: number | null }>(lignes: T[]) {
  const ids = [...new Set(lignes.map(l => l.compteId).filter((id): id is number => id != null))];
  const comptes = ids.length ? await prisma.compte.findMany({ where: { id: { in: ids } }, select: { id: true, nom: true, pseudo: true } }) : [];
  const parId = new Map(comptes.map(c => [c.id, c.nom ? `${c.nom} (@${c.pseudo})` : `@${c.pseudo}`]));
  return lignes.map(l => ({ ...l, saisiePar: l.compteId != null ? parId.get(l.compteId) ?? null : null }));
}

compta.get('/api/compta/factures', ...gererFactures, async (req, res) => {
  const source = String(req.query.source ?? '');
  const factures = await prisma.facture.findMany({
    where: SOURCES_FACTURE.includes(source) ? { source } : undefined,
    orderBy: { dateFacture: 'desc' },
    take: 300,
  });
  res.json({ factures: await avecAuteurs(factures) });
});

// quota hebdomadaire de montant facturé par grade : réglé dans la fiche du grade (page Grades), mêmes routes que
// l'objectif de run (server/src/entreprise/routes/run.ts). Déclarées avant /:id pour ne pas être avalées par elle.
// Consultation : page Quota (gestion/quota.html, onglets Quota facture et Classements), permission rh-voir comme Run.
compta.get('/api/compta/factures/classement', ...permission('rh-voir'), async (req, res) => {
  const semaine = typeof req.query.semaine === 'string' && jourValide(req.query.semaine) ? req.query.semaine : undefined;
  res.json(await classementFactures(semaine));
});
compta.get('/api/compta/factures/quotas', ...permission('grades'), async (_req, res) => { res.json({ quotas: await quotasFacture() }); });
compta.put('/api/compta/factures/quotas/:grade', ...permission('grades'), traiter(async (req, res) => {
  const grade = String(req.params.grade);
  if (!gradeDe(grade)) throw new Refus('Grade introuvable.', 404);
  if (!auDessusDe(req.compte, grade)) throw new Refus('Vous ne gérez que les grades sous le vôtre.', 403);
  const quota = Math.round(Number(body(req).quota));
  if (!Number.isFinite(quota) || quota < 0 || quota > 1_000_000) throw new Refus('Le quota doit être un nombre entier positif.');
  await definirQuotaFacture(grade, quota);
  res.json({ ok: true });
}));

compta.get('/api/compta/factures/:id', ...gererFactures, async (req, res) => {
  const f = await prisma.facture.findUnique({ where: { id: intParam(req, 'id') } });
  if (!f) { res.status(404).json({ error: 'Facture introuvable.' }); return; }
  const avoir = await prisma.facture.findFirst({ where: { avoirDeId: f.id }, select: { id: true } });
  res.json({ ...(await avecAuteurs([f]))[0], avoirEmis: !!avoir });
});

// saisie manuelle seulement (une facture reçue du bot n'est jamais créée ni modifiée à la main) : toujours créée « en
// attente » (le statut n'est pas choisi à la saisie, voir changerStatutManuel ci-dessous) ; le total n'est pas saisi,
// pour qu'il ne puisse jamais contredire sous-total + livraison − réduction ; la réduction est saisie en pourcentage
// (même principe que order.updated, discountPercent) et convertie ici en montant. Le montant des articles n'est pas
// saisi non plus : il vient de la liste d'articles (description/quantité/prix unitaire), comme pour order.updated —
// une ligne sans quantité valide ou sans prix est ignorée plutôt que de fausser le sous-total ; une ligne sans nom
// compte quand même (sinon une quantité et un prix déjà saisis disparaîtraient du total pour un oubli de libellé),
// avec un nom par défaut pour ne pas laisser une ligne vide dans le détail de la facture.
compta.post('/api/compta/factures', ...gererFactures, traiter(async (req, res) => {
  const b = body(req);
  const clientNom = String(b.clientNom ?? '').trim().slice(0, 200);
  if (!clientNom) throw new Refus('Le nom du client est obligatoire.');
  const montant = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 2_147_483_647 ? n : null; };
  const articles = (Array.isArray(b.articles) ? b.articles : [])
    .map((a: unknown) => {
      const o = a as Record<string, unknown>;
      const name = String(o?.name ?? '').trim().slice(0, 200) || 'Article';
      const quantity = Math.round(Number(o?.quantity));
      const unitPrice = montant(o?.unitPrice);
      return Number.isInteger(quantity) && quantity > 0 && quantity <= 9999 && unitPrice !== null
        ? { name, quantity, unitPrice } : null;
    })
    .filter((a: unknown): a is { name: string; quantity: number; unitPrice: number } => a !== null);
  const sousTotal = articles.reduce((s: number, a: { quantity: number; unitPrice: number }) => s + a.quantity * a.unitPrice, 0);
  const livraison = montant(b.livraison ?? 0);
  if (livraison === null || sousTotal > 2_147_483_647) throw new Refus('Les montants doivent être des nombres positifs.');
  const pourcentage = Number(b.reductionPourcentage ?? 0);
  if (!Number.isFinite(pourcentage) || pourcentage < 0 || pourcentage > 100) throw new Refus('La réduction doit être un pourcentage entre 0 et 100.');
  const reduction = Math.round(sousTotal * pourcentage / 100);
  // date de la facture : obligatoire à la saisie (la gestion la pré-remplit avec aujourd'hui) ; échéance facultative,
  // jamais déduite
  const dateFacture = String(b.dateFacture ?? '').trim();
  if (!jourValide(dateFacture)) throw new Refus('La date de la facture est obligatoire.');
  const dateEcheance = String(b.dateEcheance ?? '').trim();
  if (dateEcheance && !jourValide(dateEcheance)) throw new Refus('La date d’échéance est invalide.');
  const f = await prisma.facture.create({
    data: {
      source: 'manuel',
      numeroFacture: String(b.numeroFacture ?? '').trim().slice(0, 100),
      clientNom, sousTotal, livraison, reduction,
      total: sousTotal + livraison - reduction,
      statutPaiement: 'EN_ATTENTE',
      compteId: req.compte.id,
      details: articles.length ? { articles } : undefined,
      dateFacture: versDate(dateFacture),
      dateEcheance: dateEcheance ? versDate(dateEcheance) : null,
    },
  });
  res.status(201).json({ id: f.id });
}));

// date de facture et date d'échéance : modifiables sur toute facture (bot ou saisie manuelle), contrairement au reste
// (montants, statut) — le bot ne fournit aucune des deux (docs/webhooks.md), la date de facture part donc de la date
// de réception (valeur par défaut de la colonne) jusqu'à correction ici. Un renvoi du bot (changement de statut) ne
// les réécrit jamais : recevoirFactureCommande n'inclut pas ces champs dans son upsert.
compta.patch('/api/compta/factures/:id/dates', ...gererFactures, traiter(async (req, res) => {
  const f = await prisma.facture.findUnique({ where: { id: intParam(req, 'id') } });
  if (!f) throw new Refus('Facture introuvable.', 404);
  const b = body(req);
  const dateFacture = String(b.dateFacture ?? '').trim();
  if (!jourValide(dateFacture)) throw new Refus('La date de la facture est invalide.');
  const dateEcheance = String(b.dateEcheance ?? '').trim();
  if (dateEcheance && !jourValide(dateEcheance)) throw new Refus('La date d’échéance est invalide.');
  await prisma.facture.update({
    where: { id: f.id },
    data: { dateFacture: versDate(dateFacture), dateEcheance: dateEcheance ? versDate(dateEcheance) : null },
  });
  res.json({ ok: true });
}));

// retirer une saisie manuelle erronée : jamais une facture reçue du bot (son historique fait foi)
compta.delete('/api/compta/factures/:id', ...gererFactures, traiter(async (req, res) => {
  const f = await prisma.facture.findUnique({ where: { id: intParam(req, 'id') } });
  if (!f) throw new Refus('Facture introuvable.', 404);
  if (f.source !== 'manuel') throw new Refus('Seule une facture saisie à la main peut être supprimée.', 403);
  await prisma.facture.delete({ where: { id: f.id } });
  res.json({ ok: true });
}));

// marquer payée / annulée : seulement une saisie manuelle, seulement depuis « en attente » (son seul statut de départ) —
// une facture reçue du bot reflète ce que Discord a réellement enregistré, le site ne le corrige pas directement
async function changerStatutManuel(req: Request, res: Response, nouveauStatut: 'PAYEE' | 'ANNULEE') {
  const f = await prisma.facture.findUnique({ where: { id: intParam(req, 'id') } });
  if (!f) throw new Refus('Facture introuvable.', 404);
  if (f.source !== 'manuel') throw new Refus('Seule une facture saisie à la main peut changer de statut.', 403);
  if (f.statutPaiement !== 'EN_ATTENTE') throw new Refus('Cette facture n’est plus en attente.', 409);
  await prisma.facture.update({ where: { id: f.id }, data: { statutPaiement: nouveauStatut } });
  res.json({ ok: true });
}
compta.post('/api/compta/factures/:id/payer', ...gererFactures, traiter((req, res) => changerStatutManuel(req, res, 'PAYEE')));
compta.post('/api/compta/factures/:id/annuler', ...gererFactures, traiter((req, res) => changerStatutManuel(req, res, 'ANNULEE')));

// avoir : facture séparée à montants négatifs, liée à l'originale (avoirDeId) — une facture payée seulement, jamais
// un second avoir sur le même avoir ni deux avoirs sur la même facture. Une originale saisie à la main passe à
// « annulée » (le site en est seul responsable) ; une originale reçue du bot garde son statut (PAID reste exact,
// l'avoir est la trace comptable du remboursement, pas une correction de ce que le bot a rapporté).
compta.post('/api/compta/factures/:id/avoir', ...gererFactures, traiter(async (req, res) => {
  const f = await prisma.facture.findUnique({ where: { id: intParam(req, 'id') } });
  if (!f) throw new Refus('Facture introuvable.', 404);
  if (f.avoirDeId) throw new Refus('Un avoir ne peut pas lui-même recevoir un avoir.', 403);
  if (!STATUTS_PAYES.includes(f.statutPaiement)) throw new Refus('Seule une facture payée peut recevoir un avoir.', 403);
  const dejaEmis = await prisma.facture.findFirst({ where: { avoirDeId: f.id } });
  if (dejaEmis) throw new Refus('Un avoir a déjà été émis pour cette facture.', 409);
  const avoir = await prisma.$transaction(async tx => {
    const a = await tx.facture.create({
      data: {
        source: f.source, avoirDeId: f.id,
        numeroFacture: `AVOIR-${f.numeroFacture || f.id}`,
        clientNom: f.clientNom,
        sousTotal: -f.sousTotal, livraison: -f.livraison, reduction: -f.reduction, total: -f.total,
        statutPaiement: 'PAYEE',
        compteId: req.compte.id,
      },
    });
    if (f.source === 'manuel') await tx.facture.update({ where: { id: f.id }, data: { statutPaiement: 'ANNULEE' } });
    return a;
  });
  res.status(201).json({ id: avoir.id });
}));

// barème d'imposition de la DOT (dot_bareme_imposition) : fixé par l'organisme du serveur RP, affiché en lecture sous
// « Dépenses déductibles et retraits » pour que la Direction comprenne les plafonds et le taux appliqués ci-dessus.
compta.get('/api/compta/dot/bareme', ...gerer, async (_req, res) => {
  const tranches = await prisma.baremeImposition.findMany({ orderBy: { seuilMin: 'asc' } });
  res.json({ tranches });
});

// ---------- tableau des salariés (à coller dans le document de la DOT) ----------
// Liste : les employés actifs (RH fait foi pour le nom et le grade — jamais le relevé). RUN (unités) et FACTURE ($)
// sont les quotas réels de la semaine en cours (tables runs/factures, mêmes chiffres que les pages Paie et Quota) :
// deux pipelines différentes pour la même activité, le relevé Tablettes n'est pas la source qui fait foi ailleurs sur
// le site. VENTE et CA TOTAL RÉALISÉ restent lus dans le relevé Tablettes (colonnes « Ventes » et « Total
// entreprise », retrouvées par nom comme la paie à l'heure) : 0 si l'employé n'y figure pas cette semaine-là. Salaire
// = calculerPaie (fixe du grade + palier run/facture le plus haut atteint, jamais cumulé) + paie à l'heure ; la Prime
// reste à 0 $, saisie à la main dans le document (bonus discrétionnaire, hors paliers).
const ALIAS_NOM_SALARIES = ['nom', "nom de l'employé", 'nom du salarié', 'employé', 'employe'];
async function salariesDot() {
  const releve = await dernierReleve();
  const colonnesMin = releve ? minuscules(releve.colonnes) : [];
  const lignes = releve ? releve.lignes.filter(l => !estTotal(l)) : [];
  const iNomReleve = indexColonne(colonnesMin, ALIAS_NOM_SALARIES);
  const iVente = indexColonne(colonnesMin, ['vente', 'ventes']);
  const iTotalEntreprise = indexColonne(colonnesMin, ['total entreprise', 'total']);
  const ligneParNom = new Map<string, string[]>(iNomReleve === -1 ? [] : lignes.map((l): [string, string[]] => [normaliserNom(l[iNomReleve]), l]).filter(([n]) => n));

  const [employes, config, paieH] = await Promise.all([
    prisma.employe.findMany({ where: { statut: 'actif' }, select: { id: true, prenom: true, nom: true, discordPseudo: true, idUnique: true, gradeCle: true } }),
    paieGrades(),
    releve ? paieHoraire(releve.colonnes, releve.lignes) : null,
  ]);
  const configParGrade = new Map(config.map(c => [c.cle, c]));
  const paieHoraireParNom = new Map((paieH?.lignes ?? []).map(p => [normaliserNom(p.nom), p.montant]));

  const idsEmployes = employes.map(e => e.id);
  const debut = debutSemaineParis(), fin = new Date(debut); fin.setUTCDate(fin.getUTCDate() + 7);
  const [sommeRuns, sommeFactures] = idsEmployes.length ? await Promise.all([
    prisma.run.groupBy({ by: ['employeId'], where: { employeId: { in: idsEmployes }, creeLe: { gte: debut, lt: fin } }, _sum: { quantite: true } }),
    prisma.facture.groupBy({ by: ['employeId'], where: { employeId: { in: idsEmployes }, dateFacture: { gte: debut, lt: fin } }, _sum: { total: true } }),
  ]) : [[], []];
  const runsParEmploye = new Map(sommeRuns.map(s => [s.employeId as number, s._sum.quantite ?? 0]));
  const facturesParEmploye = new Map(sommeFactures.map(s => [s.employeId as number, s._sum.total ?? 0]));

  const agents = employes.map(e => {
    const nom = nomComplet(e), cle = normaliserNom(nom);
    const ligne = ligneParNom.get(cle);
    const run = runsParEmploye.get(e.id) ?? 0, facture = facturesParEmploye.get(e.id) ?? 0;
    const vente = ligne && iVente !== -1 ? Math.round(montantReleve(ligne[iVente])) : 0;
    const caTotalRealise = ligne && iTotalEntreprise !== -1 ? Math.round(montantReleve(ligne[iTotalEntreprise])) : 0;
    const c = configParGrade.get(e.gradeCle);
    const salaire = c ? calculerPaie({ salaireFixe: c.salaireFixe, salaireActif: c.salaireActif, paliersRun: c.paliersRun, runs: run, paliersFacture: c.paliersFacture, factures: facture }).total : 0;
    return { nom, grade: gradeDe(e.gradeCle)?.libelle ?? e.gradeCle, run, facture, vente, caTotalRealise, salaireTotal: salaire + (paieHoraireParNom.get(cle) ?? 0) };
  });
  return { agents, tabletteTrouvee: !!releve };
}

compta.get('/api/compta/dot/salaries', ...gerer, async (_req, res) => { res.json(await salariesDot()); });

// ---------- résumé DOT ----------
// CA brut (dernier relevé) − dépenses = bénéfice imposable → tranche du barème → impôts ; puis retraits. Le relevé
// utilisé (date, auteur, nombre de lignes) est montré pour que la Direction vérifie avant de valider une déclaration
// réelle. Les salaires de la semaine (tableau des salariés ci-dessus) ne sont pas repris dans ce total : la Direction
// les ajoute elle-même dans son document (ils n'étaient déjà pas comptés dans « bénéfice net » avant cette page).
compta.get('/api/compta/dot/resume', ...gerer, async (_req, res) => {
  const [releve, ecritures, bareme] = await Promise.all([dernierReleve(), prisma.ecritureDot.findMany(), prisma.baremeImposition.findMany({ orderBy: { seuilMin: 'asc' } })]);
  const ca = releve ? caBrutReleve(releve.colonnes, releve.lignes) : null;
  const depenses = ecritures.filter(e => e.type === 'depense').reduce((s, e) => s + e.montant, 0);
  const retraits = ecritures.filter(e => e.type === 'retrait').reduce((s, e) => s + e.montant, 0);
  const imposable = ca === null ? null : ca - depenses;
  // sous la première tranche ou en perte : 0 $ d'impôt, jamais le taux de la dernière tranche (stats/releve.ts)
  const { tranche, impots } = imposable === null ? { tranche: null, impots: null } : impotDot(imposable, bareme);
  const apresImpots = imposable === null || impots === null ? null : imposable - impots;
  res.json({
    caBrut: ca, caBrutTrouve: ca !== null,
    caBrutSource: releve && ca !== null ? { importeLe: releve.importeLe, importePar: releve.importePar, nbLignes: releve.lignes.filter(l => !estTotal(l)).length } : null,
    depenseDeductible: depenses, beneficeImposable: imposable, tauxImposition: tranche ? tranche.taux : imposable === null ? null : 0, montantImpots: impots,
    beneficeApresImpots: apresImpots,
    // « bénéfice net » tel que décrit par la Direction : après impôts, moins les retraits (pas encore les salaires)
    retraits, beneficeNet: apresImpots === null ? null : apresImpots - retraits,
    plafonds: tranche ? { salaireMaxEmploye: tranche.salaireMaxEmploye, salaireMaxPatron: tranche.salaireMaxPatron, primeMaxEmploye: tranche.primeMaxEmploye, primeMaxPatron: tranche.primeMaxPatron } : null,
  });
});
