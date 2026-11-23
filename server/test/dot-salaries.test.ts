// ENTREPRISE — tableau des salariés d'une semaine de la DOT (dot.ts, salariesDot), sur la base réelle : un employé
// parti pendant ou après la semaine y figure encore (sa paie ne se perd pas), pas celui arrivé après sa fin ni celui
// parti avant son début. Lignes de test préfixées « zz-test », retirées à la fin.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import '../src/entreprise/index.js';   // d'abord : charge les modules dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { salariesDot } from '../src/entreprise/dot.js';
import { servicesEnSuspensSemaine } from '../src/entreprise/services.js';

const SEMAINE = '2026-11-02';   // lundi, semaine du 2 au 8 novembre
const jour = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fiches = [
  { cle: 'actif', statut: 'actif', arrivee: '2026-01-05', depart: null },
  { cle: 'parti-pendant', statut: 'inactif', arrivee: '2026-01-05', depart: '2026-11-05' },
  { cle: 'parti-apres', statut: 'inactif', arrivee: '2026-01-05', depart: '2026-11-20' },
  { cle: 'parti-avant', statut: 'inactif', arrivee: '2026-01-05', depart: '2026-10-20' },
  { cle: 'arrive-apres', statut: 'actif', arrivee: '2026-11-10', depart: null },
];

before(async () => {
  for (const f of fiches) await prisma.employe.create({ data: { idUnique: `zz-test-${f.cle}`, idUniqueNormalise: `zz-test-${f.cle}`, prenom: 'Test', nom: f.cle, gradeCle: 'zz-test',
    statut: f.statut, dateArrivee: jour(f.arrivee), dateDepart: f.depart ? jour(f.depart) : null } });
});
after(async () => {
  await prisma.service.deleteMany({ where: { serviceId: { startsWith: 'zz-test-' } } });
  await prisma.employe.deleteMany({ where: { idUnique: { startsWith: 'zz-test-' } } });
  await prisma.$disconnect();
});

test('salariesDot : actifs et partis pendant ou après la semaine, pas les arrivés après ni les partis avant', async () => {
  const noms = new Set((await salariesDot(SEMAINE)).agents.map(a => a.nom));
  const presents = (cle: string) => noms.has(`Test ${cle}`);
  assert.deepEqual(
    fiches.map(f => [f.cle, presents(f.cle)]),
    [['actif', true], ['parti-pendant', true], ['parti-apres', true], ['parti-avant', false], ['arrive-apres', false]],
  );
});

test('servicesEnSuspensSemaine : ouverts et en anomalie de la semaine, d’une fiche, hors des autres semaines', async () => {
  const fiche = await prisma.employe.findFirstOrThrow({ where: { idUnique: 'zz-test-actif' } });
  const dans = new Date('2026-11-04T10:00:00Z'), hors = new Date('2026-11-12T10:00:00Z');
  await prisma.service.createMany({ data: [
    { serviceId: 'zz-test-ouvert', employeNom: 'x', employeId: fiche.id, debut: dans },                                          // compte : ouvert
    { serviceId: 'zz-test-anomalie', employeNom: 'x', employeId: fiche.id, debut: dans, fin: new Date('2026-11-04T12:00:00Z'), anomalie: 'cloture_auto' },   // compte : anomalie
    { serviceId: 'zz-test-normal', employeNom: 'x', employeId: fiche.id, debut: dans, fin: new Date('2026-11-04T12:00:00Z') },   // terminé et sain : non
    { serviceId: 'zz-test-autre-semaine', employeNom: 'x', employeId: fiche.id, debut: hors },                                  // une autre semaine : non
    { serviceId: 'zz-test-sans-fiche', employeNom: 'x', employeId: null, debut: dans },                                          // sans fiche : non
  ] });
  assert.deepEqual(await servicesEnSuspensSemaine(SEMAINE), { ouverts: 1, anomalies: 1 });
});
