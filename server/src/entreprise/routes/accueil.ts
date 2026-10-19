// ENTREPRISE — bloc « À traiter » de l'Accueil de l'espace de gestion : ce qui attend une action, selon les droits du
// compte (demandes d'accès, candidatures du bot restées en attente, lectures automatiques en échec). Des compteurs et
// un lien vers la page qui traite, rien d'autre ; une liste vide masque le bloc.
import { Router } from 'express';
import { prisma } from '../../socle/db.js';
import { peut } from '../../socle/droits.js';
import { valide } from '../../socle/http.js';
import { sheetRegle } from '../parametres.js';
import { EN_SUSPENS } from '../rh.js';

export const accueil = Router();

type Tache = { cle: string; nombre: number; texte: string; lien: string; alerte?: boolean };
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

accueil.get('/api/accueil/a-traiter', ...valide, async (req, res) => {
  const c = req.compte, taches: Tache[] = [];
  if (peut(c, 'comptes')) {
    const n = await prisma.compte.count({ where: { statut: 'attente' } });
    if (n) taches.push({ cle: 'comptes', nombre: n, texte: `${pluriel(n, 'demande')} d’accès à valider`, lien: 'comptes.html' });
  }
  if (peut(c, 'rh-voir') && peut(c, 'rh-creer')) {
    const n = await prisma.arriveeBot.count({ where: { resultat: { in: EN_SUSPENS } } });
    if (n) taches.push({ cle: 'candidatures', nombre: n, texte: `${pluriel(n, 'candidature')} à traiter`, lien: 'rh.html#rh-bot' });
  }
  if (peut(c, 'parametres')) {
    const tableur = await prisma.tableurEtat.findUnique({ where: { id: 1 } });
    if (sheetRegle() && tableur?.statut === 'erreur')
      taches.push({ cle: 'tableur', nombre: 1, alerte: true, texte: 'La lecture du Google Sheets échoue : les primes ne sont plus à jour', lien: 'parametres.html?onglet=Google%20Sheets' });
  }
  res.json({ taches });
});
