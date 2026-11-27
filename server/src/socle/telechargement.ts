// SOCLE — téléchargement par le serveur d'une image dont un utilisateur a donné l'adresse : dans l'ordinateur en jeu, le
// sélecteur de fichiers est peu fiable (docs/guide-dev-fbfa.md, B7). Chaque saut passe par requeteHttps (adresses.ts) :
// https seulement, jamais le serveur lui-même ni le réseau interne. En plus ici : port par défaut, taille, durée et
// nombre de redirections bornés. Le contenu reçu reste à contrôler par l'appelant.
import type { IncomingMessage } from 'node:http';
import { requeteHttps } from './adresses.js';

// refus à montrer tel quel à l'utilisateur
export class LienRefuse extends Error {}

const REDIRECTIONS_MAX = 3;

export function adresseImage(brut: string, base?: URL): URL {
  let u: URL;
  try { u = new URL(brut, base); } catch { throw new LienRefuse('Adresse illisible.'); }
  if (u.protocol !== 'https:') throw new LienRefuse('L’adresse doit commencer par https://.');
  if (u.port) throw new LienRefuse('Adresse refusée (port inhabituel).');
  if (u.username || u.password) throw new LienRefuse('Adresse refusée (identifiants dans l’adresse).');
  return u;
}

// corps de la réponse, abandonné dès qu'il dépasse la limite (la taille annoncée n'est pas crue sur parole)
export async function lireBorne(flux: AsyncIterable<Buffer> & { destroy(): void }, octetsMax: number): Promise<Buffer> {
  const morceaux: Buffer[] = [];
  let total = 0;
  for await (const m of flux) {
    total += m.length;
    if (total > octetsMax) { flux.destroy(); throw new LienRefuse(`Image trop lourde (${Math.round(octetsMax / 1024 / 1024)} Mo max).`); }
    morceaux.push(m);
  }
  return Buffer.concat(morceaux);
}

export async function telecharger(brut: string, octetsMax: number, delaiMs = 15_000): Promise<Buffer> {
  let u = adresseImage(brut.trim());
  const fin = Date.now() + delaiMs;   // délai pour l'ensemble, redirections comprises
  for (let saut = 0; ; saut++) {
    let res: IncomingMessage;
    try {
      res = await requeteHttps(u, { delaiMs: Math.max(1, fin - Date.now()), entetes: { 'User-Agent': 'roxwood-site/1.0' } });
      const statut = res.statusCode ?? 0;
      if (statut >= 300 && statut < 400) {
        res.destroy();
        if (!res.headers.location || saut >= REDIRECTIONS_MAX) throw new LienRefuse('Trop de redirections.');
        u = adresseImage(res.headers.location, u);
        continue;
      }
      if (statut !== 200) { res.destroy(); throw new LienRefuse(`Rien à cette adresse (réponse ${statut}).`); }
      return await lireBorne(res, octetsMax);
    } catch (e) {
      if (e instanceof LienRefuse) throw e;
      throw new LienRefuse((e as { code?: string }).code === 'ADRESSE_INTERDITE' ? 'Adresse refusée (adresse interne).' : 'Image injoignable à cette adresse.');
    }
  }
}
