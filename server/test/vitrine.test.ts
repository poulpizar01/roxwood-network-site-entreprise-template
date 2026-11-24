// ENTREPRISE — vitrine (vitrine.ts) : saisie d'un service (limites, étiquettes disparues), étiquette supprimée retirée des
// services qui la portent, nouvel ordre refusé s'il est incomplet, postes. Base réelle, lignes « zz-test » retirées à la fin.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import {
  creerEtiquette, creerPoste, creerService, lireService, listerEtiquettes, listerServices, ordonnerServices, postesPublics, supprimerEtiquette, supprimerService,
} from '../src/entreprise/vitrine.js';

after(async () => {
  await prisma.serviceVitrine.deleteMany({ where: { nom: { startsWith: 'zz-test' } } });
  await prisma.etiquetteService.deleteMany({ where: { nom: { startsWith: 'zz-test' } } });
  await prisma.posteOuvert.deleteMany({ where: { nom: { startsWith: 'zz-test' } } });
  await prisma.$disconnect();
});

const etiquettes = [{ id: 1, nom: 'a', couleur: '#000000' }, { id: 2, nom: 'b', couleur: '#ffffff' }];

test('lireService : nom obligatoire, limites de longueur, points inclus', () => {
  assert.throws(() => lireService({ nom: '  ' }, etiquettes), /nom/);
  assert.throws(() => lireService({ nom: 'x', resume: 'a'.repeat(121) }, etiquettes), /résumé/);
  assert.throws(() => lireService({ nom: 'x', description: 'a'.repeat(401) }, etiquettes), /400/);
  assert.throws(() => lireService({ nom: 'x', inclus: ['1', '2', '3', '4', '5', '6', '7'] }, etiquettes), /6 points/);
  assert.throws(() => lireService({ nom: 'x', inclus: ['a'.repeat(61)] }, etiquettes), /60/);
  // points vides ignorés
  assert.deepEqual(lireService({ nom: 'x', inclus: ['  un ', '', 'deux'] }, etiquettes).inclus, ['un', 'deux']);
});

test('lireService : seules les étiquettes qui existent, sans doublon', () => {
  assert.deepEqual(lireService({ nom: 'x', etiquetteIds: [2, 2, 99, 1] }, etiquettes).etiquetteIds, [2, 1]);
});

test('étiquette supprimée : retirée des services qui la portaient ; un service supprimé disparaît', async () => {
  await creerEtiquette({ nom: 'zz-test étiquette', couleur: '#112233' });
  const e = (await listerEtiquettes()).find(x => x.nom === 'zz-test étiquette')!;
  await assert.rejects(creerEtiquette({ nom: 'zz-test étiquette', couleur: '#112233' }), /existe déjà/);
  await assert.rejects(creerEtiquette({ nom: 'zz-test sans couleur', couleur: 'rouge' }), /Couleur/);
  const id = await creerService({ nom: 'zz-test service', etiquetteIds: [e.id] });
  assert.deepEqual((await listerServices()).find(s => s.id === id)!.etiquetteIds, [e.id]);
  await supprimerEtiquette(e.id);
  assert.deepEqual((await listerServices()).find(s => s.id === id)!.etiquetteIds, []);
  await supprimerService(id);
  assert.equal((await listerServices()).some(s => s.id === id), false);
});

test('ordonnerServices : un ordre incomplet est refusé, un ordre complet s’applique', async () => {
  const a = await creerService({ nom: 'zz-test A' }), b = await creerService({ nom: 'zz-test B' });
  await assert.rejects(ordonnerServices([a]), /incomplet/);
  const tous = (await listerServices()).map(s => s.id);
  const inverse = [...tous].reverse();
  await ordonnerServices(inverse);
  assert.deepEqual((await listerServices()).map(s => s.id), inverse);
  assert.ok(a && b);
});

test('postes : nombre entre 0 et 999 ; seuls ceux à pourvoir sont publics', async () => {
  await assert.rejects(creerPoste({ nom: 'zz-test poste', nombre: -1 }), /entier/);
  await assert.rejects(creerPoste({ nom: '', nombre: 1 }), /nom/);
  await creerPoste({ nom: 'zz-test ouvert', nombre: 2 });
  await creerPoste({ nom: 'zz-test complet', nombre: 0 });
  const publics = (await postesPublics()).map(p => p.nom);
  assert.ok(publics.includes('zz-test ouvert'));
  assert.ok(!publics.includes('zz-test complet'));
});
