// ENTREPRISE — comptabilité (permission « compta » : relevé Tablettes et DOT ; permission « factures » séparée : gestion
// des factures) : relevé Tablettes collé, mouvements et résumé DOT hebdomadaire. Le calcul d'une semaine (relevé,
// mouvements, salariés, résumé, verrouillage) vit dans ../dot.ts, partagé avec la tâche planifiée de verrouillage
// automatique (verrouillage-dot.ts).
import { Prisma } from '../../generated/prisma/client.js';
import { Router } from 'express';
import { prisma } from '../../socle/db.js';
import { auDessusDe, gradeDe } from '../../socle/droits.js';
import { body, intParam, permission } from '../../socle/http.js';
import { definirReglage } from '../../socle/reglages.js';
import {
  CLE_SOLDE_BANCAIRE, TYPES_ECRITURE, construireEtVerrouiller, corrigerLigneTotale, dernierReleve, ecrituresBrutes,
  enregistrerReleve, estVerrouillee, paieHoraire, refuserSiVerrouillee, resumeDot, salariesDot, semaineCourante, semaineDate, semaineDemandee,
} from '../dot.js';
import { classementFactures, definirQuotaFacture, quotasFacture } from '../facture.js';
import { Refus, traiter } from '../refus.js';
import { caBrutReleve } from '../stats/releve.js';
import { jourValide, versDate } from '../texte.js';

export const compta = Router();
const gerer = permission('compta');
const gererFactures = permission('factures');

// ---------- relevé Tablettes ----------
// Le navigateur découpe le tableau collé en colonnes et en lignes ; le serveur revalide ce résultat (jamais de
// confiance aveugle), garde chaque import, et ne renvoie que le plus récent.
// bornes de chaque élément ; le relevé entier est de toute façon limité à 64 Ko (corps JSON, socle) : la page le vérifie
// avant l'envoi
const MAX_COLONNES = 20, MAX_LIGNES = 500, MAX_CELLULE = 300;

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

// ---------- mouvements de la DOT (recette exceptionnelle, dépense déductible, retrait), un journal par semaine ----------
// Un mouvement ne se crée, ne se supprime ni ne se réinitialise que sur une semaine non verrouillée (jamais future).
compta.get('/api/compta/dot/ecritures', ...gerer, async (req, res) => {
  const semaine = semaineDemandee(req.query.semaine);
  const declaree = await prisma.declarationDot.findUnique({ where: { semaine: semaineDate(semaine) }, select: { ecritures: true } });
  res.json({ semaine, verrouillee: !!declaree, ecritures: declaree ? declaree.ecritures : await ecrituresBrutes(semaine) });
});

compta.post('/api/compta/dot/ecritures', ...gerer, traiter(async (req, res) => {
  const b = body(req);
  if (!TYPES_ECRITURE.includes(String(b.type))) throw new Refus('Le type doit être « depense », « retrait » ou « recette ».');
  const justificatif = String(b.justificatif ?? '').trim();
  if (!justificatif) throw new Refus('Le justificatif est obligatoire.');
  if (justificatif.length > 200) throw new Refus('Le justificatif est trop long (200 caractères max).');
  const date = String(b.date ?? '').trim();
  if (date && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) throw new Refus('La date doit être au format JJ/MM/AAAA.');
  const montant = Number(b.montant);
  if (b.montant == null || b.montant === '' || !Number.isFinite(montant) || Math.abs(montant) > 2_147_483_647) throw new Refus('Le montant doit être un nombre.');
  // un montant négatif inverserait le mouvement (une dépense augmenterait l'impôt) : on corrige en supprimant la ligne
  if (montant < 0) throw new Refus('Le montant doit être positif : pour annuler un mouvement, supprimez-le.');
  const semaine = semaineDemandee(b.semaine);
  refuserSiVerrouillee(await estVerrouillee(semaine));
  const e = await prisma.ecritureDot.create({ data: { type: String(b.type), semaine: semaineDate(semaine), dateEcriture: date, justificatif, montant: Math.round(montant), compteId: req.compte.id } });
  res.status(201).json({ id: e.id });
}));

compta.delete('/api/compta/dot/ecritures/:id', ...gerer, traiter(async (req, res) => {
  const e = await prisma.ecritureDot.findUnique({ where: { id: intParam(req, 'id') } });
  if (!e) throw new Refus('Mouvement introuvable.', 404);
  refuserSiVerrouillee(await prisma.declarationDot.findUnique({ where: { semaine: e.semaine }, select: { semaine: true } }).then(d => !!d));
  await prisma.ecritureDot.delete({ where: { id: e.id } });
  res.json({ ok: true });
}));

// réinitialiser UN type (recette, dépense OU retrait), jamais les autres, pour la semaine demandée
compta.delete('/api/compta/dot/ecritures', ...gerer, traiter(async (req, res) => {
  const type = String(req.query.type ?? '').trim();
  if (!TYPES_ECRITURE.includes(type)) throw new Refus('Le paramètre « type » doit être « depense », « retrait » ou « recette ».');
  const semaine = semaineDemandee(req.query.semaine);
  refuserSiVerrouillee(await estVerrouillee(semaine));
  await prisma.ecritureDot.deleteMany({ where: { type, semaine: semaineDate(semaine) } });
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
  // avoirEmis (bouton « Créer un avoir » de la liste) : un avoir peut dater d'une autre semaine que l'originale (sa
  // date de facture n'est pas reprise de l'originale), donc pas déductible des seules lignes déjà chargées
  const ids = factures.map(f => f.id);
  const avoirs = ids.length ? await prisma.facture.findMany({ where: { avoirDeId: { in: ids } }, select: { avoirDeId: true } }) : [];
  const avoirsDe = new Set(avoirs.map(a => a.avoirDeId));
  res.json({ factures: (await avecAuteurs(factures)).map(f => ({ ...f, avoirEmis: avoirsDe.has(f.id) })) });
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

// saisie manuelle seulement (une facture reçue du bot n'est jamais créée ni modifiée à la main, sauf ses dates ci-
// dessous) : le total n'est pas saisi, pour qu'il ne puisse jamais contredire sous-total + livraison − réduction ; la
// réduction est saisie en pourcentage (même principe que order.updated, discountPercent) et convertie ici en montant.
// Le montant des articles n'est pas saisi non plus : il vient de la liste d'articles (description/quantité/prix
// unitaire), comme pour order.updated — une ligne sans quantité valide ou sans prix est ignorée plutôt que de fausser
// le sous-total ; une ligne sans nom compte quand même (sinon une quantité et un prix déjà saisis disparaîtraient du
// total pour un oubli de libellé), avec un nom par défaut pour ne pas laisser une ligne vide dans le détail de la
// facture. Partagé par la création et la modification d'une facture manuelle (mêmes règles, mêmes messages).
function construireLigneFacture(b: Record<string, unknown>) {
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
  return {
    numeroFacture: String(b.numeroFacture ?? '').trim().slice(0, 100),
    clientNom, sousTotal, livraison, reduction, total: sousTotal + livraison - reduction,
    // Prisma.JsonNull (jamais undefined) : sur une modification, undefined laisserait d'anciens articles en base si
    // la liste est vidée — un update Prisma ignore un champ undefined au lieu de l'effacer.
    details: articles.length ? { articles } : Prisma.JsonNull,
  };
}

compta.post('/api/compta/factures', ...gererFactures, traiter(async (req, res) => {
  const b = body(req);
  const ligne = construireLigneFacture(b);
  // date de la facture : obligatoire à la saisie (la gestion la pré-remplit avec aujourd'hui) ; échéance facultative,
  // jamais déduite
  const dateFacture = String(b.dateFacture ?? '').trim();
  if (!jourValide(dateFacture)) throw new Refus('La date de la facture est obligatoire.');
  const dateEcheance = String(b.dateEcheance ?? '').trim();
  if (dateEcheance && !jourValide(dateEcheance)) throw new Refus('La date d’échéance est invalide.');
  const f = await prisma.facture.create({
    data: {
      ...ligne, source: 'manuel', statutPaiement: 'EN_ATTENTE', compteId: req.compte.id,
      dateFacture: versDate(dateFacture),
      dateEcheance: dateEcheance ? versDate(dateEcheance) : null,
    },
  });
  res.status(201).json({ id: f.id });
}));

// Modification d'une facture existante : la date de facture et la date d'échéance se modifient sur toute facture
// (bot ou saisie manuelle) — le bot ne fournit aucune des deux (docs/webhooks.md), la date de facture part donc de la
// date de réception (valeur par défaut de la colonne) jusqu'à correction ici ; un renvoi du bot (changement de
// statut) ne les réécrit jamais (recevoirFactureCommande n'inclut pas ces champs dans son upsert). Montants et
// articles, eux, ne se modifient que sur une facture saisie à la main (une facture reçue du bot reflète ce que
// Discord a réellement enregistré, le site ne le corrige pas directement ; un avoir reprend tels quels les montants
// qu'il annule, il ne se modifie pas non plus).
compta.patch('/api/compta/factures/:id', ...gererFactures, traiter(async (req, res) => {
  const f = await prisma.facture.findUnique({ where: { id: intParam(req, 'id') } });
  if (!f) throw new Refus('Facture introuvable.', 404);
  const b = body(req);
  const dateFacture = String(b.dateFacture ?? '').trim();
  if (!jourValide(dateFacture)) throw new Refus('La date de la facture est invalide.');
  const dateEcheance = String(b.dateEcheance ?? '').trim();
  if (dateEcheance && !jourValide(dateEcheance)) throw new Refus('La date d’échéance est invalide.');
  const dates = { dateFacture: versDate(dateFacture), dateEcheance: dateEcheance ? versDate(dateEcheance) : null };
  // seule une facture saisie à la main, et qui n'est pas elle-même un avoir (il reprend tels quels les montants qu'il
  // annule), a ses montants et articles modifiables ; les autres (bot, avoir) ne modifient que leurs dates
  if (f.source === 'manuel' && !f.avoirDeId) {
    await prisma.facture.update({ where: { id: f.id }, data: { ...dates, ...construireLigneFacture(b) } });
  } else {
    await prisma.facture.update({ where: { id: f.id }, data: dates });
  }
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

// changer le statut (en attente / payée / annulée) : seulement une saisie manuelle qui n'est pas elle-même un avoir
// (il reprend le statut qu'on lui donne à sa création, jamais corrigé après) — une facture reçue du bot reflète ce
// que Discord a réellement enregistré, le site ne le corrige pas directement. Dans les deux sens (on peut revenir en
// arrière), sauf à sortir de « payée » une fois qu'un avoir en a été émis : il annule des montants déjà payés, les en
// faire disparaître laisserait l'avoir sans base.
const STATUTS_MANUELS = ['EN_ATTENTE', 'PAYEE', 'ANNULEE'];
compta.post('/api/compta/factures/:id/statut', ...gererFactures, traiter(async (req, res) => {
  const f = await prisma.facture.findUnique({ where: { id: intParam(req, 'id') } });
  if (!f) throw new Refus('Facture introuvable.', 404);
  if (f.source !== 'manuel' || f.avoirDeId) throw new Refus('Seule une facture saisie à la main peut changer de statut.', 403);
  const statut = String(body(req).statut ?? '');
  if (!STATUTS_MANUELS.includes(statut)) throw new Refus('Statut invalide.');
  if (statut === f.statutPaiement) { res.json({ ok: true }); return; }
  if (f.statutPaiement === 'PAYEE') {
    const avoir = await prisma.facture.findFirst({ where: { avoirDeId: f.id }, select: { id: true } });
    if (avoir) throw new Refus('Un avoir a été émis pour cette facture : son statut ne peut plus changer.', 409);
  }
  await prisma.facture.update({ where: { id: f.id }, data: { statutPaiement: statut } });
  res.json({ ok: true });
}));

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
  // avoirDeId est unique en base (contrainte) : une seconde requête presque simultanée, passée malgré le contrôle
  // ci-dessus, échoue ici plutôt que de créer un second avoir.
  let avoir;
  try {
    avoir = await prisma.$transaction(async tx => {
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
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new Refus('Un avoir a déjà été émis pour cette facture.', 409);
    throw e;
  }
  res.status(201).json({ id: avoir.id });
}));

// barème d'imposition de la DOT (dot_bareme_imposition) et barème de l'impôt sur la richesse (dot_bareme_richesse) :
// fixés par l'organisme du serveur RP, affichés en lecture pour que la Direction comprenne les plafonds et taux appliqués.
compta.get('/api/compta/dot/bareme', ...gerer, async (_req, res) => {
  const [tranches, tranchesRichesse] = await Promise.all([
    prisma.baremeImposition.findMany({ orderBy: { seuilMin: 'asc' } }),
    prisma.baremeRichesse.findMany({ orderBy: { seuilMin: 'asc' } }),
  ]);
  res.json({ tranches, tranchesRichesse });
});

// ---------- solde bancaire (impôt sur la richesse) ----------
// Saisi à la main (relevé du compte en jeu) : son taux de tranche s'ajoute à celui du bénéfice, pas un second impôt.
// Gardé en réglage (socle/reglages.ts), une seule valeur globale : modifiable seulement si la semaine en cours n'est
// pas verrouillée (une semaine verrouillée garde la valeur figée dans son résumé, jamais celle-ci).
compta.put('/api/compta/dot/solde-bancaire', ...gerer, traiter(async (req, res) => {
  const montant = Math.round(Number(body(req).montant));
  if (!Number.isFinite(montant) || montant < 0 || montant > 999_000_000) throw new Refus('Le solde doit être un nombre positif.');
  refuserSiVerrouillee(await estVerrouillee(semaineCourante()));
  await definirReglage(CLE_SOLDE_BANCAIRE, String(montant));
  res.json({ ok: true });
}));

// ---------- tableau des salariés (à coller dans le document de la DOT) ----------
compta.get('/api/compta/dot/salaries', ...gerer, async (req, res) => {
  const semaine = semaineDemandee(req.query.semaine);
  const declaree = await prisma.declarationDot.findUnique({ where: { semaine: semaineDate(semaine) }, select: { salaries: true } });
  res.json(declaree ? { ...(declaree.salaries as object), semaine, verrouillee: true } : { ...await salariesDot(semaine), semaine, verrouillee: false });
});

// Prime d'un employé, saisie pour une semaine non verrouillée (tableau des salariés) : entre dans « Montant total des
// primes » du résumé DOT.
compta.put('/api/compta/dot/salaries/:employeId/prime', ...gerer, traiter(async (req, res) => {
  const employeId = intParam(req, 'employeId');
  const employe = await prisma.employe.findUnique({ where: { id: employeId }, select: { id: true } });
  if (!employe) throw new Refus('Employé introuvable.', 404);
  const montant = Math.round(Number(body(req).montant));
  if (!Number.isFinite(montant) || montant < 0 || montant > 2_147_483_647) throw new Refus('La prime doit être un nombre positif.');
  const semaine = semaineDemandee(req.query.semaine);
  refuserSiVerrouillee(await estVerrouillee(semaine));
  await prisma.primeEmployeSemaine.upsert({ where: { employeId_semaine: { employeId, semaine: semaineDate(semaine) } }, create: { employeId, semaine: semaineDate(semaine), montant }, update: { montant } });
  res.json({ ok: true });
}));

// ---------- résumé DOT ----------
// Semaine demandée (?semaine=AAAA-MM-JJ, lundi le plus proche, jamais future) : si elle est verrouillée, son résumé
// figé est renvoyé tel quel (aucun recalcul) ; sinon il est calculé à l'instant à partir de l'état actuel.
compta.get('/api/compta/dot/resume', ...gerer, async (req, res) => {
  const semaine = semaineDemandee(req.query.semaine);
  const declaree = await prisma.declarationDot.findUnique({ where: { semaine: semaineDate(semaine) } });
  if (declaree) {
    res.json({ ...(declaree.resume as object), semaine, verrouillee: true, verrouilleeLe: declaree.figeeLe, verrouilleeAuto: declaree.statut === 'auto' });
    return;
  }
  const resume = await resumeDot(semaine);
  res.json({ ...resume, verrouillee: false, enAttenteVerrouillage: semaine < semaineCourante() });
});

// « Valider la déclaration » : fige la semaine demandée (la semaine en cours par défaut) — résumé, salariés et
// mouvements ne changent plus ensuite, même si le barème, le relevé Tablettes ou le solde bancaire changent après
// coup. Si personne ne valide, la semaine est verrouillée automatiquement la semaine suivante (verrouillage-dot.ts).
compta.post('/api/compta/dot/verrouiller', ...gerer, traiter(async (req, res) => {
  const semaine = semaineDemandee(body(req).semaine);
  await construireEtVerrouiller(semaine, req.compte.id, 'validee');
  res.status(201).json({ ok: true, semaine });
}));

