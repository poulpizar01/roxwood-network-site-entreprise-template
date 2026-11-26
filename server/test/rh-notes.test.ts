// ENTREPRISE — notes internes d'une fiche (routes/rh.ts, peutLireNotes) : avec le droit seulement, sur un grade sous le
// sien, jamais la sienne ; jamais avec la liste. Base réelle, lignes « zz-notes » retirées.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { entreprise } from '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu
import { prisma } from '../src/socle/db.js';
import { chargerGrades } from '../src/socle/droits.js';
import { declarerParametres } from '../src/socle/parametres.js';
import { rh } from '../src/entreprise/routes/rh.js';

// du plus haut au plus bas : direction, responsable (a le droit), annuaire (ne l'a pas), agent
const GRADES = {
  direction: { position: 951, permissions: [] },
  responsable: { position: 952, permissions: ['rh-voir', 'rh-modifier', 'rh-notes-voir'] },
  annuaire: { position: 953, permissions: ['rh-voir', 'rh-modifier'] },
  agent: { position: 954, permissions: [] },
};
const cle = (n: string) => `zz-notes-${n}`;
const COMPTES = { responsable: '990000000000000821', annuaire: '990000000000000822' } as const;
const ids: Record<string, number> = {}, fiches: Record<string, number> = {};
let srv: ReturnType<ReturnType<typeof express>['listen']>, url = '';

const appel = async (profil: string, methode: string, chemin: string, corps?: object) => {
  const r = await fetch(`${url}${chemin}`, { method: methode, headers: { 'x-profil': profil, 'content-type': 'application/json', origin: 'http://localhost' }, body: corps ? JSON.stringify(corps) : undefined });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
};
const fiche = async (profil: string, nom: string) => (await appel(profil, 'GET', `/api/rh/employes/${fiches[nom]}`)).json;

before(async () => {
  declarerParametres(entreprise.parametres);
  await prisma.grade.createMany({ data: Object.entries(GRADES).map(([n, g]) => ({ cle: cle(n), libelle: cle(n), position: g.position, permissions: g.permissions })) });
  await chargerGrades();
  for (const [nom, d] of Object.entries(COMPTES)) ids[nom] = (await prisma.compte.create({ data: { discordId: d, pseudo: `zz-notes-${nom}`, statut: 'valide', gradeCle: cle(nom) } })).id;
  // « soi » : la fiche du responsable lui-même, saisie à un grade inférieur à celui de son compte
  const modele = { agent: [cle('agent'), null], pair: [cle('responsable'), null], superieur: [cle('direction'), null], soi: [cle('agent'), COMPTES.responsable] } as const;
  let n = 0;
  for (const [nom, [gradeCle, discordId]] of Object.entries(modele)) {
    n += 1;
    fiches[nom] = (await prisma.employe.create({ data: { prenom: 'zz-notes', nom, gradeCle, discordId, notes: `SECRET-${nom}`, idUnique: `99821${n}`, idUniqueNormalise: `99821${n}` } as never })).id;
  }
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { session: unknown }).session = { compteId: ids[String(req.get('x-profil'))] }; next(); });
  app.use(rh);
  srv = app.listen(0);
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
after(async () => {
  srv?.close();
  await prisma.historiqueEmploye.deleteMany({ where: { employeId: { in: Object.values(fiches) } } });
  await prisma.employe.deleteMany({ where: { prenom: 'zz-notes' } });
  await prisma.compte.deleteMany({ where: { discordId: { in: Object.values(COMPTES) } } });
  await prisma.grade.deleteMany({ where: { cle: { in: Object.keys(GRADES).map(cle) } } });
  await chargerGrades();
  await prisma.$disconnect();
});

test('lecture : grade sous le sien seulement, jamais sa propre fiche, jamais avec la liste', async () => {
  assert.equal((await fiche('responsable', 'agent')).notes, 'SECRET-agent');
  for (const nom of ['pair', 'superieur', 'soi']) assert.equal('notes' in await fiche('responsable', nom), false, nom);
  assert.equal('notes' in await fiche('annuaire', 'agent'), false, 'sans le droit');
  assert.doesNotMatch(JSON.stringify((await appel('responsable', 'GET', '/api/rh/employes')).json), /SECRET-/);
});

test('écriture : refusée sans le droit de lire ; le reste de la fiche se modifie toujours', async () => {
  assert.equal((await appel('annuaire', 'PATCH', `/api/rh/employes/${fiches.agent}`, { notes: 'écrasé' })).status, 403);
  assert.equal((await appel('annuaire', 'PATCH', `/api/rh/employes/${fiches.agent}`, { nom: 'agent' })).status, 200);
  assert.equal((await appel('responsable', 'PATCH', `/api/rh/employes/${fiches.agent}`, { notes: 'SECRET-agent-2' })).status, 200);
  assert.equal((await fiche('responsable', 'agent')).notes, 'SECRET-agent-2');
});

test('pièce d’identité : consultée sur un grade sous le sien ou sur soi, jamais envoyée avec la liste', async () => {
  const droits = ['rh-voir', 'rh-modifier', 'rh-notes-voir', 'rh-piece-voir'];
  await prisma.grade.update({ where: { cle: cle('responsable') }, data: { permissions: droits } });
  await chargerGrades();
  await prisma.employe.updateMany({ where: { prenom: 'zz-notes' }, data: { pieceIdentiteCle: 'zz-notes/v', pieceIdentiteUrl: '/uploads/zz-notes/v.webp' } });
  await prisma.employe.update({ where: { id: fiches.soi }, data: { gradeCle: cle('direction') } });
  const vue = async (nom: string) => 'pieceIdentiteUrl' in await fiche('responsable', nom);
  assert.deepEqual([await vue('agent'), await vue('pair'), await vue('superieur'), await vue('soi')], [true, false, false, true]);
  assert.equal('pieceIdentiteUrl' in await fiche('annuaire', 'agent'), false, 'sans le droit');
  assert.doesNotMatch(JSON.stringify((await appel('responsable', 'GET', '/api/rh/employes')).json), /pieceIdentite/);
});
