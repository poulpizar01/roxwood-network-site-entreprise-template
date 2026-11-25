// SOCLE — grade d'un compte à sa connexion Discord : fonction pure (sans base ni configuration), testée par
// test/socle-grades.test.ts. Appelée par routes/auth.ts avec les grades du sommet à la base.
//  - grade par rôle : le plus élevé dont le rôle Discord est porté ;
//  - un grade lié à un rôle que le compte ne porte plus est retiré (rétrogradé ou parti sur Discord) ;
//  - un grade sans rôle Discord (attribué à la main) est conservé, sauf pour un ancien propriétaire (serveur transféré) :
//    il a pu se l'attribuer lui-même ;
//  - un grade attribué à la main plus haut que celui du rôle l'emporte : sinon, quiconque gère un grade inférieur le
//    lierait à un rôle porté par tous (« Membre ») et ferait tomber ses supérieurs à leur connexion suivante.
type GradeRole = { cle: string; roleDiscordId: string | null };

export function gradeALaConnexion(grades: readonly GradeRole[], roles: readonly string[], actuelCle: string | null | undefined, exProprietaire: boolean) {
  const rang = (cle: string | null | undefined) => { const i = grades.findIndex(g => g.cle === cle); return i < 0 ? grades.length : i; };
  const parRole = grades.find(g => g.roleDiscordId && roles.includes(g.roleDiscordId))?.cle ?? null;
  const actuel = grades.find(g => g.cle === actuelCle);
  const roleRetire = !!actuel?.roleDiscordId && !roles.includes(actuel.roleDiscordId);
  const conserve = !actuel || roleRetire || (exProprietaire && !actuel.roleDiscordId) ? null : actuel.cle;
  const manuelPlusHaut = !!conserve && !actuel?.roleDiscordId && rang(conserve) < rang(parRole);
  return { grade: manuelPlusHaut ? conserve : parRole ?? conserve, parRole };
}

// Compte relu par le bot entre deux connexions (synchro-discord.ts) : mêmes règles qu'à la connexion. roles : rôles
// portés sur le serveur, ou null si le membre n'y est plus (ses grades liés à un rôle tombent, il est marqué parti).
// Un compte en attente qui reçoit un grade par son rôle est validé, comme à la connexion ; un refusé n'est jamais lu.
type CompteLu = { gradeCle: string | null; statut: string; rolesDiscord: readonly string[] };
export function synchroCompte(grades: readonly GradeRole[], compte: CompteLu, roles: readonly string[] | null) {
  const portes = roles ?? [];
  const { grade, parRole } = gradeALaConnexion(grades, portes, compte.gradeCle, false);
  const valider = !!roles && compte.statut === 'attente' && !!parRole && grade === parRole;
  const memesRoles = portes.length === compte.rolesDiscord.length && portes.every(r => compte.rolesDiscord.includes(r));
  return { parti: roles === null, gradeCle: grade, valider, change: roles === null || grade !== compte.gradeCle || valider || !memesRoles };
}
