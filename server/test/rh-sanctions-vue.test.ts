// ENTREPRISE — lecture des sanctions (sanctions.ts) : grade sous le sien ou la sienne, jamais celle d'un pair ou d'un
// supérieur. Base réelle, lignes « zz-sv » retirées.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu
import { prisma } from '../src/socle/db.js';
import { chargerGrades } from '../src/socle/droits.js';
import { rh } from '../src/entreprise/routes/rh.js';

const GRADES = { direction: { position: 971, permissions: [] }, chef: { position: 972, permissions: ['rh-voir', 'rh-sanctions-voir', 'rh-sanctionner'] }, annuaire: { position: 973, permissions: ['rh-voir'] }, agent: { position: 974, permissions: [] } };
const cle = (n: string) => `zz-sv-${n}`;
const COMPTES = { chef: '990000000000000891', annuaire: '990000000000000892' } as const;
const ids: Record<string, number> = {}, fiches: Record<string, number> = {};
let srv: ReturnType<ReturnType<typeof express>['listen']>, url = '';
const appel = async (profil: string, chemin: string) => (await (await fetch(`${url}${chemin}`, { headers: { 'x-profil': profil } })).json()) as Record<string, any>;

before(async () => {
  await prisma.grade.createMany({ data: Object.entries(GRADES).map(([n, g]) => ({ cle: cle(n), libelle: cle(n), position: g.position, permissions: g.permissions })) });
  await chargerGrades();
  for (const [nom, d] of Object.entries(COMPTES)) ids[nom] = (await prisma.compte.create({ data: { discordId: d, pseudo: `zz-sv-${nom}`, statut: 'valide', gradeCle: cle(nom) } })).id;
  let n = 0;
  for (const [nom, gradeCle, discordId] of [['superieur', cle('direction'), null], ['pair', cle('chef'), null], ['agent', cle('agent'), null], ['soi', cle('chef'), COMPTES.chef]] as const) {
    n += 1;
    fiches[nom] = (await prisma.employe.create({ data: { prenom: 'zz-sv', nom, gradeCle, discordId, idUnique: `99890${n}`, idUniqueNormalise: `99890${n}` } as never })).id;
    await prisma.sanction.create({ data: { employeId: fiches[nom], note: `zz-sv-${nom}` } });
  }
  const app = express();
  app.use((req, _res, next) => { (req as unknown as { session: unknown }).session = { compteId: ids[String(req.get('x-profil'))] }; next(); });
  app.use(rh);
  srv = app.listen(0);
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
after(async () => {
  srv?.close();
  const lie = { where: { employeId: { in: Object.values(fiches) } } };
  await prisma.sanction.deleteMany(lie);
  await prisma.historiqueEmploye.deleteMany(lie);
  await prisma.employe.deleteMany({ where: { prenom: 'zz-sv' } });
  await prisma.compte.deleteMany({ where: { discordId: { in: Object.values(COMPTES) } } });
  await prisma.grade.deleteMany({ where: { cle: { in: Object.keys(GRADES).map(cle) } } });
  await chargerGrades();
  await prisma.$disconnect();
});

test('page Sanctions : les grades sous le sien et la sienne seulement ; on ne retire que sous son grade', async () => {
  const liste = (await appel('chef', '/api/rh/sanctions')).sanctions as { note: string; retirable: boolean }[];
  assert.deepEqual(liste.filter(s => s.note.startsWith('zz-sv')).map(s => [s.note, s.retirable]).sort(), [['zz-sv-agent', true], ['zz-sv-soi', false]]);
});
