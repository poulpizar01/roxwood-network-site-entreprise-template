// Agenda partagé (src/entreprise/agenda-regles.ts) : qui voit, crée et modifie quoi, heure de Paris, ticket de la personne.
// Une erreur ici ouvrirait un événement de direction à tout le monde sans rien d'anormal à l'écran.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ajoutsNonDetenus, choisirTicket, droitsAgenda, droitsInclusDansConsultation, gradeAccordable, modifiable, parisVersDate, peutCreer, peutInviter, voit } from '../src/entreprise/agenda-regles.js';

const GRADES = ['patron', 'directeur', 'manager', 'agent'];   // du sommet à la base
const ev = (destination: string, destinationGrade: string | null = null, compteId: number | null = 99, invitesDiscordIds: string[] = []) =>
  ({ compteId, destination, destinationGrade, invitesDiscordIds });
const MOI = { id: 1, discordId: '411111111111111111' };

test('les nouvelles règles n’accordent aucun droit de grade par défaut', () => {
  const d = droitsAgenda(GRADES, 'manager', false, null);
  assert.equal(voit(ev('grade', 'manager'), MOI, d, GRADES), false);
  assert.equal(voit(ev('grade', 'agent'), MOI, d, GRADES), false);
  assert.equal(voit(ev('tous'), MOI, d, GRADES), false);
  assert.equal(modifiable(ev('grade', 'agent'), MOI, d, GRADES), false);
  assert.equal(peutCreer(d, 'grade', 'directeur', GRADES), false);
  assert.equal(peutCreer(d, 'tous', null, GRADES), false);
});

test('les droits par grade ne s’étendent pas aux grades voisins', () => {
  const d = droitsAgenda(GRADES, 'agent', false, { consulter: ['directeur', 'agent'], creer: ['agent'], modifier: ['agent'] });
  assert.equal(voit(ev('grade', 'directeur'), MOI, d, GRADES), true);
  assert.equal(voit(ev('grade', 'manager'), MOI, d, GRADES), false);
  assert.equal(voit(ev('grade', 'patron'), MOI, d, GRADES), false);
  assert.equal(peutCreer(d, 'tous', null, GRADES), false, 'les droits ciblés par grade ne débloquent pas l’équipe entière');
  assert.equal(peutCreer(d, 'perso', null, GRADES), true, 'son agenda personnel reste à soi');
  assert.equal(modifiable(ev('grade', 'manager'), MOI, d, GRADES), false);
  assert.equal(modifiable(ev('grade', 'agent'), MOI, d, GRADES), true);
});

test('événements pour toute l’équipe : consultation distincte du droit de gestion', () => {
  const partage = ev('tous');
  const parDefaut = droitsAgenda(GRADES, 'manager', false, null);
  assert.equal(voit(partage, MOI, parDefaut, GRADES), false);
  assert.equal(modifiable(partage, MOI, parDefaut, GRADES), false);
  const equipe = droitsAgenda(GRADES, 'manager', false, {
    consulter: [], creer: [], modifier: [], consulterTous: true, gererTous: true,
  });
  assert.equal(voit(partage, MOI, equipe, GRADES), true);
  assert.equal(modifiable(partage, MOI, equipe, GRADES), true);
  assert.equal(peutCreer(equipe, 'tous', null, GRADES), true);
  assert.equal(peutCreer(droitsAgenda(GRADES, 'manager', false, { consulter: ['manager'], creer: ['manager'], modifier: ['manager'] }), 'tous', null, GRADES), false, 'créer pour toute l’équipe est un droit distinct');

  const lectureSeule = droitsAgenda(GRADES, 'manager', false, {
    consulter: ['manager'], creer: ['manager'], modifier: ['manager'], consulterTous: true, gererTous: false,
  });
  assert.equal(voit(partage, MOI, lectureSeule, GRADES), true);
  assert.equal(modifiable(partage, MOI, lectureSeule, GRADES), false);

  const aucunAcces = droitsAgenda(GRADES, 'manager', false, {
    consulter: ['manager'], creer: ['manager'], modifier: ['manager'], consulterTous: false, gererTous: false,
  });
  assert.equal(voit(partage, MOI, aucunAcces, GRADES), false);
  assert.equal(modifiable(partage, MOI, aucunAcces, GRADES), false);
  assert.equal(voit(ev('grade', 'manager'), MOI, aucunAcces, GRADES), true, 'le réglage ne change pas les événements adressés à un grade');
});

test('événement personnel, sans grade, grade disparu, propriétaire', () => {
  const d = droitsAgenda(GRADES, 'patron', false, null);
  assert.equal(voit(ev('perso'), MOI, d, GRADES), false, 'le Perso d’un autre reste privé, même au sommet');
  assert.equal(voit(ev('perso', null, 99, [MOI.discordId]), MOI, d, GRADES), true, 'une personne invitée voit l’événement');
  assert.equal(modifiable(ev('perso', null, 99, [MOI.discordId]), MOI, d, GRADES), false, 'une personne invitée ne le gère pas');
  assert.equal(voit(ev('perso', null, 99, [MOI.discordId, '422222222222222222']), MOI, d, GRADES), true, 'chaque personne invitée voit le même événement');
  assert.equal(voit(ev('perso', null, 99, ['422222222222222222']), MOI, d, GRADES), false, 'une personne non invitée ne le voit pas');
  assert.equal(modifiable(ev('grade', 'patron', MOI.id), MOI, droitsAgenda(GRADES, 'agent', false, { consulter: [], creer: [], modifier: [] }), GRADES), true, 'ses propres événements : toujours');

  const sans = droitsAgenda(GRADES, null, false, null);
  assert.equal(voit(ev('tous'), MOI, sans, GRADES), true);
  assert.equal(voit(ev('grade', 'agent'), MOI, sans, GRADES), false);
  assert.equal(peutCreer(sans, 'tous', null, GRADES), false);

  assert.equal(voit(ev('grade', 'disparu'), MOI, droitsAgenda(GRADES, 'directeur', false, null), GRADES), false, 'un grade supprimé ne donne aucun accès');
  assert.deepEqual(droitsAgenda(GRADES, 'agent', false, { consulter: ['disparu', 'agent'], creer: ['agent'], modifier: ['agent'] }).consulter, ['agent'], 'les clés de grade supprimées sont ignorées');

  const proprio = droitsAgenda(GRADES, null, true, null);
  assert.equal(voit(ev('grade', 'patron'), MOI, proprio, GRADES), true);
  assert.equal(peutInviter(proprio, 'patron', GRADES), true);
});

test('inviter une personne : son grade exact doit être autorisé à la création', () => {
  const d = droitsAgenda(GRADES, 'manager', false, { consulter: ['agent', 'manager'], creer: ['agent'], modifier: ['manager'] });
  assert.equal(peutInviter(d, 'agent', GRADES), true);
  assert.equal(peutInviter(d, 'manager', GRADES), false);
  assert.equal(peutInviter(d, 'directeur', GRADES), false);
  assert.equal(peutInviter(d, null, GRADES), false, 'fiche sans grade connu : refus par défaut');
});

test('anti-escalade : on ne donne accès qu’à son grade ou aux grades en dessous', () => {
  assert.equal(gradeAccordable('manager', GRADES, 'manager', false), true);
  assert.equal(gradeAccordable('agent', GRADES, 'manager', false), true);
  assert.equal(gradeAccordable('directeur', GRADES, 'manager', false), false);
  assert.equal(gradeAccordable('patron', GRADES, null, true), true);
  assert.equal(gradeAccordable('inconnu', GRADES, null, true), false);
});

test('création et modification doivent être des sous-ensembles de la consultation', () => {
  assert.equal(droitsInclusDansConsultation(['manager', 'agent'], ['agent']), true);
  assert.equal(droitsInclusDansConsultation(['manager'], ['agent']), false);
  assert.equal(droitsInclusDansConsultation([], []), true);
});

test('heure de Paris, été comme hiver et jours de changement d’heure', () => {
  assert.equal(parisVersDate('2026-07-14', '14:30').toISOString(), '2026-07-14T12:30:00.000Z');
  assert.equal(parisVersDate('2026-12-24', '20:00').toISOString(), '2026-12-24T19:00:00.000Z');
  assert.equal(parisVersDate('2026-03-29', '12:00').toISOString(), '2026-03-29T10:00:00.000Z');
  assert.equal(parisVersDate('2026-10-25', '12:00').toISOString(), '2026-10-25T11:00:00.000Z');
});

test('ticket de la personne : catégorie réglée, permission à son nom, le plus récent', () => {
  const moi = '411111111111111111', autre = '422222222222222222', cat = '900000000000000001';
  const salon = (id: string, parent: string, membre: string, type = 0) => ({ id, type, parent_id: parent, permission_overwrites: [{ id: membre, type: 1 }, { id: '900000000000000009', type: 0 }] });
  const salons = [
    salon('1300000000000000001', cat, moi),
    salon('1300000000000000005', cat, moi),
    salon('1300000000000000009', cat, autre),                         // ticket d'un autre
    salon('1300000000000000010', '900000000000000002', moi),          // hors des catégories réglées
    salon('1300000000000000011', cat, moi, 2),                        // salon vocal
    { id: '1300000000000000012', type: 0, parent_id: cat, permission_overwrites: [{ id: moi, type: 0 }] }, // rôle, pas membre
  ];
  assert.equal(choisirTicket(salons, moi, [cat]), '1300000000000000005');
  assert.equal(choisirTicket(salons, '433333333333333333', [cat]), null);
  assert.equal(choisirTicket(salons, moi, []), null);
  assert.equal(choisirTicket({ message: 'erreur' }, moi, [cat]), null, 'réponse inattendue : aucun ticket');
});

test('on n’accorde que des droits d’agenda qu’on a soi-même ; retirer ou garder reste libre', () => {
  const G = ['patron', 'manager', 'agent'];
  const manager = droitsAgenda(G, 'manager', false, { consulter: ['agent'], creer: ['agent'], modifier: [] });
  // le manager ne voit pas les événements « manager » : il ne peut pas les ouvrir aux agents
  assert.deepEqual(ajoutsNonDetenus(manager, manager.consulter, [], ['manager', 'agent']), ['manager']);
  assert.deepEqual(ajoutsNonDetenus(manager, manager.modifier, [], ['agent']), ['agent'], 'modifier : il ne l’a pas');
  assert.deepEqual(ajoutsNonDetenus(manager, manager.consulter, ['manager', 'agent'], ['manager']), [], 'droit déjà accordé par un supérieur : gardé');
  assert.deepEqual(ajoutsNonDetenus(manager, manager.consulter, ['manager'], []), [], 'retirer : toujours permis');
  const proprietaire = droitsAgenda(G, null, true, null);
  assert.deepEqual(ajoutsNonDetenus(proprietaire, proprietaire.consulter, [], G), [], 'le propriétaire a tout');
});
