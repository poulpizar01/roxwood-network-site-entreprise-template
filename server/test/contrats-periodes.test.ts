// Périodes d'un contrat : fin, échéances, ce qui reste à facturer (une erreur facture deux fois, ou oublie une période).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aFacturer, contratTermine, etatsPeriodes, finPeriodeEnCours, indexPeriode, periode, prochaineEcheance, verifierPlage,
} from '../src/entreprise/contrats-periodes.js';

test('mensuel commencé un 31 : ramené au dernier jour des mois courts, sans dériver', () => {
  assert.deepEqual(periode('2026-01-31', 'mensuel', 0), { debut: '2026-01-31', fin: '2026-02-27' });
  assert.deepEqual(periode('2026-01-31', 'mensuel', 1), { debut: '2026-02-28', fin: '2026-03-30' });
  assert.deepEqual(periode('2026-01-31', 'mensuel', 2), { debut: '2026-03-31', fin: '2026-04-29' });
  assert.equal(indexPeriode('2026-01-31', 'mensuel', '2026-02-27'), 0);
  assert.equal(indexPeriode('2026-01-31', 'mensuel', '2026-02-28'), 1);
  assert.equal(indexPeriode('2026-01-31', 'mensuel', '2026-03-31'), 2);
  assert.deepEqual(periode('2026-11-15', 'mensuel', 2), { debut: '2027-01-15', fin: '2027-02-14' });
});

test('hebdomadaire et journalier calés sur la date de début', () => {
  assert.deepEqual(periode('2026-10-22', 'hebdomadaire', 1), { debut: '2026-10-29', fin: '2026-11-04' });
  assert.equal(indexPeriode('2026-10-22', 'hebdomadaire', '2026-10-28'), 0);
  assert.equal(indexPeriode('2026-10-22', 'hebdomadaire', '2026-10-21'), -1);
  assert.deepEqual(periode('2026-10-22', 'journalier', 3), { debut: '2026-10-25', fin: '2026-10-25' });
});

test('fin de contrat : date de fin incluse, ou statut terminé', () => {
  assert.equal(contratTermine({ statut: 'actif', dateFin: '2026-10-25' }, '2026-10-25'), false);
  assert.equal(contratTermine({ statut: 'actif', dateFin: '2026-10-25' }, '2026-10-26'), true);
  assert.equal(contratTermine({ statut: 'actif', dateFin: null }, '2030-01-01'), false);
  assert.equal(contratTermine({ statut: 'termine', dateFin: null }, '2026-10-25'), true);
});

test('échéances et fin de la période en cours', () => {
  const c = { dateDebut: '2026-10-22', dateFin: null, periodicite: 'hebdomadaire' as const };
  assert.equal(prochaineEcheance(c, '2026-10-25'), '2026-10-29');
  assert.equal(prochaineEcheance({ ...c, dateFin: '2026-10-28' }, '2026-10-25'), null);
  assert.equal(prochaineEcheance(c, '2026-10-01'), '2026-10-22');
  assert.equal(finPeriodeEnCours('2026-10-22', 'hebdomadaire', '2026-10-25'), '2026-10-28');
  assert.equal(finPeriodeEnCours('2026-10-22', 'hebdomadaire', '2026-10-10'), '2026-10-28');
});

test('à facturer : périodes commencées non couvertes, d’un bloc', () => {
  const c = { dateDebut: '2026-10-01', dateFin: null, periodicite: 'hebdomadaire' as const };
  const etats = etatsPeriodes(c, [{ id: 7, periodeDebut: '2026-10-01', periodeFin: '2026-10-07', payee: true }], '2026-10-25');
  assert.deepEqual(etats.map(e => e.etat), ['payee', 'a-facturer', 'a-facturer', 'a-facturer', 'a-venir']);
  assert.deepEqual(aFacturer(etats), { debut: '2026-10-08', fin: '2026-10-28', nombre: 3 });
  assert.equal(aFacturer(etatsPeriodes(c, [{ id: 8, periodeDebut: '2026-10-01', periodeFin: '2026-10-28', payee: false }], '2026-10-25')), null);
});

test('contrat terminé : plus de période après sa fin, la dernière se facture en entier', () => {
  const c = { dateDebut: '2026-10-01', dateFin: '2026-10-10', periodicite: 'hebdomadaire' as const };
  const etats = etatsPeriodes(c, [], '2026-10-25');
  assert.deepEqual(etats.map(e => [e.debut, e.fin, e.etat]), [['2026-10-01', '2026-10-07', 'a-facturer'], ['2026-10-08', '2026-10-14', 'a-facturer']]);
});

test('plage demandée : calée sur les périodes, commencée, jamais facturée deux fois', () => {
  const c = { dateDebut: '2026-10-01', dateFin: null, periodicite: 'hebdomadaire' as const };
  const deja = [{ id: 1, periodeDebut: '2026-10-08', periodeFin: '2026-10-14', payee: false }];
  assert.deepEqual(verifierPlage(c, [], '2026-10-01', '2026-10-14', '2026-10-25'), { nombre: 2 });
  assert.ok('refus' in verifierPlage(c, [], '2026-10-02', '2026-10-14', '2026-10-25'));
  assert.ok('refus' in verifierPlage(c, [], '2026-10-29', '2026-11-04', '2026-10-25'));
  assert.ok('refus' in verifierPlage(c, deja, '2026-10-01', '2026-10-14', '2026-10-25'));
  assert.deepEqual(verifierPlage(c, deja, '2026-10-15', '2026-10-21', '2026-10-25'), { nombre: 1 });
});
