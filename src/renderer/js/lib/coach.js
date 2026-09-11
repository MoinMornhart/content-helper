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
 *
 * Alle Texte laufen ueber t(): Die Regeln werden erst beim Anzeigen
 * ausgewertet, dann steht die Sprache fest.
 */

import * as store from './store.js';
import * as fmt from './format.js';
import * as an from './analytics.js';
import { platform, platformName, metric, PLATFORMS } from './platforms.js';
import { t, mark } from './i18n.js';

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
      t('Nichts steht im Kalender'),
      t('Es ist kein Beitrag mehr eingeplant. Regelmässigkeit ist der stärkste Hebel überhaupt – wer nach einer Pause zurückkommt, startet bei fast jedem Kanal wieder von vorn.'),
      { label: t('Beitrag einplanen'), view: 'composer' }
    );
  },

  function missedPosts({ posts }) {
    const missed = posts.filter((post) => post.status === 'missed');
    if (!missed.length) return null;
    return insight(
      'missed', 'danger', '!',
      fmt.plural(missed.length, mark('verpasster Termin'), mark('verpasste Termine')),
      t('Diese Beiträge sind an ihrem Termin nicht rausgegangen. Entweder neu einplanen oder bewusst verwerfen – liegen bleiben ist die schlechteste Variante.'),
      { label: t('Zur Warteschlange'), view: 'queue' }
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
      t('Seit {days} nichts veröffentlicht', { days: fmt.plural(daysSince, mark('Tag'), mark('Tagen')) }),
      t('Dein Ziel sind {goal} Beiträge pro Woche, das wären rund alle {gap} Tage einer. Eine kleinere, aber gehaltene Frequenz schlägt jeden Schub gefolgt von Funkstille.', { goal, gap: expectedGap }),
      { label: t('Ideen sichten'), view: 'ideas' },
      t('Letzte Veröffentlichung: {date}', { date: fmt.date(published[0].publishedAt) })
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
        t('Wochenziel ist gedeckt'),
        t('{done} veröffentlicht, {planned} eingeplant – zusammen erreichst du dein Ziel von {goal}. Gute Grundlage, um an der Qualität statt an der Menge zu arbeiten.', { done, planned, goal })
      );
    }
    return insight(
      'weekly-goal', 'info', '◎',
      t('Noch {left} bis zum Wochenziel', { left: goal - done - planned }),
      t('Diese Woche: {done} veröffentlicht, {planned} eingeplant, Ziel {goal}. Die Lücke schliesst sich am schnellsten, indem du eine bestehende Idee auf einen freien Termin ziehst.', { done, planned, goal }),
      { label: t('Warteschlange füllen'), view: 'queue' }
    );
  },

  function ideaPipeline({ ideas }) {
    const open = ideas.filter((idea) => !['done', 'archived'].includes(idea.status));
    if (open.length >= 8) return null;
    return insight(
      'idea-pipeline', open.length < 3 ? 'warn' : 'info', '✦',
      open.length < 3 ? t('Der Ideenvorrat ist fast leer') : t('Der Ideenvorrat wird dünn'),
      t('Nur {ideas} liegen bereit. Ein Vorrat von zehn bis fünfzehn nimmt den Druck aus der Produktion – ohne ihn entsteht der Inhalt am Ende immer unter Zeitnot.', { ideas: fmt.plural(open.length, mark('offene Idee'), mark('offene Ideen')) }),
      { label: t('Ideen erzeugen'), view: 'ideas' }
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
      t('{platform} liegt brach', { platform: platformName(worst.id) }),
      worst.last
        ? t('Dort ging zuletzt {when} etwas raus, obwohl der Kanal aktiv ist. Entweder wieder bespielen – oder in den Einstellungen abschalten, damit die Übersicht ehrlich bleibt.', { when: fmt.relative(worst.last) })
        : t('Für diesen Kanal ist noch nie etwas geplant worden. Entweder starten oder in den Einstellungen abwählen.'),
      { label: t('Kanäle prüfen'), view: 'channels' }
    );
  },

  function crossPosting({ posts }) {
    const recent = posts.filter((post) => ['published', 'scheduled', 'due'].includes(post.status)).slice(0, 25);
    if (recent.length < 5) return null;
    const singles = recent.filter((post) => (post.platforms || []).length === 1);
    if (singles.length / recent.length < 0.7) return null;
    return insight(
      'cross-posting', 'info', '⇄',
      t('Fast alles läuft nur auf einem Kanal'),
      t('{singles} von {total} Beiträgen gehen an genau eine Plattform. Ein Langvideo trägt mühelos einen Kurzclip, einen Textbeitrag und einen Blogeintrag – dieselbe Arbeit, mehrfache Reichweite.', { singles: singles.length, total: recent.length }),
      { label: t('Beitrag mehrfach ausspielen'), view: 'composer' }
    );
  },

  // --- Zahlenpflege ------------------------------------------------------
  function staleAnalytics({ analytics, posts }) {
    const publishedCount = posts.filter((post) => post.status === 'published').length;
    if (publishedCount < 3) return null;
    if (!analytics.length) {
      return insight(
        'no-analytics', 'warn', '◫',
        t('Es sind noch keine Zahlen erfasst'),
        t('Ohne Messwerte bleibt jede Verbesserung Bauchgefühl. Der schnellste Weg: den CSV-Export aus dem jeweiligen Studio einlesen – das dauert zwei Minuten und schaltet die halbe Auswertung frei.'),
        { label: t('Zahlen erfassen'), view: 'analytics' }
      );
    }
    const newest = analytics.map((entry) => entry.date).sort().at(-1);
    const daysSince = Math.floor((Date.now() - new Date(newest).getTime()) / 86400000);
    if (daysSince < 14) return null;
    return insight(
      'stale-analytics', 'info', '◫',
      t('Die Zahlen sind {days} Tage alt', { days: daysSince }),
      t('Neuere Werte machen die Empfehlungen deutlich schärfer – vor allem beim besten Zeitfenster und beim stärksten Format.'),
      { label: t('Zahlen nachtragen'), view: 'analytics' }
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
      t('Deine beste Uhrzeit ist {time}', { time: `${String(best.hour).padStart(2, '0')}:00` }),
      t('Beiträge zu dieser Stunde erreichen im Schnitt {lift} Prozent mehr Aufrufe als der Rest. Lege die wichtigsten Veröffentlichungen bewusst dorthin.', { lift }),
      { label: t('Zeitfenster übernehmen'), view: 'queue' },
      t('Grundlage: {count} Beiträge um {hour} Uhr, {views} Aufrufe im Schnitt', { count: best.count, hour: best.hour, views: fmt.num(best.value, { compact: true }) })
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
      t('{day} trägt am weitesten', { day: fmt.weekdayName(best.day) }),
      t('Im Schnitt {best} Aufrufe gegenüber {worst} am {day}. Die stärksten Inhalte gehören auf den starken Tag, Experimente auf den schwachen.', {
        best: fmt.num(best.value, { compact: true }),
        worst: fmt.num(worst.value, { compact: true }),
        day: fmt.weekdayName(worst.day),
      })
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
      t('Das Format „{format}“ funktioniert am besten', { format: best.format }),
      t('{best} Aufrufe im Schnitt aus {posts} – gegenüber {worst} bei „{other}“. Mehr davon zu machen ist die günstigste Verbesserung, die es gibt.', {
        best: fmt.num(best.value, { compact: true }),
        posts: fmt.plural(best.count, mark('Beitrag'), mark('Beiträgen')),
        worst: fmt.num(worst.value, { compact: true }),
        other: worst.format,
      }),
      { label: t('Idee in diesem Format'), view: 'ideas' }
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
        t('Schwache Klickrate auf {platform}', { platform: p.name }),
        t('Im Schnitt {value} gegenüber einem üblichen Wert um {benchmark} Prozent. Das ist fast immer die Verpackung, nicht der Inhalt: Thumbnail mit einem klaren Motiv, Titel mit einem Versprechen, beides in unter zwei Sekunden erfassbar.', { value: fmt.percent(value), benchmark }),
        { label: t('Titel-Varianten erzeugen'), view: 'ideas' },
        t('Grundlage: {count} Beiträge der letzten 90 Tage', { count: list.length })
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
        t('Zu wenige sehen {platform}-Clips zu Ende', { platform: p.name }),
        t('Abschlussrate im Schnitt {value}, üblich sind rund {benchmark} Prozent. Die Ursache liegt fast immer in den ersten {seconds} Sekunden: Einleitung streichen, sofort mit der Aussage beginnen, Spannung erst am Ende auflösen.', { value: fmt.percent(value), benchmark, seconds: p.hookWindowSec || 3 }),
        { label: t('Hooks überarbeiten'), view: 'scripts' },
        t('Grundlage: {count} Beiträge der letzten 90 Tage', { count: list.length })
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
        t('{platform} verliert an Reichweite', { platform: platformName(id) }),
        t('{current} gegenüber {previous} Aufrufen im Vormonat, ein Rückgang um {change} Prozent. Prüfe zuerst, ob sich Frequenz oder Format verändert haben – meist steckt dort die Ursache, nicht im Algorithmus.', {
          current: fmt.num(current, { compact: true }),
          previous: fmt.num(previous, { compact: true }),
          change: Math.abs(Math.round(change * 100)),
        }),
        { label: t('Verlauf ansehen'), view: 'analytics' }
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
        t('{platform} zieht deutlich an', { platform: platformName(id) }),
        t('{current} statt {previous} Aufrufen, ein Plus von {change} Prozent. Jetzt ist der Moment, dort mehr zu investieren statt die Kraft breit zu verteilen.', {
          current: fmt.num(current, { compact: true }),
          previous: fmt.num(previous, { compact: true }),
          change: Math.round(change * 100),
        })
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
      t('Ein alter Erfolg lohnt eine Neuauflage'),
      t('„{title}“ vom {date} liegt mit {views} Aufrufen weit vorn. Nach drei Monaten kennt der grösste Teil des Publikums ihn nicht – als Kurzfassung, Aktualisierung oder Gegenthese trägt das Thema erneut.', {
        title: candidate.entry.title || t('Ein Beitrag'),
        date: fmt.date(candidate.entry.date),
        views: fmt.num(candidate.value, { compact: true }),
      }),
      { label: t('Neuauflage planen'), view: 'composer' }
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
      t('{posts} mit offener Checkliste', { posts: fmt.plural(soon.length, mark('Beitrag'), mark('Beiträge')) }),
      t('Der Termin ist in weniger als zwei Tagen, aber Thumbnail, Untertitel oder Beschreibung fehlen noch. Genau diese Restarbeiten kosten am Veröffentlichungstag die meiste Nerven.'),
      { label: t('Warteschlange öffnen'), view: 'queue' }
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
      t('Deine Streamzeiten sind schwer vorhersehbar'),
      t('Die letzten {streams} Streams verteilen sich auf {days} verschiedene Wochentage. Auf Twitch entsteht Publikum durch Verlässlichkeit: zwei bis drei feste Termine bringen dauerhaft mehr Zuschauer im Schnitt als häufigeres, aber unregelmässiges Streamen.', { streams: streams.length, days: weekdays.size }),
      { label: t('Feste Zeitfenster anlegen'), view: 'queue' }
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
    const params = {
      long: fmt.plural(longform.length, mark('langes Format'), mark('lange Formate')),
      short: fmt.plural(shorts.length, mark('Kurzclip'), mark('Kurzclips')),
    };
    return insight(
      'shorts-from-long', 'info', '✂',
      t('Aus langen Inhalten entstehen zu wenige Clips'),
      longform.length === 1
        ? t('{long} steht {short} gegenüber. Zwei bis drei Ausschnitte pro Langvideo oder Stream sind Reichweite ohne zusätzlichen Dreh – und der beste Weg, neue Zuschauer zum Hauptkanal zu führen.', params)
        : t('{long} stehen {short} gegenüber. Zwei bis drei Ausschnitte pro Langvideo oder Stream sind Reichweite ohne zusätzlichen Dreh – und der beste Weg, neue Zuschauer zum Hauptkanal zu führen.', params),
      { label: t('Clips einplanen'), view: 'composer' }
    );
  },

  function platformTip({ settings }) {
    const ids = settings.activePlatforms?.length ? settings.activePlatforms : PLATFORMS.map((p) => p.id);
    const pool = ids.map((id) => platform(id)).filter((p) => p?.tips?.length);
    if (!pool.length) return null;
    // Ein Tipp pro Tag, aber stabil innerhalb des Tages.
    const seed = Number(fmt.dayKey().replaceAll('-', ''));
    const p = pool[seed % pool.length];
    // Die Tipps kommen aus dem Katalog und sind dort schon übersetzt (Getter).
    const tip = p.tips[seed % p.tips.length];
    return insight(
      'daily-tip', 'info', '◆',
      t('Handwerk des Tages · {platform}', { platform: p.name }),
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
