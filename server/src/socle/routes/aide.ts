// SOCLE — aide en ligne : lecture seule, ouverte à tout compte connecté (même en attente, D9 : les articles
// « Premiers pas » restent accessibles avant validation — le filtrage par page/permission s'applique quand même).
import { Router } from 'express';
import { avecCompte } from '../http.js';
import { articleAide, chercherAide, indexAide } from '../aide.js';

export const aide = Router();

aide.get('/api/aide', ...avecCompte, (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  res.json(q.trim() ? { resultats: chercherAide(req.compte, q) } : { articles: indexAide(req.compte) });
});

aide.get('/api/aide/:slug', ...avecCompte, (req, res) => {
  const article = articleAide(req.compte, String(req.params.slug));
  if (!article) { res.status(404).json({ error: 'introuvable' }); return; }
  res.json(article);
});
