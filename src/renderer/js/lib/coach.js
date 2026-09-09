/**
 * Der Coach.
 *
 * Regelwerk, das aus den eigenen Zahlen konkrete Verbesserungsvorschlaege
 * ableitet. Jede Regel prueft eine Bedingung und liefert – wenn sie zutrifft –
 * einen Hinweis mit Begruendung und einem Schritt, der sofort machbar ist.
 *
 * Grundsaetze:
 * - Nie raten. Eine Regel greift erst, wenn genug Daten da sind.
 * - Immer benennen, worauf sich der Hinweis stuetzt.
 * - Hoechstens ein Hinweis je Thema, sonst wird es Laerm.
 */

import * as store from './store.js';
import * as fmt from './format.js';
import * as an from './analytics.js';
import { platform, platformName, metric, PLATFORMS } from './platforms.js';

/** Gewicht eines Hinweises: bestimmt die Reihenfolge. */
const PRIORITY = { danger: 3, warn: 2, ok: 1, info: 1 };

const insight = (id, tone, icon, title, body, action = null, evidence = null) =>
  ({ id, tone, icon, title, body, action, evidence, weight: PRIORITY[tone] || 1 });

// ------------------------------------------------------------------ Regeln

/** Jede Regel bekommt denselben Kontext und liefert 0..n Hinweise. */
const RULES = [
  // --- Arbeitsweise ------------------------------------------------------
  function nothingScheduled({ posts }) {
    const upcoming = posts.filter((post) => post.status === 'scheduled' && new Date(post.scheduledAt) > new Date());
    if (upcoming.length) return null;
    return insight(
      'nothing-scheduled', 'warn', '◷',
      'Nichts steht im Kalender',
      'Es ist kein Beitrag mehr eingeplant. Regelmässigkeit ist der stärkste Hebel überhaupt – wer nach einer Pause zurückkommt, startet bei fast jedem Kanal wieder von vorn.',
      { label: 'Beitrag einplanen', view: 'composer' }
    );
  },

  function missedPosts({ posts }) {
    const missed = posts.filter((post) => post.status === 'missed');
    if (!missed.length) return null;
    return insight(
      'missed', 'danger', '!',
      `${fmt.plural(missed.length, 'verpasster Termin', 'verpasste Termine')}`,
      'Diese Beiträge sind an ihrem Termin nicht rausgegangen. Entweder neu einplanen oder bewusst verwerfen – liegen bleiben ist die schlechteste Variante.',
      { label: 'Zur Warteschlange', view: 'queue' }
    );
  },

  function cadence({ posts, settings }) {
    const published = posts
      .filter((post) => post.status === 'published' && post.publishedAt)
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    if (published.length < 3) return null;

    const daysSince = Math.floor((Date.now() - new Date(published[0].publishedAt)) / 86400000);
    const goal = settings.weeklyGoal?.posts || 3;
    const expectedGap = Math.ceil(7 / Math.max(1, goal));

    if (daysSince <= expectedGap * 2) return null;
    return insight(
      'cadence', 'warn', '◔',
      `Seit ${fmt.plural(daysSince, 'Tag', 'Tagen')} nichts veröffentlicht`,
      `Dein Ziel sind ${goal} Beiträge pro Woche, das wären rund alle ${expectedGap} Tage einer. Eine kleinere, aber gehaltene Frequenz schlägt jeden Schub gefolgt von Funkstille.`,
      { label: 'Ideen sichten', view: 'ideas' },
      `Letzte Veröffentlichung: ${fmt.date(published[0].publishedAt)}`
    );
  },

  function weeklyGoal({ posts, settings }) {
    const goal = settings.weeklyGoal?.posts || 0;
    if (!goal) return null;
    const weekStart = fmt.startOfWeek(new Date(), settings.startOfWeek ?? 1);
    const done = posts.filter(
      (post) => post.status === 'published' && post.publishedAt && new Date(post.publishedAt) >= weekStart
    ).length;
    const planned = posts.filter(
      (post) => post.status === 'scheduled' && new Date(post.scheduledAt) >= weekStart
    ).length;
    if (done + planned >= goal) {
      if (!done) return null;
      return insight(
        'weekly-goal-ok', 'ok', '✓',
        'Wochenziel ist gedeckt',
        `${done} veröffentlicht, ${planned} eingeplant – zusammen erreichst du dein Ziel von ${goal}. Gute Grundlage, um an der Qualität statt an der Menge zu arbeiten.`
      );
    }
    return insight(
      'weekly-goal', 'info', '◎',
      `Noch ${goal - done - planned} bis zum Wochenziel`,
      `Diese Woche: ${done} veröffentlicht, ${planned} eingeplant, Ziel ${goal}. Die Lücke schliesst sich am schnellsten, indem du eine bestehende Idee auf einen freien Termin ziehst.`,
      { label: 'Warteschlange füllen', view: 'queue' }
    );
  },

  function ideaPipeline({ ideas }) {
    const open = ideas.filter((idea) => !['done', 'archived'].includes(idea.status));
    if (open.length >= 8) return null;
    return insight(
      'idea-pipeline', open.length < 3 ? 'warn' : 'info', '✦',
      open.length < 3 ? 'Der Ideenvorrat ist fast leer' : 'Der Ideenvorrat wird dünn',
      `Nur ${fmt.plural(open.length, 'offene Idee', 'offene Ideen')} liegen bereit. Ein Vorrat von zehn bis fünfzehn nimmt den Druck aus der Produktion – ohne ihn entsteht der Inhalt am Ende immer unter Zeitnot.`,
      { label: 'Ideen erzeugen', view: 'ideas' }
    );
  },

  // --- Kanaele ----------------------------------------------------------
  function neglectedChannel({ posts, settings }) {
    const active = settings.activePlatforms || [];
    if (active.length < 2) return null;
    const lastUse = new Map();
    for (const post of posts) {
      const at = post.publishedAt || (post.status === 'scheduled' ? post.scheduledAt : null);
      if (!at) continue;
      for (const id of post.platforms || []) {
        const time = new Date(at).getTime();
        if (!lastUse.has(id) || lastUse.get(id) < time) lastUse.set(id, time);
      }
    }
    const stale = active
      .map((id) => ({ id, last: lastUse.get(id) || 0 }))
      .filter((row) => Date.now() - row.last > 21 * 86400000)
      .sort((a, b) => a.last - b.last);
    if (!stale.length) return null;
    const worst = stale[0];
    return insight(
      'neglected-channel', 'info', '⬡',
      `${platformName(worst.id)} liegt brach`,
      worst.last
        ? `Dort ging seit ${fmt.relative(worst.last)} nichts mehr raus, obwohl der Kanal aktiv ist. Entweder wieder bespielen – oder in den Einstellungen abschalten, damit die Übersicht ehrlich bleibt.`
        : `Für diesen Kanal ist noch nie etwas geplant worden. Entweder starten oder in den Einstellungen abwählen.`,
      { label: 'Kanäle prüfen', view: 'channels' }
    );
  },

  function crossPosting({ posts }) {
    const recent = posts.filter((post) => ['published', 'scheduled', 'due'].includes(post.status)).slice(0, 25);
    if (recent.length < 5) return null;
    const singles = recent.filter((post) => (post.platforms || []).length === 1);
    if (singles.length / recent.length < 0.7) return null;
    return insight(
      'cross-posting', 'info', '⇄',
      'Fast alles läuft nur auf einem Kanal',
      `${singles.length} von ${recent.length} Beiträgen gehen an genau eine Plattform. Ein Langvideo trägt mühelos einen Kurzclip, einen Textbeitrag und einen Blogeintrag – dieselbe Arbeit, mehrfache Reichweite.`,
      { label: 'Beitrag mehrfach ausspielen', view: 'composer' }
    );
  },

  // --- Zahlenpflege ------------------------------------------------------
  function staleAnalytics({ analytics, posts }) {
    const publishedCount = posts.filter((post) => post.status === 'published').length;
    if (publishedCount < 3) return null;
    if (!analytics.length) {
      return insight(
        'no-analytics', 'warn', '◫',
        'Es sind noch keine Zahlen erfasst',
        'Ohne Messwerte bleibt jede Verbesserung Bauchgefühl. Der schnellste Weg: den CSV-Export aus dem jeweiligen Studio einlesen – das dauert zwei Minuten und schaltet die halbe Auswertung frei.',
        { label: 'Zahlen erfassen', view: 'analytics' }
      );
    }
    const newest = analytics.map((entry) => entry.date).sort().at(-1);
    const daysSince = Math.floor((Date.now() - new Date(newest).getTime()) / 86400000);
    if (daysSince < 14) return null;
    return insight(
      'stale-analytics', 'info', '◫',
      `Die Zahlen sind ${daysSince} Tage alt`,
      'Neuere Werte machen die Empfehlungen deutlich schärfer – vor allem beim besten Zeitfenster und beim stärksten Format.',
      { label: 'Zahlen nachtragen', view: 'analytics' }
    );
  },

  // --- Auswertung --------------------------------------------------------
  function bestHour() {
    const hours = an.byHour('views', { days: 120 }).filter((row) => row.count >= 2);
    if (hours.length < 3) return null;
    const sorted = [...hours].sort((a, b) => b.value - a.value);
    const best = sorted[0];
    const rest = sorted.slice(1);
    const restAvg = rest.reduce((sum, row) => sum + row.value, 0) / rest.length;
    if (!restAvg || best.value < restAvg * 1.3) return null;
    const lift = Math.round(((best.value - restAvg) / restAvg) * 100);
    return insight(
      'best-hour', 'ok', '◷',
      `Deine beste Uhrzeit ist ${String(best.hour).padStart(2, '0')}:00`,
      `Beiträge zu dieser Stunde erreichen im Schnitt ${lift} Prozent mehr Aufrufe als der Rest. Lege die wichtigsten Veröffentlichungen bewusst dorthin.`,
      { label: 'Zeitfenster übernehmen', view: 'queue' },
      `Grundlage: ${best.count} Beiträge um ${best.hour} Uhr, ${fmt.num(best.value, { compact: true })} Aufrufe im Schnitt`
    );
  },

  function bestWeekday() {
    const days = an.byWeekday('views', { days: 120 }).filter((row) => row.count >= 2);
    if (days.length < 4) return null;
    const sorted = [...days].sort((a, b) => b.value - a.value);
    const best = sorted[0];
    const worst = sorted.at(-1);
    if (!worst.value || best.value < worst.value * 1.8) return null;
    return insight(
      'best-weekday', 'info', '▦',
      `${fmt.weekdayName(best.day)} trägt am weitesten`,
      `Im Schnitt ${fmt.num(best.value, { compact: true })} Aufrufe gegenüber ${fmt.num(worst.value, { compact: true })} am ${fmt.weekdayName(worst.day)}. Die stärksten Inhalte gehören auf den starken Tag, Experimente auf den schwachen.`
    );
  },

  function bestFormat() {
    const formats = an.byFormat('views', { days: 120 }).filter((row) => row.count >= 2);
    if (formats.length < 2) return null;
    const [best] = formats;
    const worst = formats.at(-1);
    if (best.value < worst.value * 1.5) return null;
    return insight(
      'best-format', 'ok', '★',
      `Das Format „${best.format}“ funktioniert am besten`,
      `${fmt.num(best.value, { compact: true })} Aufrufe im Schnitt aus ${fmt.plural(best.count, 'Beitrag', 'Beiträgen')} – gegenüber ${fmt.num(worst.value, { compact: true })} bei „${worst.format}“. Mehr davon zu machen ist die günstigste Verbesserung, die es gibt.`,
      { label: 'Idee in diesem Format', view: 'ideas' }
    );
  },

  function lowCtr({ settings }) {
    for (const id of settings.activePlatforms || []) {
      const p = platform(id);
      if (!p?.metrics.includes('ctr')) continue;
      const list = an.inRange({ days: 90, platformId: id });
      if (list.length < 3) continue;
      const value = an.average(list, 'ctr');
      const benchmark = metric('ctr').benchmark || 5;
      if (value === null || value >= benchmark * 0.8) continue;
      return insight(
        'low-ctr', 'warn', '◐',
        `Schwache Klickrate auf ${p.name}`,
        `Im Schnitt ${fmt.percent(value)} gegenüber einem üblichen Wert um ${benchmark} Prozent. Das ist fast immer die Verpackung, nicht der Inhalt: Thumbnail mit einem klaren Motiv, Titel mit einem Versprechen, beides in unter zwei Sekunden erfassbar.`,
        { label: 'Titel-Varianten erzeugen', view: 'ideas' },
        `Grundlage: ${list.length} Beiträge der letzten 90 Tage`
      );
    }
    return null;
  },

  function lowCompletion({ settings }) {
    for (const id of settings.activePlatforms || []) {
      const p = platform(id);
      if (!p?.metrics.includes('completionRate')) continue;
      const list = an.inRange({ days: 90, platformId: id });
      if (list.length < 3) continue;
      const value = an.average(list, 'completionRate');
      const benchmark = metric('completionRate').benchmark || 45;
      if (value === null || value >= benchmark * 0.8) continue;
      return insight(
        'low-completion', 'warn', '⚡',
        `Zu wenige sehen ${p.name}-Clips zu Ende`,
        `Abschlussrate im Schnitt ${fmt.percent(value)}, üblich sind rund ${benchmark} Prozent. Die Ursache liegt fast immer in den ersten ${p.hookWindowSec || 3} Sekunden: Einleitung streichen, sofort mit der Aussage beginnen, Spannung erst am Ende auflösen.`,
        { label: 'Hooks überarbeiten', view: 'scripts' },
        `Grundlage: ${list.length} Beiträge der letzten 90 Tage`
      );
    }
    return null;
  },

  function trendDown({ settings }) {
    for (const id of settings.activePlatforms || []) {
      const list = an.inRange({ days: 30, platformId: id });
      if (list.length < 4) continue;
      const { current, previous, change } = an.compare('views', { days: 30, platformId: id });
      if (change === null || change > -0.25) continue;
      return insight(
        'trend-down', 'warn', '↘',
        `${platformName(id)} verliert an Reichweite`,
        `${fmt.num(current, { compact: true })} gegenüber ${fmt.num(previous, { compact: true })} Aufrufen im Vormonat, ein Rückgang um ${Math.abs(Math.round(change * 100))} Prozent. Prüfe zuerst, ob sich Frequenz oder Format verändert haben – meist steckt dort die Ursache, nicht im Algorithmus.`,
        { label: 'Verlauf ansehen', view: 'analytics' }
      );
    }
    return null;
  },

  function trendUp({ settings }) {
    for (const id of settings.activePlatforms || []) {
      const list = an.inRange({ days: 30, platformId: id });
      if (list.length < 4) continue;
      const { current, previous, change } = an.compare('views', { days: 30, platformId: id });
      if (change === null || change < 0.4) continue;
      return insight(
        'trend-up', 'ok', '↗',
        `${platformName(id)} zieht deutlich an`,
        `${fmt.num(current, { compact: true })} statt ${fmt.num(previous, { compact: true })} Aufrufen, ein Plus von ${Math.round(change * 100)} Prozent. Jetzt ist der Moment, dort mehr zu investieren statt die Kraft breit zu verteilen.`
      );
    }
    return null;
  },

  function recycleWinner() {
    const top = an.topEntries('views', { days: 365, limit: 3 });
    if (!top.length) return null;
    const candidate = top.find((row) => Date.now() - new Date(row.entry.date).getTime() > 90 * 86400000);
    if (!candidate) return null;
    return insight(
      'recycle', 'info', '↻',
      'Ein alter Erfolg lohnt eine Neuauflage',
      `„${candidate.entry.title || 'Ein Beitrag'}“ vom ${fmt.date(candidate.entry.date)} liegt mit ${fmt.num(candidate.value, { compact: true })} Aufrufen weit vorn. Nach drei Monaten kennt der grösste Teil des Publikums ihn nicht – als Kurzfassung, Aktualisierung oder Gegenthese trägt das Thema erneut.`,
      { label: 'Neuauflage planen', view: 'composer' }
    );
  },

  // --- Handwerk ----------------------------------------------------------
  function checklistOpen({ posts }) {
    const soon = posts.filter((post) => {
      if (!['scheduled', 'due'].includes(post.status) || !post.checklist?.length) return false;
      const at = new Date(post.scheduledAt).getTime();
      return at - Date.now() < 48 * 3600000 && post.checklist.some((item) => !item.done);
    });
    if (!soon.length) return null;
    return insight(
      'checklist-open', 'info', '☑',
      `${fmt.plural(soon.length, 'Beitrag', 'Beiträge')} mit offener Checkliste`,
      'Der Termin ist in weniger als zwei Tagen, aber Thumbnail, Untertitel oder Beschreibung fehlen noch. Genau diese Restarbeiten kosten am Veröffentlichungstag die meiste Nerven.',
      { label: 'Warteschlange öffnen', view: 'queue' }
    );
  },

  function twitchConsistency({ posts, settings }) {
    if (!(settings.activePlatforms || []).includes('twitch')) return null;
    const streams = posts
      .filter((post) => (post.platforms || []).includes('twitch') && post.status === 'published' && post.publishedAt)
      .map((post) => new Date(post.publishedAt))
      .sort((a, b) => b - a)
      .slice(0, 8);
    if (streams.length < 4) return null;
    const weekdays = new Set(streams.map((date) => date.getDay()));
    if (weekdays.size <= 3) return null;
    return insight(
      'twitch-consistency', 'warn', '◈',
      'Deine Streamzeiten sind schwer vorhersehbar',
      `Die letzten ${streams.length} Streams verteilen sich auf ${weekdays.size} verschiedene Wochentage. Auf Twitch entsteht Publikum durch Verlässlichkeit: zwei bis drei feste Termine bringen dauerhaft mehr Zuschauer im Schnitt als häufigeres, aber unregelmässiges Streamen.`,
      { label: 'Feste Zeitfenster anlegen', view: 'queue' }
    );
  },

  function shortsFromLong({ posts }) {
    const longform = posts.filter(
      (post) => post.status === 'published' &&
        (post.platforms || []).some((id) => platform(id)?.kind === 'video' || platform(id)?.kind === 'live')
    );
    if (longform.length < 3) return null;
    const shorts = posts.filter((post) => (post.platforms || []).some((id) => platform(id)?.kind === 'short'));
    if (shorts.length >= longform.length) return null;
    return insight(
      'shorts-from-long', 'info', '✂',
      'Aus langen Inhalten entstehen zu wenige Clips',
      `${fmt.plural(longform.length, 'langes Format', 'lange Formate')} stehen ${fmt.plural(shorts.length, 'Kurzclip', 'Kurzclips')} gegenüber. Zwei bis drei Ausschnitte pro Langvideo oder Stream sind Reichweite ohne zusätzlichen Dreh – und der beste Weg, neue Zuschauer zum Hauptkanal zu führen.`,
      { label: 'Clips einplanen', view: 'composer' }
    );
  },

  function platformTip({ settings }) {
    const ids = settings.activePlatforms?.length ? settings.activePlatforms : PLATFORMS.map((p) => p.id);
    const pool = ids.map((id) => platform(id)).filter((p) => p?.tips?.length);
    if (!pool.length) return null;
    // Ein Tipp pro Tag, aber stabil innerhalb des Tages.
    const seed = Number(fmt.dayKey().replaceAll('-', ''));
    const p = pool[seed % pool.length];
    const tip = p.tips[seed % p.tips.length];
    return insight(
      'daily-tip', 'info', '◆',
      `Handwerk des Tages · ${p.name}`,
      tip
    );
  },
];

// ------------------------------------------------------------------ Ausfuehrung

/**
 * Wertet alle Regeln aus.
 * @param {{limit?: number}} options
 * @returns {Array} Hinweise, die wichtigsten zuerst.
 */
export function insights({ limit = 0 } = {}) {
  const context = {
    posts: store.all('posts'),
    ideas: store.all('ideas'),
    analytics: store.all('analytics'),
    media: store.all('media'),
    settings: store.settings(),
  };

  const found = [];
  for (const rule of RULES) {
    try {
      const result = rule(context);
      if (!result) continue;
      for (const item of Array.isArray(result) ? result : [result]) found.push(item);
    } catch (error) {
      console.error(`Coach-Regel "${rule.name}" fehlgeschlagen:`, error);
    }
  }

  const dismissed = new Set(context.settings.dismissedInsights || []);
  const ranked = found
    .filter((item) => !dismissed.has(item.id))
    .sort((a, b) => b.weight - a.weight);

  return limit ? ranked.slice(0, limit) : ranked;
}

/** Eine Kennzahl dafuer, wie rund der Betrieb gerade laeuft (0–100). */
export function healthScore() {
  const posts = store.all('posts');
  const settings = store.settings();
  let score = 100;

  const missed = posts.filter((post) => post.status === 'missed').length;
  score -= Math.min(25, missed * 8);

  const upcoming = posts.filter((post) => post.status === 'scheduled' && new Date(post.scheduledAt) > new Date()).length;
  if (!upcoming) score -= 20;
  else if (upcoming < 3) score -= 8;

  const openIdeas = store.all('ideas').filter((idea) => !['done', 'archived'].includes(idea.status)).length;
  if (openIdeas < 3) score -= 15;
  else if (openIdeas < 8) score -= 6;

  const published = posts.filter((post) => post.status === 'published' && post.publishedAt);
  if (published.length) {
    const newest = Math.max(...published.map((post) => new Date(post.publishedAt).getTime()));
    const days = (Date.now() - newest) / 86400000;
    const expected = 7 / Math.max(1, settings.weeklyGoal?.posts || 3);
    if (days > expected * 3) score -= 20;
    else if (days > expected * 2) score -= 10;
  } else {
    score -= 10;
  }

  if (!store.all('analytics').length) score -= 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}
