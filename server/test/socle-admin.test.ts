// SOCLE — Administrateur (permission « admin ») : toutes les permissions, mais la hiérarchie reste ; seul qui l'a peut
// l'accorder. Base réelle, lignes « zz-admin » retirées.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { entreprise } from '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu
import { prisma } from '../src/socle/db.js';
import { auDessusDe, chargerGrades, CLES_PERMISSIONS, estAdmin, permissionsDe, peut } from '../src/socle/droits.js';
import { comptes } from '../src/socle/routes/comptes.js';
import { grades } from '../src/socle/routes/grades.js';

// du plus haut au plus bas ; « gestion » a tout ce qu'il faut pour gérer, sauf Administrateur
const GRADES = {
  gestion: { position: 961, permissions: ['comptes', 'grades'] },
  admin: { position: 962, permissions: ['admin'] },
  agent: { position: 963, permissions: [] },
};
const cle = (n: string) => `zz-admin-${n}`;
const DISCORD = { gestion: '990000000000000941', admin: '990000000000000942', agent: '990000000000000943' } as const;
const ids: Record<string, number> = {};
let srv: ReturnType<ReturnType<typeof express>['listen']>, url = '';

const appel = async (qui: string, methode: string, chemin: string, corps?: object) =>
  (await fetch(`${url}${chemin}`, { method: methode, headers: { 'x-qui': qui, 'content-type': 'application/json', origin: 'http://localhost' }, body: corps ? JSON.stringify(corps) : undefined })).status;
const compte = (qui: keyof typeof DISCORD) => ({ gradeCle: cle(qui), proprietaire: false });
const nettoyer = async () => {
  await prisma.compte.deleteMany({ where: { discordId: { in: Object.values(DISCORD) } } });
  await prisma.grade.deleteMany({ where: { cle: { startsWith: 'zz-admin-' } } });
};

before(async () => {
  await nettoyer();
  await prisma.grade.createMany({ data: Object.entries(GRADES).map(([n, g]) => ({ cle: cle(n), libelle: cle(n), position: g.position, permissions: g.permissions })) });
  await chargerGrades();
  for (const [qui, d] of Object.entries(DISCORD)) ids[qui] = (await prisma.compte.create({ data: { discordId: d, pseudo: `zz-admin-${qui}`, statut: 'valide', gradeCle: cle(qui) } })).id;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { session: unknown }).session = { compteId: ids[String(req.get('x-qui'))] }; next(); });
  app.use(comptes, grades);
  srv = app.listen(0);
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  assert.ok(entreprise);
});
after(async () => { srv.close(); await nettoyer(); await prisma.$disconnect(); });

test('toutes les permissions, sans la hiérarchie', () => {
  assert.deepEqual(permissionsDe(compte('admin')), new Set(CLES_PERMISSIONS));
  assert.ok(estAdmin(compte('admin')) && peut(compte('admin'), 'parametres'));
  assert.ok(!estAdmin(compte('gestion')) && !peut(compte('gestion'), 'parametres'));
  assert.ok(auDessusDe(compte('admin'), cle('agent')));
  assert.ok(!auDessusDe(compte('admin'), cle('admin')), 'jamais son propre grade');
  assert.ok(!auDessusDe(compte('admin'), cle('gestion')), 'jamais un grade au-dessus');
});

test('un Administrateur gère sous lui, y compris ce droit, et rien au-dessus', async () => {
  assert.equal(await appel('admin', 'PATCH', `/api/grades/${cle('agent')}`, { permissions: ['admin'] }), 200);
  assert.equal(await appel('admin', 'PATCH', `/api/grades/${cle('agent')}`, { permissions: [] }), 200);
  assert.equal(await appel('admin', 'PATCH', `/api/grades/${cle('gestion')}`, { libelle: 'x' }), 403);
  assert.equal(await appel('admin', 'PATCH', `/api/grades/${cle('admin')}`, { libelle: 'x' }), 403);
  assert.equal(await appel('admin', 'PATCH', `/api/comptes/${ids.gestion}`, { grade: null }), 403);
});

test('sans l’être, même placé au-dessus : on ne donne ni ne retire Administrateur', async () => {
  assert.equal(await appel('gestion', 'PATCH', `/api/grades/${cle('agent')}`, { permissions: ['admin'] }), 403);
  assert.equal(await appel('gestion', 'PATCH', `/api/grades/${cle('admin')}`, { permissions: [] }), 403);
  assert.equal(await appel('gestion', 'POST', '/api/grades', { libelle: 'zz-admin-neuf', cle: 'zz-admin-neuf', permissions: ['admin'] }), 403);
  assert.equal(await appel('gestion', 'PATCH', `/api/comptes/${ids.agent}`, { grade: cle('admin') }), 403);
});
