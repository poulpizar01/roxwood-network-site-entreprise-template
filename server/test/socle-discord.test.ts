// SOCLE — appels au bot Discord (src/socle/discord.ts) : un message posté ne notifie que les personnes visées, quoi que
// contienne son texte, et une erreur de Discord garde son statut. Discord n'est jamais appelé (fetch remplacé).
import test from 'node:test';
import assert from 'node:assert/strict';

// forcé, même en dev où le conteneur porte DISCORD_BOT_TOKEN=simulation : le faux bot répondrait à la place de fetch
process.env.DISCORD_BOT_TOKEN = 'jeton-de-test';
const { posterMessage, appelBot, ErreurDiscord } = await import('../src/socle/discord.js');
const { appelSimule } = await import('../src/socle/discord-simulation.js');

const appels: { url: string; init: RequestInit }[] = [];
let reponse = () => new Response(JSON.stringify({ id: '1300000000000000001' }), { status: 200 });
globalThis.fetch = (async (url: string, init: RequestInit) => { appels.push({ url, init }); return reponse(); }) as typeof fetch;

test('message posté : mentions limitées aux personnes visées', async () => {
  const id = await posterMessage('1200000000000000001', { content: '@everyone <@&1100000000000000001> réunion' }, ['411111111111111111']);
  assert.equal(id, '1300000000000000001');
  const corps = JSON.parse(String(appels.at(-1)!.init.body));
  assert.deepEqual(corps.allowed_mentions, { parse: [], users: ['411111111111111111'] });
  assert.match(appels.at(-1)!.url, /\/channels\/1200000000000000001\/messages$/);
});

test('identifiant invalide : refusé avant tout appel', async () => {
  const avant = appels.length;
  await assert.rejects(posterMessage('../guilds/1', { content: 'x' }));
  await assert.rejects(posterMessage('1200000000000000001', { content: 'x' }, ['everyone']));
  assert.equal(appels.length, avant);
});

test('erreur de Discord : statut gardé', async () => {
  reponse = () => new Response('{}', { status: 403 });
  await assert.rejects(appelBot('GET', '/guilds/1200000000000000001/channels'), (e: unknown) => e instanceof ErreurDiscord && e.statut === 403);
});

test('faux bot : ouvre une conversation privée et garde le message', async () => {
  const personne = '411111111111111111';
  const canal = await appelSimule('POST', '/users/@me/channels', { recipient_id: personne }) as { id: string };
  assert.match(canal.id, /^\d{15,22}$/);
  const canalRetrouve = await appelSimule('POST', '/users/@me/channels', { recipient_id: personne }) as { id: string };
  assert.equal(canalRetrouve.id, canal.id);
  const message = await appelSimule('POST', `/channels/${canal.id}/messages`, { content: 'Rendez-vous demain' }) as { id: string };
  assert.match(message.id, /^\d{15,22}$/);
  const lus = await appelSimule('GET', `/channels/${canal.id}/messages?limit=10`) as { content: string }[];
  assert.deepEqual(lus.map(m => m.content), ['Rendez-vous demain']);
});

test('faux bot : crée un salon (ex. un salon privé par dossier) et y poste un message', async () => {
  const salon = await appelSimule('POST', '/guilds/1000000000000000001/channels', {
    name: 'Demande #12', type: 0, parent_id: '900000000000000101', permission_overwrites: [{ id: '900000000000000002', type: 0, allow: '1024' }],
  }) as { id: string; name: string; parent_id: string; permission_overwrites: unknown[] };
  assert.match(salon.id, /^\d{15,22}$/);
  assert.equal(salon.name, 'Demande #12');
  assert.equal(salon.parent_id, '900000000000000101');
  assert.deepEqual(salon.permission_overwrites, [{ id: '900000000000000002', type: 0, allow: '1024' }]);
  const message = await appelSimule('POST', `/channels/${salon.id}/messages`, { content: 'Dossier ouvert' }) as { id: string };
  assert.match(message.id, /^\d{15,22}$/);
  const lus = await appelSimule('GET', `/channels/${salon.id}/messages`) as { content: string }[];
  assert.deepEqual(lus.map(m => m.content), ['Dossier ouvert']);
});

test('faux bot : création de salon sans nom, refusée', async () => {
  await assert.rejects(appelSimule('POST', '/guilds/1000000000000000001/channels', { type: 0 }), (e: unknown) => e instanceof ErreurDiscord && e.statut === 400);
});
