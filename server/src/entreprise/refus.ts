// ENTREPRISE — refus métier : un message à montrer tel quel à l'employé, avec son statut HTTP (400 par défaut).
import type { Request, Response } from 'express';

export class Refus extends Error { constructor(message: string, public status = 400) { super(message); } }

// route dont les refus métier sont rendus avec leur statut et leur message ; toute autre erreur suit son cours (500)
export const traiter = (f: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
  try { await f(req, res); }
  catch (e) { if (e instanceof Refus) res.status(e.status).json({ error: e.message }); else throw e; }
};
