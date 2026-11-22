// SOCLE — contrôle de l'origine des requêtes qui modifient des données (server/src/index.ts), testé dans
// test/socle-csrf.test.ts. En jeu (Chromium 144 de FiveM), un POST peut arriver avec « Origin: null » (docs/guide-dev-fbfa.md,
// B7) : refusé en bloc, plus aucune sauvegarde ne marcherait. Il n'est accepté qu'avec le jeton de la session
// (en-tête X-CSRF-Token, lu par GET /api/csrf) : un autre site, ou une iframe isolée qui produit aussi « null », ne peut pas le connaître.
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const nouveauJetonCsrf = (): string => randomBytes(24).toString('hex');

const egaux = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Requête acceptée ? methode : GET/HEAD jamais contrôlées. origineRecue : en-tête Origin (absent : curl, script — rien à
// craindre, comme avant). jetonAutorise : seulement quand l'ordinateur en jeu est configuré (FOLKOS_HOTE).
export function origineAcceptee(opts: {
  methode: string; origineRecue: string | undefined; origineSite: string;
  jetonSession: string | undefined; jetonRecu: string | undefined; jetonAutorise: boolean;
}): boolean {
  const { methode, origineRecue, origineSite, jetonSession, jetonRecu, jetonAutorise } = opts;
  if (methode === 'GET' || methode === 'HEAD' || !origineRecue || origineRecue === origineSite) return true;
  return jetonAutorise && origineRecue === 'null' && !!jetonSession && !!jetonRecu && egaux(jetonSession, jetonRecu);
}
