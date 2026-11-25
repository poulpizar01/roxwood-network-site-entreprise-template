// ENTREPRISE — bloc « À traiter » de l'Accueil de l'espace de gestion : ce qui attend une action, selon les droits du
// compte (demandes d'accès, candidatures du bot restées en attente). Des compteurs et un lien vers la page qui
// traite, rien d'autre ; une liste vide masque le bloc.
import { Router } from 'express';
import { prisma } from '../../socle/db.js';
import { peut, tousLesGrades } from '../../socle/droits.js';
import { valide } from '../../socle/http.js';
import { droitsAgenda, peutValiderAbsences } from '../agenda-regles.js';
import { nombreContratsAFacturer } from '../echeanciers.js';
import { EN_SUSPENS } from '../rh.js';
import { nombreCandidaturesRecues } from '../candidatures.js';
import { nombreDemandesNouvelles } from '../demandes.js';
import { moduleActif } from '../modules.js';
import { recrutementSiteActif } from '../recrutement-mode.js';
import { nombreSalonsIntrouvables } from '../salon-discord.js';
import { debutSemaineParis } from '../texte.js';

export const accueil = Router();

type Tache = { cle: string; nombre: number; texte: string; lien: string; alerte?: boolean };
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

accueil.get('/api/accueil/a-traiter', ...valide, async (req, res) => {
  const c = req.compte, taches: Tache[] = [];
  const rhCreer = peut(c, 'rh-voir') && peut(c, 'rh-creer');
  const grades = tousLesGrades().map(g => g.cle);
  // décomptes indépendants : lancés ensemble, 0 (sans requête) quand le compte n'a pas le droit de les voir
  const sans = Promise.resolve(0);
  const [comptes, bot, site, demandes, factures, contratsAFacturer, salons, absences] = await Promise.all([
    peut(c, 'comptes') ? prisma.compte.count({ where: { statut: 'attente' } }) : sans,
    rhCreer ? prisma.arriveeBot.count({ where: { resultat: { in: EN_SUSPENS } } }) : sans,
    recrutementSiteActif() && rhCreer ? nombreCandidaturesRecues() : sans,
    moduleActif('demandes') && peut(c, 'demandes-voir') ? nombreDemandesNouvelles() : sans,
    // semaine en cours seulement : Facturation n'affiche qu'une semaine à la fois, le lien doit montrer ce qu'il compte
    // mêmes statuts que la catégorie « En attente » de Facturation (facturation.js, CATEGORIES_STATUT)
    peut(c, 'factures-voir') ? prisma.facture.count({ where: { statutPaiement: { in: ['EN_ATTENTE', 'UNPAID'] }, dateFacture: { gte: debutSemaineParis() } } }) : sans,
    // facturer un contrat : il faut gérer les contrats (la fiche porte le bouton) et les factures
    peut(c, 'contrats') && peut(c, 'factures') ? nombreContratsAFacturer() : sans,
    // salon Discord introuvable (dernier envoi en 404, salon-discord.ts) : un salon supprimé sur Discord après avoir été
    // renseigné sur un contrat ; à corriger sur sa fiche
    peut(c, 'contrats') ? nombreSalonsIntrouvables().then(r => r.contrats) : sans,
    // valider une absence : réservé à qui gère déjà l'agenda de toute l'équipe (peutValiderAbsences, agenda-regles.ts)
    (async () => {
      const droitsGrade = c.gradeCle ? await prisma.agendaDroitsGrade.findUnique({ where: { gradeCle: c.gradeCle } }) : null;
      return peutValiderAbsences(droitsAgenda(grades, c.gradeCle, c.proprietaire, droitsGrade)) ? prisma.evenementAgenda.count({ where: { statutAbsence: 'en_attente' } }) : 0;
    })(),
  ]);
  if (comptes) taches.push({ cle: 'comptes', nombre: comptes, texte: `${pluriel(comptes, 'demande')} d’accès à valider`, lien: 'comptes.html' });
  if (bot) taches.push({ cle: 'candidatures', nombre: bot, texte: `${pluriel(bot, 'candidature')} à traiter`, lien: 'rh.html#rh-bot' });
  if (site) taches.push({ cle: 'recrutement', nombre: site, texte: `${pluriel(site, 'candidature')} reçue${site > 1 ? 's' : ''} sur le site`, lien: 'rh.html#recrutement' });
  if (demandes) taches.push({ cle: 'demandes', nombre: demandes, texte: `${pluriel(demandes, 'demande')} à traiter`, lien: 'demandes.html' });
  if (factures) taches.push({ cle: 'factures', nombre: factures, texte: `${pluriel(factures, 'facture')} en attente de paiement cette semaine`, lien: 'facturation.html?statut=attente' });
  if (contratsAFacturer) taches.push({ cle: 'contrats', nombre: contratsAFacturer, texte: `${pluriel(contratsAFacturer, 'contrat')} à facturer`, lien: 'contrats.html?a-facturer=1' });
  if (salons) taches.push({ cle: 'salon-contrats', nombre: salons, texte: `${pluriel(salons, 'contrat')} avec un salon Discord introuvable`, lien: 'contrats.html', alerte: true });
  if (absences) taches.push({ cle: 'absences', nombre: absences, texte: `${pluriel(absences, 'absence')} à valider`, lien: 'agenda.html' });
  res.json({ taches });
});
