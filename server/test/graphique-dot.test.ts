// Graphique DOT sur 12 semaines (src/entreprise/stats/graphique-dot.ts) : un trou n'est pas un zéro, une semaine
// provisoire ne tire pas les moyennes. De l'argent RP affiché : une erreur ici ne se voit pas à l'écran.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pointGraphique, reperesGraphique, type ResumeSemaine } from '../src/entreprise/stats/graphique-dot.js';

const resume = (o: Partial<ResumeSemaine> = {}): ResumeSemaine => ({ caBrut: 100000, depenseDeductible: 40000, montantImpots: 10000, montantPrimes: 5000, retraits: 15000, beneficeNet: 30000, ...o });

test('une semaine sans CA est un trou, pas un zéro', () => {
  const p = pointGraphique('2026-11-02', resume({ caBrut: null, montantImpots: null, beneficeNet: null }), false);
  assert.equal(p.vide, true);
  assert.equal(p.ca, 0);
});

test('une semaine déclarée : primes et retraits sont regroupés, le net se lit sur le résumé', () => {
  const p = pointGraphique('2026-11-02', resume(), false);
  assert.deepEqual([p.ca, p.charges, p.impot, p.sorties, p.net], [100000, 40000, 10000, 20000, 30000]);
  assert.equal(p.ca, p.charges + p.impot + p.sorties + p.net);   // la colonne se referme sur le CA
});

test('repères : moyennes sur les semaines déclarées seulement (ni trou ni provisoire)', () => {
  const points = [
    pointGraphique('2026-10-26', resume(), false),
    pointGraphique('2026-11-02', resume({ caBrut: 300000, montantImpots: 30000, beneficeNet: -20000 }), false),
    pointGraphique('2026-11-09', resume({ caBrut: null, montantImpots: null, beneficeNet: null }), false),
    pointGraphique('2026-11-16', resume({ caBrut: 1000, montantImpots: 1, beneficeNet: 1 }), true),   // provisoire : exclue
  ];
  const r = reperesGraphique(points);
  assert.equal(r.semainesDeclarees, 2);
  assert.equal(r.semainesSansReleve, 1);
  assert.equal(r.caMoyen, 200000);
  assert.equal(r.impotTotal, 40000);
  assert.equal(r.tauxEffectif, 0.1);
  assert.equal(r.netMoyen, 5000);
  assert.deepEqual(r.semainesEnPerte, ['2026-11-02']);
});

test('repères : aucune semaine déclarée, rien d’inventé', () => {
  const r = reperesGraphique([pointGraphique('2026-11-16', resume(), true)]);
  assert.equal(r.semainesDeclarees, 0);
  assert.deepEqual([r.caMoyen, r.impotTotal, r.tauxEffectif, r.netMoyen], [null, null, null, null]);
});
