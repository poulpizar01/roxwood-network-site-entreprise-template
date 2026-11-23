// ENTREPRISE — lecture et écriture séparées pour le téléphone/RIB et les sanctions (permissions.ts, rh.ts, routes/rh.ts),
// avec les vraies clés du site, de bout en bout (base réelle, serveur Express éphémère) : « consulter » ne donne pas le
// droit de modifier, et chaque « agir » entraîne son « voir ». Lignes préfixées « zz-test », retirées à la fin.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { chargerGrades, completerPermissions } from '../src/socle/droits.js';
import { rh } from '../src/entreprise/routes/rh.js';

// grades de plus en plus bas (position 920+) : chacun porte un droit de plus, aucun ne dépasse l'employé visé
const GRADES = {
  voir: { cle: 'zz-test-lv', position: 920, permissions: ['rh-voir', 'rh-modifier'] },
  lecteur: { cle: 'zz-test-ll', position: 921, permissions: ['rh-voir', 'rh-modifier', 'rh-sensible-voir', 'rh-sanctions-voir'] },
  redacteur: { cle: 'zz-test-lr', position: 922, permissions: ['rh-voir', 'rh-modifier', 'rh-sensible-voir', 'rh-sensible'] },
  employe: { cle: 'zz-test-le', position: 930, permissions: [] as string[] },
};
const COMPTES = { voir: '990000000000000501', lecteur: '990000000000000502', redacteur: '990000000000000503' } as const;
let srv: ReturnType<ReturnType<typeof express>['listen']>, url = '', ficheId = 0;
const ids: Record<string, number> = {};

before(async () => {
  await prisma.grade.createMany({ data: Object.values(GRADES).map(g => ({ cle: g.cle, libelle: g.cle, position: g.position, permissions: g.permissions })) });
  await chargerGrades();
  for (const [nom, d] of Object.entries(COMPTES)) ids[nom] = (await prisma.compte.create({ data: { discordId: d, pseudo: `zz-test-${nom}`, statut: 'valide', gradeCle: GRADES[nom as keyof typeof COMPTES].cle } })).id;
  ficheId = (await prisma.employe.create({ data: { idUnique: 'zz-test-droits', idUniqueNormalise: 'zz-test-droits', prenom: 'Test', nom: 'Droits', gradeCle: GRADES.employe.cle, telephone: '555-0100', rib: 'RIB-0100' } })).id;
  const app = express();
  app.use(express.json());
  // le compte agissant est choisi par un en-tête : un seul serveur pour tous les profils
  app.use((req, _res, next) => { (req as unknown as { session: unknown }).session = { compteId: ids[String(req.get('x-profil'))] }; next(); });
  app.use(rh);
  srv = app.listen(0);
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
after(async () => {
  srv?.close();
  await prisma.employe.deleteMany({ where: { idUnique: 'zz-test-droits' } });
  await prisma.compte.deleteMany({ where: { discordId: { in: Object.values(COMPTES) } } });
  await prisma.grade.deleteMany({ where: { cle: { in: Object.values(GRADES).map(g => g.cle) } } });
  await chargerGrades();
  await prisma.$disconnect();
});

const appeler = (profil: string, methode: string, chemin: string, corps?: unknown) =>
  fetch(url + chemin, { method: methode, headers: { 'content-type': 'application/json', 'x-profil': profil }, body: corps ? JSON.stringify(corps) : undefined });

test('chaque permission « agir » entraîne sa permission « voir »', () => {
  assert.ok(completerPermissions(['rh-sensible']).includes('rh-sensible-voir'));
  assert.ok(completerPermissions(['rh-sanctionner']).includes('rh-sanctions-voir'));
  assert.ok(completerPermissions(['rh-sanctions-voir']).includes('rh-voir'), 'la page Sanctions liste aussi les employés');
});

test('le téléphone et le RIB ne s’envoient qu’avec rh-sensible-voir', async () => {
  const fiche = async (profil: string) => (await (await appeler(profil, 'GET', `/api/rh/employes/${ficheId}`)).json());
  assert.equal((await fiche('voir')).telephone, undefined, 'rh-voir seul : rien');
  assert.equal((await fiche('lecteur')).telephone, '555-0100');
  assert.equal((await fiche('lecteur')).rib, 'RIB-0100');
});

test('lire le téléphone ne donne pas le droit de le modifier', async () => {
  assert.equal((await appeler('lecteur', 'PATCH', `/api/rh/employes/${ficheId}`, { telephone: '000' })).status, 403);
  assert.equal((await prisma.employe.findUniqueOrThrow({ where: { id: ficheId } })).telephone, '555-0100');
  assert.equal((await appeler('redacteur', 'PATCH', `/api/rh/employes/${ficheId}`, { telephone: '555-0199' })).status, 200);
  assert.equal((await prisma.employe.findUniqueOrThrow({ where: { id: ficheId } })).telephone, '555-0199');
});

test('la page Sanctions se consulte avec rh-sanctions-voir, pas avec rh-voir seul', async () => {
  assert.equal((await appeler('voir', 'GET', '/api/rh/sanctions')).status, 403);
  const r = await appeler('lecteur', 'GET', '/api/rh/sanctions');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).peutSanctionner, false, 'consulter ne donne pas sanctionner');
});
