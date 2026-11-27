// SOCLE — dépendances entre permissions (src/socle/droits.ts, requiert sur Permission) : cocher une permission qui
// en exige une autre doit toujours entraîner celle-ci, même si l'interface a été contournée. Testé sur une table
// propre au test : le résultat ne dépend pas des permissions de l'entreprise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { completerSelon, effectivesSelon } from '../src/socle/droits.js';
import type { Permission } from '../src/socle/contrat.js';

const TABLE: Permission[] = [
  { cle: 'voir', libelle: 'Consulter' },
  { cle: 'modifier', libelle: 'Modifier', requiert: ['voir'] },
  { cle: 'regler', libelle: 'Régler', requiert: ['modifier'] },     // exige « modifier », qui exige « voir »
  { cle: 'sanctions-voir', libelle: 'Consulter les sanctions' },
  { cle: 'sanctionner', libelle: 'Sanctionner', requiert: ['voir', 'sanctions-voir'] },
  { cle: 'seule', libelle: 'Sans dépendance' },
];

test('une permission complète avec ce qu’elle exige', () => {
  assert.deepEqual(new Set(completerSelon(['modifier'], TABLE)), new Set(['modifier', 'voir']));
});

test('une chaîne de dépendances se complète en cascade', () => {
  assert.deepEqual(new Set(completerSelon(['regler'], TABLE)), new Set(['regler', 'modifier', 'voir']));
});

test('une permission qui en exige deux les ajoute toutes les deux', () => {
  assert.deepEqual(new Set(completerSelon(['sanctionner'], TABLE)), new Set(['sanctionner', 'voir', 'sanctions-voir']));
});

test('une permission déjà présente ne se double pas', () => {
  const r = completerSelon(['voir', 'modifier'], TABLE);
  assert.equal(r.length, 2);
  assert.deepEqual(new Set(r), new Set(['voir', 'modifier']));
});

test('une permission sans dépendance reste seule', () => {
  assert.deepEqual(completerSelon(['seule'], TABLE), ['seule']);
});

test('une clé inconnue est filtrée', () => {
  assert.deepEqual(completerSelon(['voir', 'nimporte-quoi'], TABLE), ['voir']);
});

test('Administrateur : toutes les permissions, y compris celles ajoutées ensuite', () => {
  const toutes = new Set(['admin', 'voir', 'modifier', 'nouvelle']);
  assert.deepEqual(effectivesSelon(['admin'], toutes), toutes);
  assert.deepEqual(effectivesSelon(['voir', 'retiree-du-code'], toutes), new Set(['voir']));
});
