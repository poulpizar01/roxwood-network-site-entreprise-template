// ENTREPRISE — lecture et écriture séparées en comptabilité (factures, contrats, DOT, paie), avec les vraies clés du site,
// de bout en bout (base réelle, serveur Express éphémère) : un compte qui n'a que « consulter » lit mais ne modifie rien ;
// sans aucune des deux, rien ; chaque « agir » entraîne son « voir ». Lignes préfixées « zz-test », retirées à la fin.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { chargerGrades, completerPermissions } from '../src/socle/droits.js';
import { compta } from '../src/entreprise/routes/compta.js';
import { contrats } from '../src/entreprise/routes/contrats.js';
import { paie } from '../src/entreprise/routes/paie.js';

const LECTEUR = ['factures-voir', 'contrats-voir', 'compta-voir', 'paie-voir'];
const PROFILS = {
  lecteur: { cle: 'zz-test-cl', position: 940, permissions: LECTEUR },
  gestionnaire: { cle: 'zz-test-cg', position: 941, permissions: [...LECTEUR, 'factures', 'contrats', 'compta', 'paie'] },
  aucun: { cle: 'zz-test-ca', position: 942, permissions: [] as string[] },
};
const D = { lecteur: '990000000000000601', gestionnaire: '990000000000000602', aucun: '990000000000000603' } as const;
let srv: ReturnType<ReturnType<typeof express>['listen']>, url = '';
const ids: Record<string, number> = {};

before(async () => {
  await prisma.grade.createMany({ data: Object.values(PROFILS).map(g => ({ cle: g.cle, libelle: g.cle, position: g.position, permissions: g.permissions })) });
  await chargerGrades();
  for (const nom of Object.keys(D) as (keyof typeof D)[])
    ids[nom] = (await prisma.compte.create({ data: { discordId: D[nom], pseudo: `zz-test-${nom}`, statut: 'valide', gradeCle: PROFILS[nom].cle } })).id;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { session: unknown }).session = { compteId: ids[String(req.get('x-profil'))] }; next(); });
  app.use(compta); app.use(contrats); app.use(paie);
  srv = app.listen(0);
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
after(async () => {
  srv?.close();
  await prisma.compte.deleteMany({ where: { discordId: { in: Object.values(D) } } });
  await prisma.grade.deleteMany({ where: { cle: { in: Object.values(PROFILS).map(g => g.cle) } } });
  await chargerGrades();
  await prisma.$disconnect();
});

const appeler = (profil: string, methode: string, chemin: string, corps?: unknown) =>
  fetch(url + chemin, { method: methode, headers: { 'content-type': 'application/json', 'x-profil': profil }, body: corps ? JSON.stringify(corps) : undefined });

// une lecture par domaine, et des écritures dont seule la garde de permission est testée. Un test ne modifie jamais de
// vraies données : pour le profil qui PEUT écrire, on n'envoie que des corps invalides (refusés après la garde) ;
// verrouiller et publier, qui réussiraient sur la semaine en cours, ne sont essayés que par des profils refusés.
const LECTURES = ['/api/compta/factures', '/api/contrats', '/api/compta/tablettes', '/api/compta/dot/resume', '/api/compta/dot/salaries', '/api/compta/dot/graphique', '/api/compta/dot/bareme', '/api/compta/dot/ecritures', '/api/paie/grades', '/api/paie/employes'];
const ECRITURES_SURES: [string, string, unknown][] = [
  ['POST', '/api/compta/factures', {}], ['POST', '/api/contrats', {}], ['POST', '/api/compta/tablettes', { colonnes: [], lignes: [] }],
  ['POST', '/api/compta/dot/ecritures', { type: 'invalide' }], ['PUT', '/api/paie/grades/zz-inexistant/salaire', {}],
];
const ECRITURES_REELLES: [string, string, unknown][] = [['POST', '/api/compta/dot/verrouiller', {}], ['POST', '/api/compta/dot/publier', {}], ['PUT', '/api/compta/dot/solde-bancaire', { montant: 1 }]];

test('chaque permission « agir » entraîne sa permission « voir »', () => {
  for (const cle of ['factures', 'contrats', 'compta', 'paie']) assert.ok(completerPermissions([cle]).includes(`${cle}-voir`), cle);
});

test('consulter permet de lire, jamais d’écrire', async () => {
  for (const chemin of LECTURES) assert.notEqual((await appeler('lecteur', 'GET', chemin)).status, 403, `lecture ${chemin}`);
  for (const [methode, chemin, corps] of [...ECRITURES_SURES, ...ECRITURES_REELLES]) assert.equal((await appeler('lecteur', methode, chemin, corps)).status, 403, `écriture ${methode} ${chemin}`);
});

test('gérer permet d’écrire (la garde de permission ne bloque plus)', async () => {
  for (const [methode, chemin, corps] of ECRITURES_SURES) assert.notEqual((await appeler('gestionnaire', methode, chemin, corps)).status, 403, `écriture ${methode} ${chemin}`);
});

test('sans permission, ni lecture ni écriture', async () => {
  for (const chemin of LECTURES) assert.equal((await appeler('aucun', 'GET', chemin)).status, 403, `lecture ${chemin}`);
  for (const [methode, chemin, corps] of [...ECRITURES_SURES, ...ECRITURES_REELLES]) assert.equal((await appeler('aucun', methode, chemin, corps)).status, 403, `écriture ${methode} ${chemin}`);
});
