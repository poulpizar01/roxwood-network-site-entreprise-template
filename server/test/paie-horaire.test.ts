// Paie à l'heure des stagiaires (src/entreprise/stats/paie-horaire.ts) : heures de service du relevé Tablettes × taux
// horaire du grade, en plus des paliers, reprise dans le salaire de la DOT. De l'argent RP : une erreur ici ne se voit
// pas à l'écran.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculerPaieHoraire, dureeEnMinutes, type GradeHoraire } from '../src/entreprise/stats/paie-horaire.js';

test('durées du relevé : formats lus, rien n’est deviné', () => {
  assert.equal(dureeEnMinutes('0h52min'), 52);
  assert.equal(dureeEnMinutes('12h05min'), 725);
  assert.equal(dureeEnMinutes('3h'), 180);
  assert.equal(dureeEnMinutes('1h 5min'), 65);
  assert.equal(dureeEnMinutes('45min'), 45);
  assert.equal(dureeEnMinutes('2:30'), 150);
  for (const illisible of ['', '-', '52', 'abc', '1h75min', '2:75', null]) assert.equal(dureeEnMinutes(illisible), null, String(illisible));
});

const COLONNES = ['Nom', 'Rang', 'Facture', 'Total entreprise', 'Heures de service'];
const LIGNES = [
  ['Lina Morel', 'Stagiaire', '0', '0', '2h30min'],
  ['Noam Finley', 'Agent', '5 000', '5 000', '10h00min'],
  ['Sans Fiche', 'Stagiaire', '0', '0', '0h52min'],
  ['Heure Illisible', 'Stagiaire', '0', '0', 'beaucoup'],
  ['TOTAL', '-', '5 000', '5 000'],
];
// taux par grade du site : la clé (fiche RH) et le libellé (colonne Rang du relevé) mènent au même grade
const taux = (stagiaire: number, agent = 0) => new Map<string, GradeHoraire>([
  ['stagiaire', { libelle: 'Stagiaire', taux: stagiaire }], ['Stagiaire', { libelle: 'Stagiaire', taux: stagiaire }],
  ['agent', { libelle: 'Agent', taux: agent }], ['Agent', { libelle: 'Agent', taux: agent }],
]);

test('calcul : seuls les grades payés à l’heure, grade de la fiche RH d’abord', () => {
  const p = calculerPaieHoraire({
    colonnes: COLONNES, lignes: LIGNES, taux: taux(6000),
    // RH fait foi : « Noam Finley » est stagiaire dans sa fiche, même si le relevé dit Agent
    employes: [{ prenom: 'Lina', nom: 'Morel', grade: 'stagiaire' }, { prenom: 'Noam', nom: 'Finley', grade: 'stagiaire' }],
  });
  assert.equal(p.colonneHeures, 'Heures de service');
  assert.deepEqual(p.lignes.map(l => [l.nom, l.minutes, l.montant, l.gradeSource]), [
    ['Lina Morel', 150, 15000, 'rh'],
    ['Noam Finley', 600, 60000, 'rh'],
    ['Sans Fiche', 52, 5200, 'releve'],
    ['Heure Illisible', null, 0, 'releve'],
  ]);
  assert.equal(p.lignes[3].lisible, false);
  assert.equal(p.total, 80200);
  assert.equal(calculerPaieHoraire({ colonnes: COLONNES, lignes: LIGNES, taux: taux(0) }).lignes.length, 0, 'aucun taux réglé : rien');
});

test('sans colonne « Heures de service » : lignes signalées illisibles, 0 $', () => {
  const p = calculerPaieHoraire({ colonnes: ['Nom', 'Rang'], lignes: [['Lina Morel', 'Stagiaire']], taux: taux(6000) });
  assert.equal(p.colonneHeures, null);
  assert.deepEqual(p.lignes.map(l => [l.lisible, l.montant]), [[false, 0]]);
});
