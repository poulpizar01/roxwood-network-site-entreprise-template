// SOCLE — gardes d'accès et petites aides communes aux routes (socle et entreprise).
// Toute route ajoutée commence par une garde, étalée : ...connecte, ...valide ou ...permission('cle').
import type { Request, RequestHandler } from 'express';
import { prisma } from './db.js';
import type { Compte } from '../generated/prisma/client.js';
import { CLES_PERMISSIONS, peut } from './droits.js';

declare module 'express-session' {
  interface SessionData {
    compteId: number;
    oauthState: string;
    oauthNext?: string;   // retour après connexion Discord (auth.ts), ex. vers un tiroir qui exige une reconfirmation
  }
}
declare module 'express-serve-static-core' {
  interface Request { compte: Compte }   // posé par les gardes valide et permission
}

const exigerSession: RequestHandler = (req, res, next) => {
  if (req.session.compteId) next();
  else res.status(401).json({ error: 'non-connecte' });
};

// charge le compte courant, quel que soit son statut (attente comprise)
const chargerCompte: RequestHandler = async (req, res, next) => {
  const c = await prisma.compte.findUnique({ where: { id: req.session.compteId } });
  if (!c) { req.session.destroy(() => res.status(401).json({ error: 'non-connecte' })); return; }
  req.compte = c;
  next();
};
// + exige qu'il soit validé
const exigerValide: RequestHandler = (req, res, next) => {
  if (req.compte.statut !== 'valide') { res.status(403).json({ error: 'attente', statut: req.compte.statut }); return; }
  next();
};

// connecte : session ouverte (compte éventuellement en attente) ; avecCompte : + req.compte chargé, attente acceptée
// (aide en ligne, D9 : les articles « Premiers pas » restent lisibles avant validation) ; valide : compte validé ;
// permission : + la permission
export const connecte = [exigerSession];
export const avecCompte = [exigerSession, chargerCompte];
export const valide = [exigerSession, chargerCompte, exigerValide];
export function permission(cle: string): RequestHandler[] {
  // vérifiée au démarrage (l'appel a lieu à la déclaration des routes) : une faute de frappe ne laisse pas une route ouverte à tous
  if (!CLES_PERMISSIONS.has(cle)) throw new Error(`permission('${cle}') : permission inconnue, à déclarer dans entreprise/permissions.ts`);
  return [exigerSession, chargerCompte, exigerValide, (req, res, next) => {
    if (peut(req.compte, cle)) next();
    else res.status(403).json({ error: 'interdit', permission: cle });
  }];
}

// corps JSON d'une requête (absent = objet vide) et champ texte nettoyé
export const body = (req: Request): Record<string, unknown> => (req.body && typeof req.body === 'object' ? req.body : {});
export const text = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);
// entier strictement positif tenant dans une colonne INTEGER de la base, sinon null (« abc », 1.5, nombre trop grand…)
export const entier = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : /^\d{1,10}$/.test(String(v ?? '')) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
};
// identifiant pris dans l'adresse ; illisible = -1, qui ne correspond à aucune ligne (la route répond alors 404, pas 500)
export const intParam = (req: Request, name: string): number => entier(req.params[name]) ?? -1;
// couleur #rrggbb, sinon null
export const couleur = (v: unknown): string | null => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
