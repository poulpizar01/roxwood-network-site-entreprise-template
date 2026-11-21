// SOCLE — chiffrement des clés d'abonnement webhook (une par type d'événement, voir contrat.ts → webhooks et
// routes/webhooks-abonnements.ts). AES-256-GCM, module « crypto » natif de Node, pas de dépendance.
// Clé maîtresse : secret Docker monté en lecture seule, SEULEMENT dans le conteneur app (jamais db/db-roles/backup,
// jamais en base, jamais dans les sauvegardes) — voir compose.yaml et server/README.md. Perdue ou changée : les clés
// déjà enregistrées redeviennent illisibles (l'abonnement retombe « Non configuré », il suffit de le recréer), sans
// copie de secours.
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { fail } from './config.js';

const CHEMIN_CLE = process.env.CLE_MAITRESSE_FICHIER || '/run/secrets/cle_maitresse';

function lireCleMaitresse(): Buffer {
  let hex: string;
  try { hex = readFileSync(CHEMIN_CLE, 'utf8').trim(); }
  catch {
    fail(`Clé maîtresse de chiffrement introuvable (${CHEMIN_CLE}). À créer une seule fois, avant le premier démarrage :\n  mkdir -p secrets && umask 077 && openssl rand -hex 32 > secrets/cle-maitresse\npuis relancer.`);
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) fail(`Clé maîtresse de chiffrement mal formée (${CHEMIN_CLE}) : 64 caractères hexadécimaux attendus (openssl rand -hex 32).`);
  return Buffer.from(hex, 'hex');
}
// lue une seule fois, au premier import (donc au démarrage du serveur : il refuse de démarrer sans elle, comme les
// autres variables de config.ts)
const CLE = lireCleMaitresse();

export type Chiffre = { chiffre: string; nonce: string; empreinte: string };

// chiffre une valeur en clair (la clé secrète donnée par le bot). aad (« associated data ») lie le résultat à sa
// ligne — ici le type d'événement : un chiffré recopié sur la ligne d'un autre type ne se déchiffre plus (empêche de
// faire accepter l'événement d'un type par la clé d'un autre). empreinte : identifie la valeur sans jamais la
// reconstituer (affichée dans l'historique, jamais la clé elle-même).
export function chiffrer(valeur: string, aad: string): Chiffre {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', CLE, nonce);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const corps = Buffer.concat([c.update(valeur, 'utf8'), c.final()]);
  return {
    chiffre: Buffer.concat([corps, c.getAuthTag()]).toString('base64'),
    nonce: nonce.toString('base64'),
    empreinte: crypto.createHash('sha256').update(valeur).digest('hex').slice(0, 12),
  };
}

// déchiffre, ou null si l'aad ne correspond pas, si la ligne a été altérée, ou si la clé maîtresse a changé depuis
export function dechiffrer(c: Chiffre, aad: string): string | null {
  try {
    const donnees = Buffer.from(c.chiffre, 'base64');
    const tag = donnees.subarray(donnees.length - 16), corps = donnees.subarray(0, donnees.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', CLE, Buffer.from(c.nonce, 'base64'));
    d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(corps), d.final()]).toString('utf8');
  } catch { return null; }
}
