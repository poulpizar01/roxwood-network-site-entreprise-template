// ENTREPRISE — fiches de paie publiées (dot.ts : publierFichesPaie, marquerFichePaiePayee, fichesPaiePubliees), sur la
// base réelle : seule une semaine verrouillée se publie, un employé ne lit que sa ligne et seulement une fois publiée,
// et « payé » se coche à part du résumé figé. Semaines de 2020, lignes préfixées « zz-test », retirées à la fin.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import '../src/entreprise/index.js';   // d'abord : charge les modules dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { fichesPaiePubliees, marquerFichePaiePayee, publierFichesPaie } from '../src/entreprise/dot.js';
import { Refus } from '../src/entreprise/refus.js';

const S_PUBLIEE = '2020-02-03', S_NON_PUBLIEE = '2020-02-10', S_OUVERTE = '2020-02-17';
let moi = 0, autre = 0;
const jour = (s: string) => new Date(`${s}T00:00:00Z`);

before(async () => {
  const fiche = (idUnique: string) => prisma.employe.create({ data: { idUnique, idUniqueNormalise: idUnique, prenom: 'Test', nom: idUnique, gradeCle: 'zz-test' } });
  moi = (await fiche('zz-test-paie-1')).id; autre = (await fiche('zz-test-paie-2')).id;
  const agents = (m: number) => ({ agents: [
    { employeId: moi, grade: 'Employé', heuresServiceMinutes: 90, salaireTotal: 1200 + m, prime: 50, run: 3, facture: 4000, vente: 9, caTotalRealise: 99999 },
    { employeId: autre, grade: 'Manager', heuresServiceMinutes: 30, salaireTotal: 777, prime: 0 },
  ] });
  for (const s of [S_PUBLIEE, S_NON_PUBLIEE]) await prisma.declarationDot.create({ data: { semaine: jour(s), statut: 'validee', resume: {}, salaries: agents(s === S_PUBLIEE ? 0 : 1) as object, ecritures: [] } });
});
after(async () => {
  const semaines = [S_PUBLIEE, S_NON_PUBLIEE, S_OUVERTE].map(jour);
  await prisma.paiementFicheDot.deleteMany({ where: { semaine: { in: semaines } } });
  await prisma.declarationDot.deleteMany({ where: { semaine: { in: semaines } } });
  await prisma.employe.deleteMany({ where: { idUnique: { startsWith: 'zz-test-paie' } } });
  await prisma.$disconnect();
});

test('seule une semaine verrouillée se publie ; republier est sans effet', async () => {
  await assert.rejects(() => publierFichesPaie(S_OUVERTE), (e: unknown) => e instanceof Refus && e.status === 409);
  await publierFichesPaie(S_PUBLIEE);
  const premiere = (await prisma.declarationDot.findUniqueOrThrow({ where: { semaine: jour(S_PUBLIEE) } })).publieeLe;
  await publierFichesPaie(S_PUBLIEE);
  assert.deepEqual((await prisma.declarationDot.findUniqueOrThrow({ where: { semaine: jour(S_PUBLIEE) } })).publieeLe, premiere, 'la date de publication ne bouge pas');
});

test('un employé ne lit que sa ligne, d’une semaine publiée, sans le chiffre d’affaires de la ligne', async () => {
  const fiches = (await fichesPaiePubliees(moi)).filter(f => f.semaine === S_PUBLIEE || f.semaine === S_NON_PUBLIEE);
  assert.equal(fiches.length, 1, 'la semaine non publiée n’apparaît pas');
  assert.deepEqual(fiches[0], { semaine: S_PUBLIEE, grade: 'Employé', heuresServiceMinutes: 90, salaireTotal: 1200, prime: 50, paye: false });
  assert.ok(!('caTotalRealise' in fiches[0]) && !('facture' in fiches[0]));
  assert.equal((await fichesPaiePubliees(autre)).find(f => f.semaine === S_PUBLIEE)?.salaireTotal, 777, 'chacun lit la sienne');
});

test('payé se coche et se décoche à part, seulement sur une semaine verrouillée', async () => {
  await marquerFichePaiePayee(S_PUBLIEE, moi, true);
  await marquerFichePaiePayee(S_PUBLIEE, moi, true);   // idempotent
  assert.equal((await fichesPaiePubliees(moi)).find(f => f.semaine === S_PUBLIEE)?.paye, true);
  assert.equal((await fichesPaiePubliees(autre)).find(f => f.semaine === S_PUBLIEE)?.paye, false, 'le paiement d’un employé ne touche pas l’autre');
  await marquerFichePaiePayee(S_PUBLIEE, moi, false);
  assert.equal((await fichesPaiePubliees(moi)).find(f => f.semaine === S_PUBLIEE)?.paye, false);
  await assert.rejects(() => marquerFichePaiePayee(S_OUVERTE, moi, true), (e: unknown) => e instanceof Refus && e.status === 409);
  await assert.rejects(() => marquerFichePaiePayee(S_PUBLIEE, 987654321, true), (e: unknown) => e instanceof Refus && e.status === 404);   // pas un salarié de cette déclaration
});
