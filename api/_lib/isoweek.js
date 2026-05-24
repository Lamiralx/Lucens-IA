/**
 * V39 fix F-07 + F-14 — Calcul ISO 8601 week unifié.
 *
 * Pourquoi un module dédié :
 *   feedback.js et lucens-stats.js calculaient la semaine ISO différemment
 *   (l'un en UTC, l'autre en local + formule "approximative"). En semaines
 *   de transition (52/53 d'une année, 1 de la suivante), les clés KV
 *   différaient, brisant les agrégations hebdomadaires.
 *
 * Algorithme ISO 8601 :
 *   1. Semaine 1 = semaine contenant le premier jeudi de l'année.
 *   2. Lundi est le 1er jour de la semaine (day 1 ... 7=dimanche).
 *   3. Le year-week d'une date dépend du jeudi de SA semaine, pas de sa propre année.
 *
 * Formule utilisée (variante "nearest Thursday") :
 *   - On clone la date en UTC pur (élimine toute ambiguïté de fuseau).
 *   - On la décale vers le jeudi de sa semaine ISO.
 *   - Le numéro de semaine = nombre de jours depuis le 1er janvier de
 *     l'année du jeudi, divisé par 7, plus 1.
 */

/**
 * Retourne le tuple ISO [year, week] d'une date.
 * @param {Date|number|string} input
 * @returns {{ year: number, week: number }}
 */
export function isoYearWeek(input) {
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  /* Force UTC pour éliminer les drifts de fuseau Vercel Functions. */
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  /* getUTCDay : 0=Sun, 1=Mon, ..., 6=Sat. ISO veut 1=Mon, ..., 7=Sun.
     On décale la date vers le jeudi de sa semaine ISO (jour 4). */
  const dayNum = utc.getUTCDay() || 7;        /* dimanche devient 7 */
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  /* L'année ISO est l'année du jeudi. */
  const isoYear = utc.getUTCFullYear();
  /* Jour 1 de l'année du jeudi (1er janvier UTC). */
  const jan1 = new Date(Date.UTC(isoYear, 0, 1));
  const diffDays = (utc - jan1) / 86400000;
  const week = Math.floor(diffDays / 7) + 1;
  return { year: isoYear, week };
}

/**
 * Retourne la clé canonique "YYYY-Www" (ex: "2026-W22").
 * Utilisable directement comme clé KV (lucens:stats:weekly:YYYY-Www).
 */
export function isoWeekKey(input) {
  const { year, week } = isoYearWeek(input);
  return year + '-W' + String(week).padStart(2, '0');
}
