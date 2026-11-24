// ENTREPRISE — créneaux ouverts de l'agenda (routes/agenda.ts) : prise et départ, places jamais dépassées, absence
// approuvée bloquante, chef d'équipe, brouillon invisible aux agents, fil de messages. Base réelle, lignes « zz-test » retirées.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { chargerGrades } from '../src/socle/droits.js';
import { agenda } from '../src/entreprise/routes/agenda.js';

const GRADES = { chef: { cle: 'zz-test-ac', position: 940 }, agent: { cle: 'zz-test-aa', position: 950 } };
const COMPTES = { chef: '990000000000000701', a1: '990000000000000702', a2: '990000000000000703', a3: '990000000000000704' } as const;
const ids: Record<string, number> = {};
let srv: ReturnType<ReturnType<typeof express>['listen']>, url = '';
const evenements: number[] = [];

const appel = async (profil: string, methode: string, chemin: string, corps?: object) => {
  const r = await fetch(`${url}${chemin}`, { method: methode, headers: { 'x-profil': profil, 'content-type': 'application/json', origin: 'http://localhost' }, body: corps ? JSON.stringify(corps) : undefined });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
};
const creneau = async (extra: object = {}) => {
  const e = await prisma.evenementAgenda.create({ data: { titre: 'zz-test créneau', jour: new Date('2031-05-05'), jourFin: new Date('2031-05-05'), heureDebut: '10:00', heureFin: '12:00', destination: 'tous', placesMax: 2, compteId: ids.chef, auteurNom: 'Chef', ...extra } });
  evenements.push(e.id); return e;
};

before(async () => {
  await prisma.grade.createMany({ data: Object.values(GRADES).map(g => ({ cle: g.cle, libelle: g.cle, position: g.position, permissions: [] })) });
  await prisma.agendaDroitsGrade.createMany({ data: [
    { gradeCle: GRADES.chef.cle, consulterTous: true, gererTous: true, creer: [], modifier: [], consulter: [] },
    { gradeCle: GRADES.agent.cle, consulterTous: true, gererTous: false, creer: [], modifier: [], consulter: [] },
  ] });
  await chargerGrades();
  for (const [nom, d] of Object.entries(COMPTES)) ids[nom] = (await prisma.compte.create({ data: { discordId: d, pseudo: `zz-test-${nom}`, statut: 'valide', gradeCle: nom === 'chef' ? GRADES.chef.cle : GRADES.agent.cle } })).id;
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

test('prendre et quitter : jamais plus de places que prévu, jamais deux fois', async () => {
  const e = await creneau();
  assert.equal((await appel('a1', 'POST', `/api/agenda/${e.id}/prendre`)).status, 201);
  assert.equal((await appel('a1', 'POST', `/api/agenda/${e.id}/prendre`)).status, 409, 'déjà pris');
  // deux prises simultanées pour la dernière place : une seule passe
  const [x, y] = await Promise.all([appel('a2', 'POST', `/api/agenda/${e.id}/prendre`), appel('a3', 'POST', `/api/agenda/${e.id}/prendre`)]);
  assert.deepEqual([x.status, y.status].sort(), [201, 409]);
  assert.equal(await prisma.affectationAgenda.count({ where: { evenementId: e.id } }), 2);
  assert.equal((await appel('a1', 'POST', `/api/agenda/${e.id}/quitter`)).status, 200);
  assert.equal(await prisma.affectationAgenda.count({ where: { evenementId: e.id } }), 1);
});

test('une absence approuvée sur la plage bloque la prise', async () => {
  const e = await creneau();
  const absence = await prisma.evenementAgenda.create({ data: { titre: 'zz-test absence', jour: new Date('2031-05-04'), jourFin: new Date('2031-05-06'), destination: 'perso', compteId: ids.a1, statutAbsence: 'approuve' } });
  evenements.push(absence.id);
  const r = await appel('a1', 'POST', `/api/agenda/${e.id}/prendre`);
  assert.equal(r.status, 409);
  assert.match(String(r.json.error), /absence/);
  await prisma.evenementAgenda.delete({ where: { id: absence.id } });   // les tests suivants réutilisent ce compte
});

test('brouillon : invisible et impossible à prendre pour un agent', async () => {
  const e = await creneau({ statut: 'brouillon' });
  assert.equal((await appel('a1', 'POST', `/api/agenda/${e.id}/prendre`)).status, 404);
  assert.equal((await appel('chef', 'POST', `/api/agenda/${e.id}/prendre`)).status, 201, 'qui peut le modifier le voit');
});

test('chef d’équipe : un seul par créneau, réservé à qui modifie l’événement', async () => {
  const e = await creneau();
  await appel('a1', 'POST', `/api/agenda/${e.id}/prendre`); await appel('a2', 'POST', `/api/agenda/${e.id}/prendre`);
  const [p1, p2] = await prisma.affectationAgenda.findMany({ where: { evenementId: e.id }, orderBy: { id: 'asc' } });
  assert.equal((await appel('a1', 'PUT', `/api/agenda/${e.id}/affectations/${p1.id}/chef`, { chef_equipe: true })).status, 403);
  assert.equal((await appel('chef', 'PUT', `/api/agenda/${e.id}/affectations/${p1.id}/chef`, { chef_equipe: true })).status, 200);
  assert.equal((await appel('chef', 'PUT', `/api/agenda/${e.id}/affectations/${p2.id}/chef`, { chef_equipe: true })).status, 200);
  const chefs = await prisma.affectationAgenda.findMany({ where: { evenementId: e.id, chefEquipe: true } });
  assert.deepEqual(chefs.map(c => c.id), [p2.id]);
});

test('fil de messages : réservé aux personnes concernées, retrait de ses propres messages', async () => {
  const e = await creneau();
  await appel('a1', 'POST', `/api/agenda/${e.id}/prendre`);
  assert.equal((await appel('a2', 'POST', `/api/agenda/${e.id}/messages`, { texte: 'bonjour' })).status, 403, 'a2 voit le créneau mais n’y est pas inscrit');
  const m = await appel('a1', 'POST', `/api/agenda/${e.id}/messages`, { texte: 'J’apporte le matériel' });
  assert.equal(m.status, 201);
  assert.equal((await appel('a1', 'POST', `/api/agenda/${e.id}/messages`, { texte: '   ' })).status, 400);
  const lu = await appel('a2', 'GET', `/api/agenda/${e.id}/messages`);
  assert.equal((lu.json.messages as unknown[]).length, 1);
  assert.equal(lu.json.peut_ecrire, false);
  assert.equal((await appel('a2', 'DELETE', `/api/agenda/${e.id}/messages/${m.json.id}`)).status, 403);
  assert.equal((await appel('chef', 'DELETE', `/api/agenda/${e.id}/messages/${m.json.id}`)).status, 200, 'qui modifie l’événement peut retirer');
});
