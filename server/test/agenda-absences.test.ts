// ENTREPRISE — décision sur une absence (routes/agenda.ts) : le refus garde l'absence avec son motif et prévient l'auteur,
// elle n'est plus modifiable, deux décisions simultanées ne passent pas deux fois. Base réelle, lignes « zz-test » retirées.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { chargerGrades } from '../src/socle/droits.js';
import { agenda } from '../src/entreprise/routes/agenda.js';

const GRADES = { direction: { cle: 'zz-test-ad', position: 940 }, employe: { cle: 'zz-test-ae', position: 950 } };
const COMPTES = { direction: '990000000000000801', auteur: '990000000000000802', autre: '990000000000000803' } as const;
const ids: Record<string, number> = {};
let srv: ReturnType<ReturnType<typeof express>['listen']>, url = '';
const evenements: number[] = [];

const appel = async (profil: string, methode: string, chemin: string, corps?: object) => {
  const r = await fetch(`${url}${chemin}`, { method: methode, headers: { 'x-profil': profil, 'content-type': 'application/json', origin: 'http://localhost' }, body: corps ? JSON.stringify(corps) : undefined });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
};
const absence = async () => {
  const e = await prisma.evenementAgenda.create({ data: { titre: 'zz-test absence', jour: new Date('2031-06-02'), jourFin: new Date('2031-06-04'), destination: 'perso', compteId: ids.auteur, auteurNom: 'Auteur', statutAbsence: 'en_attente' } });
  evenements.push(e.id); return e;
};

before(async () => {
  await prisma.grade.createMany({ data: Object.values(GRADES).map(g => ({ cle: g.cle, libelle: g.cle, position: g.position, permissions: [] })) });
  await prisma.agendaDroitsGrade.create({ data: { gradeCle: GRADES.direction.cle, consulterTous: true, gererTous: true, creer: [], modifier: [], consulter: [] } });
  await chargerGrades();
  for (const [nom, d] of Object.entries(COMPTES)) ids[nom] = (await prisma.compte.create({ data: { discordId: d, pseudo: `zz-test-${nom}`, statut: 'valide', gradeCle: nom === 'direction' ? GRADES.direction.cle : GRADES.employe.cle } })).id;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { session: unknown }).session = { compteId: ids[String(req.get('x-profil'))] }; next(); });
  app.use(agenda);
  srv = app.listen(0);
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
after(async () => {
  srv?.close();
  await prisma.evenementAgenda.deleteMany({ where: { OR: [{ id: { in: evenements } }, { titre: { startsWith: 'zz-test' } }] } });
  await prisma.compte.deleteMany({ where: { discordId: { in: Object.values(COMPTES) } } });
  await prisma.agendaDroitsGrade.deleteMany({ where: { gradeCle: { in: Object.values(GRADES).map(g => g.cle) } } });
  await prisma.grade.deleteMany({ where: { cle: { in: Object.values(GRADES).map(g => g.cle) } } });
  await chargerGrades();
  await prisma.$disconnect();
});

test('refuser une absence : elle reste, avec son motif et la date de décision, et l’auteur est prévenu ou averti', async () => {
  const e = await absence();
  const r = await appel('direction', 'POST', `/api/agenda/${e.id}/absence`, { approuve: false, motif: 'Période de forte activité' });
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.avertissement, 'string', 'sans bot relié, le serveur dit que l’auteur n’a pas pu être prévenu');
  const apres = await prisma.evenementAgenda.findUniqueOrThrow({ where: { id: e.id } });
  assert.equal(apres.statutAbsence, 'refuse');
  assert.equal(apres.absenceMotifRefus, 'Période de forte activité');
  assert.ok(apres.absenceDecideLe);
  // l'auteur la voit encore (avec le motif), mais elle n'est plus modifiable ni supprimable par lui
  const vue = (await appel('auteur', 'GET', '/api/agenda?debut=2031-06-01&fin=2031-06-30')).json.evenements as { id: number; modifiable: boolean; absence_motif_refus: string }[];
  const lue = vue.find(x => x.id === e.id);
  assert.equal(lue?.absence_motif_refus, 'Période de forte activité');
  assert.equal(lue?.modifiable, false);
  assert.equal((await appel('auteur', 'PUT', `/api/agenda/${e.id}`, { titre: 'x' })).status, 403);
});

test('une absence décidée ne se décide pas deux fois, et on ne valide pas la sienne', async () => {
  const e = await absence();
  assert.equal((await appel('auteur', 'POST', `/api/agenda/${e.id}/absence`, { approuve: true })).status, 403);
  const [x, y] = await Promise.all([appel('direction', 'POST', `/api/agenda/${e.id}/absence`, { approuve: true }), appel('direction', 'POST', `/api/agenda/${e.id}/absence`, { approuve: false })]);
  assert.deepEqual([x.status, y.status].sort(), [200, 404]);
});

test('le motif est limité à 200 caractères et ignoré pour une approbation', async () => {
  const e = await absence();
  assert.equal((await appel('direction', 'POST', `/api/agenda/${e.id}/absence`, { approuve: false, motif: 'x'.repeat(201) })).status, 400);
  assert.equal((await appel('direction', 'POST', `/api/agenda/${e.id}/absence`, { approuve: true, motif: 'ignoré' })).status, 200);
  assert.equal((await prisma.evenementAgenda.findUniqueOrThrow({ where: { id: e.id } })).absenceMotifRefus, null);
});

test('une absence refusée n’est visible ni des autres employés ni modifiable', async () => {
  const e = await absence();
  await appel('direction', 'POST', `/api/agenda/${e.id}/absence`, { approuve: false });
  const vue = (await appel('autre', 'GET', '/api/agenda?debut=2031-06-01&fin=2031-06-30')).json.evenements as { id: number }[];
  assert.equal(vue.some(x => x.id === e.id), false);
});

test('déclarer une absence : sans titre ni horaire, le titre se déduit ; modifier une absence approuvée la remet en attente', async () => {
  const r = await appel('auteur', 'POST', '/api/agenda', { absence: true, jour: '2031-07-07', jour_fin: '2031-07-08', notes: 'Congé' });
  assert.equal(r.status, 201);
  const id = r.json.id as number; evenements.push(id);
  const creee = await prisma.evenementAgenda.findUniqueOrThrow({ where: { id } });
  assert.equal(creee.titre, 'Absence');
  assert.equal(creee.statutAbsence, 'en_attente');
  assert.equal(creee.destination, 'perso');
  await appel('direction', 'POST', `/api/agenda/${id}/absence`, { approuve: true });
  const m = await appel('auteur', 'PUT', `/api/agenda/${id}`, { jour: '2031-07-07', jour_fin: '2031-07-09', notes: 'Congé prolongé' });
  assert.equal(m.status, 200);
  const apres = await prisma.evenementAgenda.findUniqueOrThrow({ where: { id } });
  assert.equal(apres.statutAbsence, 'en_attente');
  assert.equal(apres.absenceDecideLe, null);
  assert.equal((await appel('auteur', 'POST', '/api/agenda', { absence: true, jour: '2031-07-09', jour_fin: '2031-07-08' })).status, 400, 'fin avant le début');
});
