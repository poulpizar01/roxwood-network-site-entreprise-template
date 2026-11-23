// ENTREPRISE — hiérarchie des grades sur les routes RH (routes/rh.ts), vérifiée de bout en bout (base réelle, serveur
// Express éphémère) : fin de service, sanctions et réactivation ne touchent qu'une fiche d'un grade sous celui de
// l'acteur, et le grade d'un compte supérieur ne se change pas depuis sa fiche. Lignes de test préfixées « zz-test ».
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { prisma } from '../src/socle/db.js';
import { chargerGrades } from '../src/socle/droits.js';
import { definirReglage } from '../src/socle/reglages.js';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { rh } from '../src/entreprise/routes/rh.js';

const GRADES = { sup: 'zz-test-sup', acteur: 'zz-test-act', bas: 'zz-test-bas' };
const D = { acteur: '990000000000000101', sup: '990000000000000102', bas: '990000000000000103' };
let srv: ReturnType<ReturnType<typeof express>['listen']>, url = '';
let ficheSup = 0, ficheBas = 0, sanctionSup = 0, typeId = 0;

before(async () => {
  await prisma.grade.createMany({ data: [
    { cle: GRADES.sup, libelle: 'Test sup', position: 899, permissions: [] },
    { cle: GRADES.acteur, libelle: 'Test acteur', position: 900, permissions: ['rh-voir', 'rh-modifier', 'rh-sanctionner', 'rh-reactiver', 'rh-creer', 'comptes'] },
    { cle: GRADES.bas, libelle: 'Test bas', position: 901, permissions: [] },
  ] });
  await chargerGrades();
  const acteur = await prisma.compte.create({ data: { discordId: D.acteur, pseudo: 'zz-test-acteur', statut: 'valide', gradeCle: GRADES.acteur } });
  await prisma.compte.create({ data: { discordId: D.sup, pseudo: 'zz-test-sup', statut: 'valide', gradeCle: GRADES.sup } });
  const fiche = (idUnique: string, gradeCle: string, extra = {}) =>
    prisma.employe.create({ data: { idUnique, idUniqueNormalise: idUnique, prenom: 'Test', nom: idUnique, gradeCle, ...extra } });
  ficheSup = (await fiche('zz-test-1', GRADES.sup)).id;
  ficheBas = (await fiche('zz-test-2', GRADES.bas)).id;
  // fiche inactive d'un grade bas reliée au compte supérieur : la réactiver lui donnerait le grade bas
  await fiche('zz-test-3', GRADES.bas, { statut: 'inactif', discordId: D.sup, dateDepart: new Date() });
  // un service ouvert à terminer (sans lui, terminerServiceDe répond 404, ce qui masquerait la règle testée)
  await prisma.service.createMany({ data: [ficheSup, ficheBas].map((employeId, i) => ({ serviceId: `zz-test-s${i}`, employeNom: 'Test', employeId, debut: new Date() })) });
  // fiche inactive dont le grade a été supprimé depuis (aucun grade de ce nom)
  await fiche('zz-test-4', 'zz-test-fantome', { statut: 'inactif', dateDepart: new Date() });
  typeId = (await prisma.typeSanction.create({ data: { nom: 'zz-test', couleur: '#aa0000' } })).id;
  sanctionSup = (await prisma.sanction.create({ data: { employeId: ficheSup, typeId, note: 'zz-test' } })).id;

  // candidature du bot en suspens d'une personne dont le compte (grade supérieur) existe déjà : la traiter la rétrograderait
  await prisma.arriveeBot.create({ data: { ticketId: 'zz-test-ticket', discordId: D.sup, resultat: 'en_attente', accepteLe: '2026-11-01' } });
  await definirReglage('rh.grade_arrivee', GRADES.bas);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { session: unknown }).session = { compteId: acteur.id }; next(); });
  app.use(rh);
  srv = app.listen(0);
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});

after(async () => {
  srv?.close();
  await prisma.arriveeBot.deleteMany({ where: { ticketId: 'zz-test-ticket' } });
  await definirReglage('rh.grade_arrivee', '');
  await prisma.sanction.deleteMany({ where: { OR: [{ employeId: { in: [ficheSup, ficheBas] } }, { note: 'zz-test' }] } });
  await prisma.typeSanction.deleteMany({ where: { nom: 'zz-test' } });
  await prisma.service.deleteMany({ where: { employeId: { in: [ficheSup, ficheBas] } } });
  await prisma.employe.deleteMany({ where: { idUnique: { startsWith: 'zz-test' } } });
  await prisma.compte.deleteMany({ where: { discordId: { in: Object.values(D) } } });
  await prisma.grade.deleteMany({ where: { cle: { in: Object.values(GRADES) } } });
  await chargerGrades();
  await prisma.$disconnect();
});

const appeler = (methode: string, chemin: string, corps?: unknown) =>
  fetch(url + chemin, { method: methode, headers: { 'content-type': 'application/json' }, body: corps ? JSON.stringify(corps) : undefined });

test('terminer le service : refusé sur la fiche d’un grade supérieur, accepté sous le sien', async () => {
  assert.equal((await appeler('POST', `/api/rh/employes/${ficheSup}/service/terminer`)).status, 403);
  assert.equal((await prisma.service.findFirstOrThrow({ where: { employeId: ficheSup } })).fin, null, 'le service du supérieur reste ouvert');
  assert.equal((await appeler('POST', `/api/rh/employes/${ficheBas}/service/terminer`)).status, 200);
  assert.equal((await appeler('POST', '/api/rh/employes/999999999/service/terminer')).status, 404);
});

test('sanctions : ni ajout ni retrait sur la fiche d’un grade supérieur', async () => {
  assert.equal((await appeler('POST', `/api/rh/employes/${ficheSup}/sanctions`, { typeId, note: 'zz-test' })).status, 403);
  assert.equal((await appeler('DELETE', `/api/rh/employes/${ficheSup}/sanctions/${sanctionSup}`)).status, 403);
  assert.ok(await prisma.sanction.findUnique({ where: { id: sanctionSup } }), 'la sanction du supérieur existe encore');
  assert.equal((await appeler('POST', `/api/rh/employes/${ficheBas}/sanctions`, { typeId, note: 'zz-test' })).status, 201);
});

test('réactiver une fiche reliée à un compte supérieur ne change pas le grade de ce compte', async () => {
  const fiche = await prisma.employe.findFirstOrThrow({ where: { idUnique: 'zz-test-3' } });
  const r = await appeler('POST', `/api/rh/employes/${fiche.id}/reactiver`);
  assert.equal(r.status, 403);
  assert.equal((await prisma.compte.findUniqueOrThrow({ where: { discordId: D.sup } })).gradeCle, GRADES.sup);
  assert.equal((await prisma.employe.findUniqueOrThrow({ where: { id: fiche.id } })).statut, 'inactif');
});

test('réactiver une fiche dont le grade n’existe plus est refusé', async () => {
  const fiche = await prisma.employe.findFirstOrThrow({ where: { idUnique: 'zz-test-4' } });
  assert.equal((await appeler('POST', `/api/rh/employes/${fiche.id}/reactiver`)).status, 400);
  assert.equal((await prisma.employe.findUniqueOrThrow({ where: { id: fiche.id } })).statut, 'inactif');
});

test('PATCH du statut sur une fiche dont le grade n’existe plus est refusé comme /reactiver', async () => {
  const fiche = await prisma.employe.findFirstOrThrow({ where: { idUnique: 'zz-test-4' } });
  assert.equal((await appeler('PATCH', `/api/rh/employes/${fiche.id}`, { statut: 'actif' })).status, 400);
  assert.equal((await prisma.employe.findUniqueOrThrow({ where: { id: fiche.id } })).statut, 'inactif');
});

test('traiter une candidature du bot ne rétrograde pas un compte supérieur déjà relié à ce Discord', async () => {
  const a = await prisma.arriveeBot.findUniqueOrThrow({ where: { ticketId: 'zz-test-ticket' } });
  assert.equal((await appeler('POST', `/api/rh/bot/arrivees/${a.id}/traiter`)).status, 403);
  assert.equal((await prisma.compte.findUniqueOrThrow({ where: { discordId: D.sup } })).gradeCle, GRADES.sup);
  assert.equal((await prisma.arriveeBot.findUniqueOrThrow({ where: { id: a.id } })).resultat, 'en_attente');
});
