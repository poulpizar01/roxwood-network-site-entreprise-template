// ENTREPRISE — relevé Tablettes par semaine (routes/compta.ts, dot.ts), de bout en bout (base réelle, serveur Express
// éphémère) : un relevé n'appartient qu'à sa semaine, un tableau ambigu est refusé, une semaine verrouillée est figée.
// Semaines de 2020 et lignes préfixées « zz-test » : sans effet sur les données de démonstration, retirées à la fin.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { chargerGrades } from '../src/socle/droits.js';
import { compta } from '../src/entreprise/routes/compta.js';

const S1 = '2020-01-06', S2 = '2020-01-13', S_VERROUILLEE = '2020-01-20';   // trois lundis
let srv: ReturnType<ReturnType<typeof express>['listen']>, url = '';

before(async () => {
  await prisma.grade.create({ data: { cle: 'zz-test-dot', libelle: 'Test DOT', position: 910, permissions: ['compta-voir', 'compta'] } });
  await chargerGrades();
  const acteur = await prisma.compte.create({ data: { discordId: '990000000000000401', pseudo: 'zz-test-dot', statut: 'valide', gradeCle: 'zz-test-dot' } });
  await prisma.declarationDot.create({ data: { semaine: new Date(`${S_VERROUILLEE}T00:00:00Z`), statut: 'validee', resume: {}, salaries: {}, ecritures: [] } });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { session: unknown }).session = { compteId: acteur.id }; next(); });
  app.use(compta);
  srv = app.listen(0);
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
after(async () => {
  srv?.close();
  const semaines = [S1, S2, S_VERROUILLEE].map(s => new Date(`${s}T00:00:00Z`));
  await prisma.importCompta.deleteMany({ where: { semaine: { in: semaines } } });
  await prisma.declarationDot.deleteMany({ where: { semaine: { in: semaines } } });
  await prisma.compte.deleteMany({ where: { discordId: '990000000000000401' } });
  await prisma.grade.deleteMany({ where: { cle: 'zz-test-dot' } });
  await chargerGrades();
  await prisma.$disconnect();
});

const appeler = (methode: string, chemin: string, corps?: unknown) =>
  fetch(url + chemin, { method: methode, headers: { 'content-type': 'application/json' }, body: corps ? JSON.stringify(corps) : undefined });
const releve = (extra: Record<string, unknown> = {}) => ({
  colonnes: ['Nom', 'Ventes'], lignes: [['zz-test Alice', '1000'], ['zz-test Bob', '500'], ['TOTAL', '1500']], semaine: S1, ...extra,
});

test('un relevé n’appartient qu’à sa semaine : une autre semaine n’en voit pas', async () => {
  assert.equal((await appeler('POST', '/api/compta/tablettes', releve())).status, 200);
  const s1 = await (await appeler('GET', `/api/compta/tablettes?semaine=${S1}`)).json();
  assert.equal(s1.import.lignes.length, 3);
  const s2 = await (await appeler('GET', `/api/compta/tablettes?semaine=${S2}`)).json();
  assert.equal(s2.import, null, 'la semaine suivante n’emprunte rien à la précédente');
  assert.equal(s2.ca_brut, null);
});

test('retirer une ligne ou réinitialiser ne touche que la semaine demandée', async () => {
  await appeler('POST', '/api/compta/tablettes', releve({ semaine: S2 }));
  assert.equal((await appeler('DELETE', `/api/compta/tablettes?semaine=${S2}`)).status, 200);
  assert.equal((await (await appeler('GET', `/api/compta/tablettes?semaine=${S2}`)).json()).import, null, 'S2 vidée');
  assert.equal((await (await appeler('GET', `/api/compta/tablettes?semaine=${S1}`)).json()).import.lignes.length, 3, 'S1 intacte');
});

test('un tableau ambigu est refusé : titre vide au milieu, titre en double, membre en double', async () => {
  assert.equal((await appeler('POST', '/api/compta/tablettes', releve({ colonnes: ['Nom', '', 'Ventes'], lignes: [['zz-test A', '1', '2']] }))).status, 400);
  assert.equal((await appeler('POST', '/api/compta/tablettes', releve({ colonnes: ['Nom', 'nom'], lignes: [['zz-test A', '1']] }))).status, 400);
  assert.equal((await appeler('POST', '/api/compta/tablettes', releve({ lignes: [['zz-test A', '1'], ['zz-test a', '2']] }))).status, 400);
  // un titre vide en fin de ligne est écarté sans erreur (colonne parasite d'un collage)
  assert.equal((await appeler('POST', '/api/compta/tablettes', releve({ colonnes: ['Nom', 'Ventes', ''], lignes: [['zz-test A', '1', '']] }))).status, 200);
});

test('un relevé ne s’écrit pas sur une semaine à venir (refusé, pas ramené en silence à la semaine en cours)', async () => {
  const avenir = '2099-01-05';
  assert.equal((await appeler('POST', '/api/compta/tablettes', releve({ semaine: avenir }))).status, 400);
  assert.equal((await appeler('DELETE', `/api/compta/tablettes?semaine=${avenir}`)).status, 400);
});

test('une semaine verrouillée est figée : import, retrait et réinitialisation refusés', async () => {
  assert.equal((await appeler('POST', '/api/compta/tablettes', releve({ semaine: S_VERROUILLEE }))).status, 409);
  assert.equal((await appeler('DELETE', `/api/compta/tablettes?semaine=${S_VERROUILLEE}`)).status, 409);
  assert.equal((await appeler('DELETE', `/api/compta/tablettes/lignes/0?semaine=${S_VERROUILLEE}`, { nom: 'x' })).status, 409);
  assert.equal((await (await appeler('GET', `/api/compta/tablettes?semaine=${S_VERROUILLEE}`)).json()).verrouillee, true);
});
