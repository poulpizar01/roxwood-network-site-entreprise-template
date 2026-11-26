// ENTREPRISE — historique de fiche, notes et pièce d'identité (rh.ts, routes/rh.ts) : lignes d'historique écrites par le
// serveur, pièce remplacée/retirée sans fichier orphelin, purge 90 jours après le départ, droits de lecture et d'écriture
// séparés. Base réelle, lignes préfixées « zz-test » retirées à la fin.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { chargerGrades } from '../src/socle/droits.js';
import { rh } from '../src/entreprise/routes/rh.js';
import { changerPieceIdentite, supprimerFiche, fichePublique, historiqueDe, lignesHistorique, purgerPiecesIdentite } from '../src/entreprise/rh.js';
import type { Employe } from '../src/generated/prisma/client.js';

const GRADES = {
  lecteur: { cle: 'zz-test-hl', position: 940, permissions: ['rh-voir'] },
  piece: { cle: 'zz-test-hp', position: 941, permissions: ['rh-voir', 'rh-piece-voir', 'rh-piece'] },
  employe: { cle: 'zz-test-he', position: 950, permissions: [] as string[] },
};
const COMPTES = { lecteur: '990000000000000601', piece: '990000000000000602' } as const;
const ids: Record<string, number> = {};
let srv: ReturnType<ReturnType<typeof express>['listen']>, url = '';
const image = (n: string) => ({ cle: `zz-test-${n}`, url: `https://x.test/${n}.webp`, cleMini: `zz-test-${n}-m`, urlMini: `https://x.test/${n}-m.webp`, largeur: 10, hauteur: 10 });
const fiches: number[] = [];
const creer = async (idu: string, extra: object = {}) => {
  const f = await prisma.employe.create({ data: { idUnique: idu, idUniqueNormalise: idu, prenom: 'Test', nom: 'Fiche', gradeCle: GRADES.employe.cle, ...extra } });
  fiches.push(f.id); return f;
};

before(async () => {
  await prisma.grade.createMany({ data: Object.values(GRADES).map(g => ({ cle: g.cle, libelle: g.cle, position: g.position, permissions: g.permissions })) });
  await chargerGrades();
  for (const [nom, d] of Object.entries(COMPTES)) ids[nom] = (await prisma.compte.create({ data: { discordId: d, pseudo: `zz-test-${nom}`, statut: 'valide', gradeCle: GRADES[nom as keyof typeof COMPTES].cle } })).id;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { session: unknown }).session = { compteId: ids[String(req.get('x-profil'))] }; next(); });
  app.use(rh);
  srv = app.listen(0);
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
after(async () => {
  srv?.close();
  await prisma.historiqueEmploye.deleteMany({ where: { employeId: { in: fiches } } });
  await prisma.imageRetiree.deleteMany({ where: { cle: { startsWith: 'zz-test' } } });
  await prisma.employe.deleteMany({ where: { id: { in: fiches } } });
  await prisma.compte.deleteMany({ where: { discordId: { in: Object.values(COMPTES) } } });
  await prisma.grade.deleteMany({ where: { cle: { in: Object.values(GRADES).map(g => g.cle) } } });
  await chargerGrades();
  await prisma.$disconnect();
});

test('l’historique dit ce qui change, sans la valeur du téléphone, du RIB ni des notes', async () => {
  const avant = await creer('zz-test-h1', { telephone: '1', rib: 'a', notes: 'x' });
  assert.deepEqual(lignesHistorique(avant, { telephone: '2', rib: 'b', notes: 'y' } as Partial<Employe>).map(l => l.texte), ['Téléphone modifié', 'RIB modifié', 'Notes internes modifiées']);
  assert.deepEqual(lignesHistorique(avant, { telephone: '1', notes: 'x' } as Partial<Employe>), [], 'une valeur identique n’écrit rien');
  const depart = lignesHistorique(avant, { statut: 'inactif', dateDepart: new Date('2026-11-02') } as Partial<Employe>);
  assert.deepEqual(depart.map(l => l.texte), ['Départ enregistré (02/11/2026)'], 'un départ n’écrit pas aussi « dates modifiées »');
  assert.equal(lignesHistorique(avant, { prenom: 'Autre' } as Partial<Employe>)[0].texte, 'Identité modifiée (prénom)');
});

test('pièce d’identité : ajout, remplacement et retrait sont tracés, l’ancienne image va au nettoyage', async () => {
  const f = await creer('zz-test-h2');
  await changerPieceIdentite(f.id, image('a'), 'Testeur');
  await changerPieceIdentite(f.id, image('b'), 'Testeur');
  assert.equal((await prisma.imageRetiree.count({ where: { cle: 'zz-test-a' } })), 1, 'l’image remplacée est en file de nettoyage');
  await changerPieceIdentite(f.id, null, 'Testeur');
  await changerPieceIdentite(f.id, null, 'Testeur');   // déjà retirée : sans effet ni ligne en plus
  assert.equal((await prisma.imageRetiree.count({ where: { cle: 'zz-test-b' } })), 1);
  assert.equal((await prisma.employe.findUniqueOrThrow({ where: { id: f.id } })).pieceIdentiteUrl, null);
  assert.deepEqual((await historiqueDe(f.id)).map(h => h.texte).reverse(), ['Pièce d’identité ajoutée', 'Pièce d’identité remplacée', 'Pièce d’identité retirée']);
});

test('la pièce d’un employé parti depuis plus de 90 jours est effacée, pas celle d’un départ récent ni d’un actif', async () => {
  const jour = (n: number) => new Date(Date.now() - n * 24 * 3600e3);
  const ancien = await creer('zz-test-h3', { statut: 'inactif', dateDepart: jour(100) });
  const recent = await creer('zz-test-h4', { statut: 'inactif', dateDepart: jour(30) });
  const actif = await creer('zz-test-h5');
  for (const [f, n] of [[ancien, 'c'], [recent, 'd'], [actif, 'e']] as const) await changerPieceIdentite(f.id, image(n), 'Testeur');
  await purgerPiecesIdentite();
  const lire = async (id: number) => (await prisma.employe.findUniqueOrThrow({ where: { id } })).pieceIdentiteUrl;
  assert.equal(await lire(ancien.id), null);
  assert.ok(await lire(recent.id));
  assert.ok(await lire(actif.id));
  assert.equal((await prisma.imageRetiree.count({ where: { cle: 'zz-test-c' } })), 1);
  assert.match((await historiqueDe(ancien.id))[0].texte, /effacée \(90 jours/);
});

test('une fiche réintégrée entre la lecture et le verrou garde sa pièce (garde de la purge)', async () => {
  const limite = new Date(Date.now() - 90 * 24 * 3600e3);
  const f = await creer('zz-test-h8', { statut: 'actif' });
  await changerPieceIdentite(f.id, image('g'), 'Testeur');
  await changerPieceIdentite(f.id, null, 'Automatique', 'x', limite);   // fiche active : la garde refuse
  assert.ok((await prisma.employe.findUniqueOrThrow({ where: { id: f.id } })).pieceIdentiteUrl);
  await prisma.employe.update({ where: { id: f.id }, data: { statut: 'inactif' } });   // inactive mais sans date de départ : jamais purgée
  await purgerPiecesIdentite();
  assert.ok((await prisma.employe.findUniqueOrThrow({ where: { id: f.id } })).pieceIdentiteUrl);
});

test('l’adresse de la pièce n’est jamais jointe à la fiche de liste, même avec rh-piece-voir', async () => {
  const f = await creer('zz-test-h6');
  await changerPieceIdentite(f.id, image('f'), 'Testeur');
  const e = await prisma.employe.findUniqueOrThrow({ where: { id: f.id } });
  assert.equal('pieceIdentiteUrl' in fichePublique(e, new Set(['voir'])), false);
  assert.equal('pieceIdentiteUrl' in fichePublique(e, new Set(['voir', 'piece-voir'])), false);   // elle suit la hiérarchie (peutVoirPiece, fiche détaillée)
});

test('routes : sans rh-piece on ne pose ni ne retire la pièce, rh-voir lit l’historique', async () => {
  const f = await creer('zz-test-h7');
  const appel = (profil: string, methode: string, chemin: string) => fetch(`${url}${chemin}`, { method: methode, headers: { 'x-profil': profil } });
  assert.equal((await appel('lecteur', 'POST', `/api/rh/employes/${f.id}/piece-identite`)).status, 403);
  assert.equal((await appel('lecteur', 'DELETE', `/api/rh/employes/${f.id}/piece-identite`)).status, 403);
  assert.equal((await appel('lecteur', 'GET', `/api/rh/employes/${f.id}/historique`)).status, 200);
  assert.equal((await appel('piece', 'DELETE', `/api/rh/employes/${f.id}/piece-identite`)).status, 200);
  assert.equal((await appel('piece', 'GET', '/api/rh/employes/999999999/historique')).status, 404);
  // l'historique ne révèle pas la pièce à qui ne peut pas la voir
  await changerPieceIdentite(f.id, image('h'), 'Testeur');
  const textes = async (profil: string) => ((await (await appel(profil, 'GET', `/api/rh/employes/${f.id}/historique`)).json()) as { historique: { texte: string }[] }).historique.map(h => h.texte);
  assert.equal((await textes('lecteur')).some(t => t.includes('Pièce')), false);
  assert.equal((await textes('piece')).some(t => t.includes('Pièce')), true);
});

test('supprimer une fiche : efface l’identité, semaine verrouillée effacée, semaine ouverte détachée, met la pièce en nettoyage', async () => {
  const f = await creer('zz-test-h9');
  await changerPieceIdentite(f.id, image('s'), 'Testeur');
  const ancienne = new Date('2020-03-04T12:00:00Z');   // semaine verrouillée pour l'occasion
  await prisma.declarationDot.create({ data: { semaine: new Date('2020-03-02'), statut: 'auto', resume: {}, salaries: [], ecritures: [] } });
  const fa = await prisma.facture.create({ data: { source: 'manuel', clientNom: 'zz-test-sup', employeId: f.id } });
  const fv = await prisma.facture.create({ data: { source: 'manuel', clientNom: 'zz-test-sup', employeId: f.id, dateFacture: ancienne } });
  try {
    await supprimerFiche(f.id);
    assert.equal(await prisma.employe.count({ where: { id: f.id } }), 0);
    assert.equal(await prisma.historiqueEmploye.count({ where: { employeId: f.id } }), 0);
    assert.equal((await prisma.facture.findUniqueOrThrow({ where: { id: fa.id } })).employeId, null, 'semaine ouverte : la facture reste, sans nom');
    assert.equal(await prisma.facture.count({ where: { id: fv.id } }), 0, 'semaine verrouillée : effacée');
    assert.equal(await prisma.imageRetiree.count({ where: { cle: 'zz-test-s' } }), 1);
    await assert.rejects(supprimerFiche(f.id), /introuvable/);
  } finally { await prisma.facture.deleteMany({ where: { id: { in: [fa.id, fv.id] } } }); await prisma.declarationDot.deleteMany({ where: { semaine: new Date('2020-03-02') } }); }
});
