// SOCLE — Aide en ligne (src/socle/aide.ts) : un article ou un passage réservé à une permission ne doit jamais
// atteindre un compte qui ne l'a pas — c'est un contrôle de sécurité, pas un simple affichage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { _chargerArticlesDepuis, articleAide, chercherAide, declarerNiveauPage, indexAide } from '../src/socle/aide.js';
import type { Compte } from '../src/generated/prisma/client.js';

declarerNiveauPage({ accueil: 'valide', facturation: 'factures', vitrine: 'connecte', index: 'public' });

// Un compte sans grade a un jeu de permissions vide tant qu'aucun grade n'est chargé en base (droits.ts, module non
// sollicité ici) : il sert à tester « sans la permission ». proprietaire: true contourne tout (super-admin).
const compte = (statut: string, proprietaire = false): Compte => ({ statut, proprietaire, gradeCle: null } as unknown as Compte);
const VALIDE = compte('valide');
const ATTENTE = compte('attente');
const PROPRIETAIRE = compte('valide', true);

test('article sur une page « valide » : exige un compte validé, rien de plus', () => {
  _chargerArticlesDepuis({ accueil: '---\ntitre: Vue d’ensemble\nrubrique: accueil\n---\nTexte visible de tous les comptes validés.' });
  assert.ok(articleAide(VALIDE, 'accueil'));
  assert.equal(articleAide(ATTENTE, 'accueil'), null);
  assert.equal(articleAide(null, 'accueil'), null);
});

test('article sur une page « connecte » (D9) : lisible avant validation', () => {
  _chargerArticlesDepuis({ bienvenue: '---\ntitre: Bienvenue\nrubrique: vitrine\n---\nPremiers pas.' });
  assert.ok(articleAide(ATTENTE, 'bienvenue'));
  assert.equal(articleAide(null, 'bienvenue'), null);
});

test('article sur une page à permission : hérite du niveau de la page (D3)', () => {
  _chargerArticlesDepuis({ facturer: '---\ntitre: Facturer\nrubrique: facturation\n---\nTexte.' });
  assert.equal(articleAide(VALIDE, 'facturer'), null);       // compte validé mais sans la permission « factures »
  assert.ok(articleAide(PROPRIETAIRE, 'facturer'));          // le super-admin a tout
});

test('permission en en-tête surcharge celle de la page (D3)', () => {
  _chargerArticlesDepuis({ reserve: '---\ntitre: Réglages avancés\nrubrique: accueil\npermission: factures\n---\nTexte.' });
  assert.equal(articleAide(VALIDE, 'reserve'), null);        // accueil est « valide », mais l'article exige « factures »
  assert.ok(articleAide(PROPRIETAIRE, 'reserve'));
});

test('passage réservé (::: si) retiré du HTML, jamais seulement masqué (D2, D8)', () => {
  _chargerArticlesDepuis({
    mixte: ['---', 'titre: Mixte', 'rubrique: accueil', '---',
      'Visible de tous.', '',
      '::: si factures', 'Visible seulement avec « Gérer les factures ».', ':::', ''].join('\n'),
  });
  const pourValide = articleAide(VALIDE, 'mixte')!;
  assert.match(pourValide.html, /Visible de tous/);
  assert.doesNotMatch(pourValide.html, /Visible seulement/);   // jamais envoyé, pas seulement caché par du CSS

  const pourProprio = articleAide(PROPRIETAIRE, 'mixte')!;
  assert.match(pourProprio.html, /Visible seulement/);
  assert.match(pourProprio.html, /Visible parce que vous avez/);   // bandeau D8
});

test('index : seuls les articles accessibles au compte apparaissent', () => {
  _chargerArticlesDepuis({
    publique: '---\ntitre: Publique\nrubrique: vitrine\n---\nTexte.',
    privee: '---\ntitre: Privée\nrubrique: facturation\n---\nTexte.',
  });
  const vu = indexAide(ATTENTE).map(a => a.slug);
  assert.deepEqual(vu, ['publique']);
  assert.deepEqual(indexAide(PROPRIETAIRE).map(a => a.slug).sort(), ['privee', 'publique']);
});

test('recherche : ignore les accents, ne porte jamais sur un passage réservé', () => {
  _chargerArticlesDepuis({
    echeance: ['---', 'titre: Facturer une échéance', 'rubrique: accueil', 'mots-cles: échéancier, contrat', '---',
      'Texte ordinaire.', '', '::: si factures', 'Cliquez sur Facturer la sélection.', ':::', ''].join('\n'),
  });
  assert.equal(chercherAide(VALIDE, 'echeance').length, 1);                 // « echeance » trouve « échéance » (titre)
  assert.equal(chercherAide(VALIDE, 'facturer la selection').length, 0);    // passage réservé : absent pour ce compte
  assert.equal(chercherAide(PROPRIETAIRE, 'facturer la selection').length, 1);
});

test('fins de ligne CRLF (checkout Windows) : l’en-tête se lit quand même', () => {
  _chargerArticlesDepuis({ crlf: '---\r\ntitre: Se connecter\r\nrubrique: accueil\r\n---\r\nTexte.\r\n' });
  const a = articleAide(VALIDE, 'crlf');
  assert.ok(a, 'article ignoré : en-tête mal lue sur un fichier CRLF');
  assert.equal(a!.titre, 'Se connecter');
});

test('légende d’un schéma : [cle] facultative pour la zone, jamais affichée (le libellé reste une phrase lisible)', () => {
  _chargerArticlesDepuis({
    s: ['---', 'titre: Essai', 'rubrique: accueil', '---',
      '::: schema accueil', '1 [terminer-service] Terminer le service : bouton [Terminer mon service]', '2 Coordonnées : votre fiche', ':::', ''].join('\n'),
  });
  const html = articleAide(VALIDE, 's')!.html;
  assert.match(html, /data-zone-ref="terminer-service"/);
  assert.match(html, /<b>Terminer le service<\/b>/);
  assert.doesNotMatch(html, /terminer-service</);   // la clé interne ne doit jamais apparaître comme texte lisible
  assert.match(html, /<b>Coordonnées<\/b>/);         // sans [cle] : pas de data-zone-ref, mais un libellé normal
  assert.doesNotMatch(html, /data-zone-ref="Coordonnées"/);
});

test('article inconnu ou rubrique non déclarée : 404 plutôt qu’une erreur', () => {
  _chargerArticlesDepuis({});
  assert.equal(articleAide(PROPRIETAIRE, 'inexistant'), null);
  _chargerArticlesDepuis({ orpheline: '---\ntitre: Orpheline\nrubrique: page-qui-nexiste-pas\n---\nTexte.' });
  assert.ok(articleAide(VALIDE, 'orpheline'));                 // rubrique inconnue : exige un compte validé, par défaut
  assert.equal(articleAide(ATTENTE, 'orpheline'), null);
});

test('schéma et étapes d’aperçu : lus dans les passages visibles seulement, jamais dans un « si » réservé', () => {
  _chargerArticlesDepuis({
    apercu: ['---', 'titre: Aperçu', 'rubrique: accueil', 'type: faq', 'suggestion: oui', '---',
      '::: schema liste', '1 Liste : les lignes', ':::', '',
      '::: etapes', '**Ouvrez** la ligne', '**Cliquez** ici', ':::', '',
      '::: si factures', '::: schema secret', '1 Secret : réservé', ':::', ':::'].join('\n'),
  });
  const visible = indexAide(VALIDE).find(a => a.slug === 'apercu');
  assert.deepEqual(visible?.etapes, ['Ouvrez la ligne', 'Cliquez ici']);
  assert.equal(visible?.schema, 'liste');
  assert.equal(visible?.type, 'faq');
  assert.equal(visible?.suggestion, true);
  assert.equal(JSON.stringify(articleAide(VALIDE, 'apercu')).includes('secret'), false);
});

test('pastilles « Vous pouvez… » : calculées d’après les droits du lecteur, jamais écrites', () => {
  _chargerArticlesDepuis({
    facturer: ['---', 'titre: Facturer', 'rubrique: facturation', '---', 'Texte.', '::: si factures', 'Réservé.', ':::'].join('\n'),
    simple: '---\ntitre: Simple\nrubrique: accueil\n---\nTexte.',
  });
  assert.equal(articleAide(PROPRIETAIRE, 'facturer')?.pastilles.length, 1);   // « factures » cité deux fois, une seule pastille
  assert.match(articleAide(PROPRIETAIRE, 'facturer')?.pastilles[0] ?? '', /^Vous pouvez /);
  assert.deepEqual(articleAide(VALIDE, 'simple')?.pastilles, []);              // niveau « valide » : pas une permission
});

test('« Voir aussi » : seuls les articles que le lecteur peut ouvrir, durée de lecture au moins une minute', () => {
  _chargerArticlesDepuis({
    a: '---\ntitre: A\nrubrique: accueil\nvoir-aussi: b, c, absent\n---\nTexte.',
    b: '---\ntitre: B\nrubrique: accueil\n---\nTexte.',
    c: '---\ntitre: C\nrubrique: facturation\n---\nTexte.',
  });
  const art = articleAide(VALIDE, 'a');
  assert.deepEqual(art?.voirAussi.map(v => v.slug), ['b']);   // c exige « factures », absent n'existe pas
  assert.equal(art?.minutes, 1);
});

test('cycle de statut : sous-titres, légende de flèche, état à part', () => {
  _chargerArticlesDepuis({
    cycle: ['---', 'titre: Cycle', 'rubrique: accueil', '---',
      '::: cycle À venir (pas encore facturée) > ~facturer > Facturée (facture émise) > Réglée | Annulée (retour à « À venir »)', ':::'].join('\n'),
  });
  const html = articleAide(VALIDE, 'cycle')?.html ?? '';
  assert.equal((html.match(/class="etat"/g) ?? []).length, 3);
  assert.match(html, /etat-a-part/);
  assert.match(html, /<small>pas encore facturée<\/small>/);
  assert.match(html, /facturer<\/span>/);       // légende de la première flèche seulement
  assert.equal((html.match(/class="fl"/g) ?? []).length, 2);
});
