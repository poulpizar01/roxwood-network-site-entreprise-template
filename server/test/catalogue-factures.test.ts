// ENTREPRISE — catalogue de prestations de facture (facture.ts) sur la base réelle : nom et prix contrôlés, ordre de
// création, plafond, suppression sans effet sur les factures. Lignes préfixées « zz-test », retirées à la fin.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/entreprise/index.js';   // d'abord : charge les modules dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { ajouterArticleCatalogue, listerCatalogue, modifierArticleCatalogue, supprimerArticleCatalogue } from '../src/entreprise/facture.js';
import { Refus } from '../src/entreprise/refus.js';

const refus = (statut: number) => (e: unknown) => e instanceof Refus && e.status === statut;
after(async () => { await prisma.catalogueFacture.deleteMany({ where: { nom: { startsWith: 'zz-test' } } }); await prisma.$disconnect(); });

test('une prestation a un nom et un prix positif', async () => {
  await assert.rejects(() => ajouterArticleCatalogue({ nom: '  ', prix: 10 }), refus(400));
  await assert.rejects(() => ajouterArticleCatalogue({ nom: 'zz-test a', prix: -1 }), refus(400));
  await assert.rejects(() => ajouterArticleCatalogue({ nom: 'zz-test a', prix: 'abc' }), refus(400));
  await assert.rejects(() => ajouterArticleCatalogue({ nom: 'zz-test a', prix: 3_000_000_000 }), refus(400));
});

test('ajouter, modifier, ordre de création, supprimer', async () => {
  const a = await ajouterArticleCatalogue({ nom: 'zz-test A', prix: 1200 });
  const b = await ajouterArticleCatalogue({ nom: 'zz-test B', prix: 50 });
  assert.deepEqual((await listerCatalogue()).filter(x => x.nom.startsWith('zz-test')).map(x => x.nom), ['zz-test A', 'zz-test B'], 'dans l’ordre de création');
  await modifierArticleCatalogue(a.id, { nom: 'zz-test A2', prix: 1300 });
  assert.deepEqual((await prisma.catalogueFacture.findUniqueOrThrow({ where: { id: a.id } })).prix, 1300);
  await assert.rejects(() => modifierArticleCatalogue(987654321, { nom: 'zz-test X', prix: 1 }), refus(404));
  await supprimerArticleCatalogue(b.id);
  await supprimerArticleCatalogue(b.id);   // déjà supprimée : sans erreur
  assert.equal(await prisma.catalogueFacture.count({ where: { id: b.id } }), 0);
});
