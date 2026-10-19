// ENTREPRISE — lecture d'un événement « monitoring.duty » du bot Discord entreprise (services.ts) : fonctions pures,
// sans base ni réseau, testées par test/services.test.ts. Le bot lit les journaux FiveM (« prise de service (…) » /
// « fin de service (…) ») et envoie les champs du journal : playerDiscord, playerName, jobId, description, et
// parsed.direction (in | out). Forme vérifiée dans le code du bot (src/services/monitoringService.ts).

export const normaliser = (v: unknown): string =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export type EvenementDuty = { sens: 'debut' | 'fin'; discordId: string; nom: string; instant: Date; serviceId: string };

// Un événement du bot → prise ou fin de service, ou null si la forme n'est pas la bonne (ignoré, jamais deviné).
// L'heure est celle de l'envoi par le bot (quelques secondes après le journal) ; le même événement renvoyé garde la
// même heure, donc le même identifiant : il ne crée rien de plus.
export function lireDuty(payload: unknown, sentAt: unknown): EvenementDuty | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const direction = (p.parsed as { direction?: unknown } | null | undefined)?.direction;
  const sens = direction === 'in' ? 'debut' : direction === 'out' ? 'fin' : null;
  if (!sens) return null;
  const discordId = String(p.playerDiscord ?? '').trim();
  if (!/^\d{15,22}$/.test(discordId)) return null;
  const instant = new Date(String(sentAt ?? ''));
  if (Number.isNaN(instant.getTime())) return null;
  const nom = String(p.playerName ?? '').replace(/[`*_<>@]/g, '').trim().slice(0, 120);
  return { sens, discordId, nom, instant, serviceId: `duty-${discordId}-${instant.getTime()}` };
}
