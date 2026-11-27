// SOCLE — image donnée par son adresse (src/socle/telechargement.ts) : le serveur ne doit jamais joindre une adresse
// interne à la demande d'un utilisateur, ni lire sans limite. Une régression ici ne se voit pas à l'écran.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { adresseImage, LienRefuse, lireBorne, telecharger } from '../src/socle/telechargement.js';

test('adresses refusées avant toute connexion', async () => {
  for (const u of ['', 'pas une adresse', 'http://exemple.fr/a.png', 'file:///etc/passwd', 'https://exemple.fr:8443/a.png',
    'https://moi:x@exemple.fr/a.png', 'https://127.0.0.1/a.png', 'https://[::1]/a.png', 'https://[::ffff:127.0.0.1]/a.png',
    'https://2130706433/a.png', 'https://169.254.169.254/', 'https://localhost/a.png', 'https://db/a.png', 'https://host.docker.internal/a.png']) {
    await assert.rejects(telecharger(u, 1000), LienRefuse, u);
  }
});

test('une redirection est contrôlée comme la première adresse', () => {
  const depart = new URL('https://exemple.fr/a');
  assert.equal(adresseImage('/b.png', depart).href, 'https://exemple.fr/b.png');
  assert.throws(() => adresseImage('http://exemple.fr/b.png', depart), LienRefuse);
});

test('lecture bornée : au-delà de la limite, refus', async () => {
  const flux = () => Readable.from([Buffer.alloc(600), Buffer.alloc(600)]);
  assert.equal((await lireBorne(flux(), 1200)).length, 1200);
  await assert.rejects(lireBorne(flux(), 1000), LienRefuse);
});
