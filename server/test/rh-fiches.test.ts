// ENTREPRISE — règles de données d'une fiche RH (rh.ts) : statut et date de départ cohérents, coordonnées personnelles
// modifiées champ par champ, et la date du jour prise à l'heure de Paris. Lignes de test préfixées « zz-test ».
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import '../src/entreprise/index.js';   // d'abord : charge les modules dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { chargerGrades } from '../src/socle/droits.js';
import { definirMaFiche, lireChamps } from '../src/entreprise/rh.js';
import { jourParis } from '../src/entreprise/texte.js';

const DISCORD = '990000000000000201';

before(async () => {
  await prisma.grade.create({ data: { cle: 'zz-test-fiche', libelle: 'Test fiche', position: 905, permissions: [] } });
  await chargerGrades();
  await prisma.employe.create({ data: { idUnique: 'zz-test-fiche', idUniqueNormalise: 'zz-test-fiche', prenom: 'Test', nom: 'Fiche', gradeCle: 'zz-test-fiche', discordId: DISCORD, telephone: '555-0100', rib: 'RIB-INITIAL' } });
});
after(async () => {
  await prisma.employe.deleteMany({ where: { idUnique: 'zz-test-fiche' } });
  await prisma.grade.deleteMany({ where: { cle: 'zz-test-fiche' } });
  await chargerGrades();
  await prisma.$disconnect();
});

const base = { idUnique: '42', prenom: 'Léa', nom: 'Test', grade: 'zz-test-fiche', dateArrivee: '2026-01-05' };

test('une fiche inactive sans date de départ reçoit celle du jour (Paris)', () => {
  const c = lireChamps({ ...base, statut: 'inactif' }, null);
  assert.equal(c.statut, 'inactif');
  assert.equal(c.dateDepart?.toISOString().slice(0, 10), jourParis());
});

test('une fiche active n’a jamais de date de départ', () => {
  assert.equal(lireChamps({ ...base, statut: 'actif', dateDepart: '2026-03-01' }, null).dateDepart, null);
  // réactivation d'une fiche inactive par le champ Statut : la date de départ précédente est effacée
  const inactive = { dateArrivee: new Date('2026-01-05'), dateDepart: new Date('2026-03-01'), statut: 'inactif' } as Parameters<typeof lireChamps>[1];
  assert.equal(lireChamps({ statut: 'actif' }, inactive).dateDepart, null);
});

test('une date de départ saisie sur une fiche inactive est conservée', () => {
  assert.equal(lireChamps({ ...base, statut: 'inactif', dateDepart: '2026-03-01' }, null).dateDepart?.toISOString().slice(0, 10), '2026-03-01');
});

test('definirMaFiche : un appel qui ne porte que le téléphone garde le RIB (et inversement)', async () => {
  await definirMaFiche(DISCORD, { telephone: '555-0199' });
  let f = await prisma.employe.findUniqueOrThrow({ where: { discordId: DISCORD } });
  assert.deepEqual([f.telephone, f.rib], ['555-0199', 'RIB-INITIAL']);
  await definirMaFiche(DISCORD, { rib: 'RIB-NOUVEAU' });
  f = await prisma.employe.findUniqueOrThrow({ where: { discordId: DISCORD } });
  assert.deepEqual([f.telephone, f.rib], ['555-0199', 'RIB-NOUVEAU']);
  await definirMaFiche(DISCORD, { telephone: '', rib: '' });   // vider explicitement reste possible
  f = await prisma.employe.findUniqueOrThrow({ where: { discordId: DISCORD } });
  assert.deepEqual([f.telephone, f.rib], ['', '']);
});
