/* SOCLE — stockage des fichiers envoyés (images). Contrat du service : docs/stockage.md.
   - production : service de stockage distant (CDN, STORAGE_URL + STORAGE_TOKEN), obligatoire. Sans lui, aucun envoi
     n'est accepté (le disque du VPS n'est ni sauvegardé ni fait pour ça) : le site démarre quand même et l'envoi
     répond une erreur claire.
   - dev : toujours le disque local (UPLOAD_DIR), servi par le site sous /uploads, même si le CDN est paramétré — des
     images d'essai n'ont rien à faire sur le stockage de la prod, ni un poste de dev à pouvoir y supprimer quoi que ce soit. */
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config.js';

const LOCAL_PREFIX = '/uploads/';
const { url, token, prefix, dir } = config.storage;
const kind = !config.production ? 'local' as const : token ? 'cdn' as const : 'aucun' as const;
if (kind === 'local') mkdirSync(dir, { recursive: true });
if (kind === 'local' && token) console.warn('Stockage : STORAGE_URL / STORAGE_TOKEN ignorés en dev — images enregistrées sur le disque local');
if (kind === 'aucun') console.warn('Stockage : STORAGE_URL / STORAGE_TOKEN absents en production — envoi de fichiers désactivé');

const base = url.replace(/\/+$/, '');
const objectUrl = (key: string) => `${base}/api/object/${(prefix + key).split('/').map(encodeURIComponent).join('/')}`;
async function cdn(method: 'PUT' | 'DELETE', key: string, body?: Buffer, mimeType?: string) {
  const r = await fetch(objectUrl(key), {
    method, body: body && new Uint8Array(body), signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}`, ...(mimeType && { 'Content-Type': mimeType }) },
  });
  if (!r.ok && !(method === 'DELETE' && r.status === 404)) throw new Error(`stockage ${method} ${key} : HTTP ${r.status}`);
  return r;
}

// verrou : seules des images WebP (réencodées par le serveur, images.ts) sont stockées — signature RIFF….WEBP et
// extension .webp ; clé faite de segments simples (jamais de « .. » ni de chemin absolu)
const isWebp = (key: string, data: Buffer) =>
  /^[\w-]+(\/[\w-]+)*\.webp$/.test(key) && data.length > 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';

export const storage = {
  kind,
  dir,
  // envois possibles : CDN configuré, ou disque local en dev
  get accepte() { return kind !== 'aucun'; },
  // enregistre une image WebP et renvoie son URL publique
  async put(key: string, data: Buffer): Promise<string> {
    if (kind === 'aucun') throw new Error('stockage : aucun stockage configuré (STORAGE_URL / STORAGE_TOKEN) en production');
    if (!isWebp(key, data)) throw new Error(`stockage : ${key} refusé (seules les images WebP sont acceptées)`);
    if (kind === 'cdn') {
      // l'adresse publique vient du service : sans elle, l'image serait enregistrée sans pouvoir être affichée
      const adresse = ((await (await cdn('PUT', key, data, 'image/webp')).json().catch(() => null)) as { url?: unknown } | null)?.url;
      if (typeof adresse !== 'string' || !adresse) throw new Error(`stockage PUT ${key} : réponse sans adresse publique`);
      // l'adresse est insérée dans les pages (src, href) et autorisée par la CSP pour l'origine de STORAGE_URL seulement
      let publique: URL;
      try { publique = new URL(adresse); } catch { throw new Error(`stockage PUT ${key} : adresse publique invalide`); }
      if (publique.origin !== new URL(base).origin || !/^https?:$/.test(publique.protocol)) throw new Error(`stockage PUT ${key} : adresse publique hors de STORAGE_URL (${publique.origin})`);
      return adresse;
    }
    const file = join(dir, key);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
    return LOCAL_PREFIX + key;
  },
  // supprime un fichier d'après l'URL enregistrée : un fichier local reste local même une fois le CDN activé
  async remove(key: string, publicUrl: string): Promise<void> {
    if (publicUrl.startsWith(LOCAL_PREFIX)) {
      try { unlinkSync(join(dir, key)); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      return;
    }
    // fichier sur le CDN alors que le stockage n'est plus configuré (ou en dev, base copiée de la prod) : échec signalé,
    // la ligne en base est à garder
    if (kind !== 'cdn') throw new Error(`stockage : ${key} est sur le stockage distant, ${config.production ? 'qui n’est pas configuré (STORAGE_URL / STORAGE_TOKEN)' : 'jamais utilisé en dev'}`);
    await cdn('DELETE', key);
  },
};
