// Cloudflare Worker: liefert die App aus (statische Dateien) und die API unter /api/*
import { fetchBestLeaflet, fetchRawOffers, leafletPage } from './marktguru';
import { normalizeAll } from './normalize';
import { generateRecipes } from './recipes';
import { ALDI_NORD, fetchAldiNord } from './aldi';
import {
  extractProspekt,
  fetchMarketOffers,
  catalogPath,
  findProspekte,
  marketChainInfo,
  parseMarkets,
  probeProspekte,
  prospektPage,
  withCurrentImages,
  proxyImage,
  searchMarkets,
  type EdekaMarket,
  type Prospekt,
} from './edeka';
import { addCost, costUsd, monthCost, type Tracker } from './costs';
import { geocode, km, nearestStores } from './stores';
import { sendPush, vapidKeys, type PushSub } from './push';
import { matchWatch } from '../shared/watch';
import { computeDealsFrom, snapshot, isoWeek, type WeekSnapshot } from './deals';
import type { ChainInfo, Leaflet, LeafletsResponse, Offer, OffersResponse, RecipeRequest } from '../shared/types';

export interface Env {
  ASSETS: Fetcher;
  CACHE?: KVNamespace;
  ANTHROPIC_API_KEY?: string;
  MODEL?: string;
  EXTRACT_MODEL?: string;
  FAST_MODEL?: string;
  DAILY_RECIPE_LIMIT?: string;
  MONTHLY_BUDGET_USD?: string;
}

const tracker = (env: Env): Tracker => (model, usage) => addCost(env.CACHE, costUsd(model, usage));
const budget = (env: Env) => Number(env.MONTHLY_BUDGET_USD ?? 8);
async function overBudget(env: Env): Promise<boolean> {
  return (await monthCost(env.CACHE)) >= budget(env);
}

const HOUR = 3600_000;

// ---------- kleine Cache-Helfer (Speicher + optional KV) ----------

const memo = new Map<string, { at: number; data: unknown }>();

async function cached<T>(env: Env, key: string, ttlMs: number, load: () => Promise<T>, force = false): Promise<T> {
  const hit = memo.get(key);
  if (!force && hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  if (!force && env.CACHE) {
    const kv = await env.CACHE.get<{ at: number; data: T }>(key, 'json');
    if (kv && Date.now() - kv.at < ttlMs) {
      memo.set(key, kv);
      return kv.data;
    }
  }
  const data = await load();
  const entry = { at: Date.now(), data };
  memo.set(key, entry);
  if (env.CACHE) await env.CACHE.put(key, JSON.stringify(entry), { expirationTtl: Math.max(60, Math.ceil(ttlMs / 1000) * 2) });
  return data;
}

async function kvGet<T>(env: Env, key: string): Promise<T | null> {
  return env.CACHE ? env.CACHE.get<T>(key, 'json') : null;
}
async function kvPut(env: Env, key: string, value: unknown, ttlSec?: number) {
  if (env.CACHE) await env.CACHE.put(key, JSON.stringify(value), ttlSec ? { expirationTtl: Math.max(60, ttlSec) } : undefined);
}

// ---------- Angebote zusammenführen ----------

interface ProspektMeta {
  extractedAt?: string;
  seconds?: number;
  costUsd?: number;
}
interface ProspektIndex {
  prospekte: (Pick<Prospekt, 'key' | 'validFrom' | 'validTo' | 'preview'> & { count: number } & ProspektMeta)[];
}

async function edekaOffers(env: Env, m: EdekaMarket): Promise<{ offers: Offer[]; note?: string }> {
  const now = Date.now();
  const idx = await kvGet<ProspektIndex>(env, `edeka:idx:${m.marketNo}`);
  const valid = (idx?.prospekte ?? []).filter((p) => Date.parse(p.validTo) >= now);
  if (valid.length) {
    const lists = await Promise.all(
      valid.map(async (p) => {
        const l = (await kvGet<Offer[]>(env, pdfKey(p.key))) ?? (await kvGet<Offer[]>(env, `edeka:pdf:${p.key}`));
        return l ? withCurrentImages(l, p, m.marketNo) : null;
      }),
    );
    const offers = lists.flatMap((l) => l ?? []);
    if (offers.length) return { offers };
  }
  const national = await cached(env, `edeka:nat:${m.id}`, 6 * HOUR, () => fetchMarketOffers(m));
  return {
    offers: national,
    note: env.CACHE ? 'Prospekt wird eingelesen – bis dahin nur die bundesweiten Angebote' : undefined,
  };
}

// Märkte, deren Prospekt eingelesen wird. Nur Märkte, die jemand in der App ausgewählt hat;
// wer 14 Tage nicht mehr abgefragt wurde, fliegt wieder raus.
type Watched = EdekaMarket & { lastSeen: number };
const WATCH_DAYS = 14;

async function watchMarket(env: Env, m: EdekaMarket) {
  const list = (await kvGet<Watched[]>(env, 'edeka:watch')) ?? [];
  const hit = list.find((x) => x.id === m.id);
  if (hit && Date.now() - (hit.lastSeen ?? 0) < 86400_000) return; // höchstens einmal am Tag schreiben
  const next = [...list.filter((x) => x.id !== m.id), { ...m, lastSeen: Date.now() }];
  await kvPut(env, 'edeka:watch', next);
}

const centerOf = (env: Env, plz: string) => cached(env, `geo:${plz}`, 90 * 24 * HOUR, () => geocode(plz));

/** Nur Märkte im Umkreis von 15 km, nächste zuerst */
async function nearestFirst(env: Env, plz: string, found: EdekaMarket[]): Promise<EdekaMarket[]> {
  const c = await centerOf(env, plz).catch(() => null);
  if (!c) return found.slice(0, 6);
  return found
    .map((m) => ({ ...m, distanceKm: m.lat && m.lon ? Math.round(km(c.lat, c.lon, m.lat, m.lon) * 10) / 10 : undefined }))
    .filter((m) => m.distanceKm == null || m.distanceKm <= 15)
    .sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99));
}

/** Märkte merken, damit sie später über die ID gefunden werden – und als letzte gute Liste für die PLZ */
async function rememberMarkets(env: Env, plz: string, list: EdekaMarket[]) {
  if (!list.length) return;
  await Promise.all([
    ...list.map((m) => kvPut(env, `edeka:m:${m.id}`, m, 90 * 86400)),
    kvPut(env, `edeka:nearlast:${plz}`, list),
  ]);
  for (const m of list) memo.set(`edeka:m:${m.id}`, { at: Date.now(), data: m });
}

async function nearbyMarkets(env: Env, plz: string): Promise<EdekaMarket[]> {
  try {
    const list = await cached(env, `edeka:near2:${plz}`, 24 * HOUR, async () => {
      const found = await nearestFirst(env, plz, await searchMarkets(plz));
      // Leere Antwort nicht für 24 Stunden festschreiben
      if (!found.length) throw new Error('EDEKA-Marktsuche lieferte keine Märkte');
      return found;
    });
    await rememberMarkets(env, plz, list);
    return list;
  } catch (e) {
    // EDEKA blockt oder ist down: letzte funktionierende Liste nehmen
    const last = await kvGet<EdekaMarket[]>(env, `edeka:nearlast:${plz}`);
    if (last?.length) return last;
    throw e;
  }
}

async function marketById(env: Env, id: number): Promise<EdekaMarket | null> {
  const hit = memo.get(`edeka:m:${id}`);
  if (hit) return hit.data as EdekaMarket;
  return kvGet<EdekaMarket>(env, `edeka:m:${id}`);
}

export async function getOffers(env: Env, plz: string, marketIds: number[] = [], force = false): Promise<OffersResponse> {
  const notes: string[] = [];
  const errors: string[] = [];
  const settle = async <T,>(label: string, p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (e) {
      console.error(label, e);
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return fallback;
    }
  };

  const [mg, aldi, nearby] = await Promise.all([
    settle('marktguru', cached(env, `mg:${plz}`, 6 * HOUR, async () => normalizeAll(await fetchRawOffers(plz)), force), {
      offers: [] as Offer[],
      chains: [] as ChainInfo[],
    }),
    settle('ALDI Nord', cached(env, 'aldi:nord', 6 * HOUR, fetchAldiNord, force), [] as Offer[]),
    settle('EDEKA-Marktsuche', nearbyMarkets(env, plz), [] as EdekaMarket[]),
  ]);

  const markets = (await Promise.all(marketIds.map((id) => marketById(env, id)))).filter((m): m is EdekaMarket => !!m);
  const edeka = await Promise.all(
    markets.map(async (m) => {
      await watchMarket(env, m);
      const r = await settle(m.name, edekaOffers(env, m), { offers: [] as Offer[] });
      return { m, ...r };
    }),
  );

  const offers = [...mg.offers, ...aldi, ...edeka.flatMap((e) => e.offers)];
  const chains: ChainInfo[] = [
    ...mg.chains.map((c) => ({ ...c, kind: 'kette' as const })),
    ...(aldi.length ? [{ name: ALDI_NORD, count: aldi.length, kind: 'kette' as const }] : []),
    ...edeka.map((e) => marketChainInfo(e.m, e.offers.length, e.note)),
  ];
  for (const e of edeka) if (e.note) notes.push(`${e.m.name}: ${e.note}`);
  return {
    plz,
    fetchedAt: new Date().toISOString(),
    chains,
    // Gewählte Märkte immer mit anbieten, auch wenn die Suche sie gerade nicht liefert
    nearby: [...nearby, ...markets.filter((m) => !nearby.some((n) => n.id === m.id))].map((m) => marketChainInfo(m)),
    offers,
    notes,
    errors,
  };
}

// ---------- Benachrichtigungen (Merkliste) ----------

const shortName = (c: string) => c.replace('Netto Marken-Discount', 'Netto').replace('PENNY', 'Penny').replace(/^nah\s*(&|und)\s*gut.*/i, 'nah & gut');

async function pushMessage(env: Env, sub: PushSub): Promise<{ title: string; body: string }> {
  const data = await getOffers(env, sub.plz, sub.markets);
  const now = Date.now();
  const offers = data.offers.filter(
    (o) => (!sub.chains.length || sub.chains.includes(o.chain)) && Date.parse(o.validFrom) <= now + 12 * HOUR && Date.parse(o.validTo) >= now,
  );
  if (!sub.watch.length) return { title: 'Neue Angebote der Woche', body: 'Die Prospekte der Woche sind da – schau mal rein.' };
  const hits = sub.watch
    .map((t) => ({ t, chains: [...new Set(matchWatch(t, offers).map((o) => shortName(o.chain)))] }))
    .filter((h) => h.chains.length);
  if (!hits.length) return { title: 'Merkliste', body: 'Von deiner Merkliste ist diese Woche nichts im Angebot.' };
  return {
    title: `Merkliste: ${hits.length} von ${sub.watch.length} im Angebot`,
    body: hits.map((h) => `${h.t}: ${h.chains.join(', ')}`).join(' · '),
  };
}

const subsOf = async (env: Env) => (await kvGet<PushSub[]>(env, 'push:subs')) ?? [];

async function weeklyPush(env: Env): Promise<string> {
  if (!env.CACHE) return 'kein KV';
  // Montags ab 7 Uhr (deutsche Zeit), einmal pro Woche
  const berlin = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  if (berlin.getDay() !== 1 || berlin.getHours() < 7) return 'nicht Montagmorgen';
  const key = `push:sent:${isoWeek(berlin)}`;
  if (await env.CACHE.get(key)) return 'diese Woche schon gesendet';
  await env.CACHE.put(key, new Date().toISOString(), { expirationTtl: 14 * 86400 });
  const subs = await subsOf(env);
  const keep: PushSub[] = [];
  for (const sub of subs) {
    const status = await sendPush(env.CACHE, sub.endpoint).catch(() => 0);
    if (status !== 404 && status !== 410) keep.push(sub);
  }
  if (keep.length !== subs.length) await kvPut(env, 'push:subs', keep);
  return `an ${subs.length} Gerät(e) gesendet`;
}

// ---------- Kaufempfehlungen ----------

/** Einmal pro Woche einen Schnappschuss der Preise ablegen (Grundlage für "selten" / "günstiger als sonst") */
async function ensureSnapshot(env: Env, plz: string, offers: Offer[]) {
  const key = `hist:${plz}:${isoWeek(new Date())}`;
  if (memo.has(key) || !env.CACHE || !offers.length) return;
  if (!(await env.CACHE.get(key))) await kvPut(env, key, snapshot(offers), 200 * 86400);
  memo.set(key, { at: Date.now(), data: true });
}

async function computeDeals(env: Env, scope: string, offers: Offer[]) {
  const now = new Date();
  await ensureSnapshot(env, scope, offers);
  const weeks: WeekSnapshot[] = [];
  for (let i = 1; i <= 12; i++) {
    const w = isoWeek(new Date(now.getTime() - i * 7 * 86400_000));
    const snap = await kvGet<WeekSnapshot>(env, `hist:${scope}:${w}`);
    if (snap) weeks.push(snap);
  }
  return computeDealsFrom(offers, weeks);
}

// ---------- Prospekte zum Blättern ----------

async function getLeaflets(env: Env, plz: string, marketIds: number[]): Promise<LeafletsResponse> {
  const errors: string[] = [];
  const data = await getOffers(env, plz, marketIds);
  const leaflets: Leaflet[] = [];

  // marktguru: die Prospekt-Ausgaben, aus denen die Angebote stammen
  const flights = new Map<number, number>();
  for (const o of data.offers) if (o.flight) flights.set(o.flight, (flights.get(o.flight) ?? 0) + 1);
  const relevant = [...flights.entries()].filter(([, n]) => n >= 5).map(([f]) => f);
  const mg = await Promise.all(
    relevant.map((f) => cached(env, `mg:leaflet:${f}:${plz}`, 6 * HOUR, () => fetchBestLeaflet(f, plz)).catch(() => null)),
  );
  const seen = new Set<number>();
  for (const l of mg) {
    if (!l || !l.pageImages?.count || seen.has(l.id) || Date.parse(l.validTo) < Date.now()) continue;
    seen.add(l.id);
    const n = l.pageImages.count;
    leaflets.push({
      id: `mg-${l.id}`,
      chain: l.advertiser?.name ?? '',
      validFrom: l.validFrom,
      validTo: l.validTo,
      pages: Array.from({ length: n }, (_, i) => leafletPage(l.id, i, 'medium')),
      pagesLarge: Array.from({ length: n }, (_, i) => leafletPage(l.id, i, 'large')),
    });
  }

  // EDEKA-Märkte: Blätterkatalog
  for (const id of marketIds) {
    const m = await marketById(env, id);
    if (!m) continue;
    try {
      const ps = await cached(env, `edeka:prosp2:${m.marketNo}`, HOUR, () => prospekteOf(env, m));
      for (const p of ps) {
        if (!p.pageCount || Date.parse(p.validTo) < Date.now()) continue;
        leaflets.push({
          id: `ed-${p.key}`,
          chain: m.name,
          validFrom: p.validFrom,
          validTo: p.validTo,
          pages: Array.from({ length: p.pageCount }, (_, i) => prospektPage(p, i + 1, 'normal')),
          pagesLarge: Array.from({ length: p.pageCount }, (_, i) => prospektPage(p, i + 1, 'large')),
        });
      }
    } catch (e) {
      errors.push(`${m.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  leaflets.sort((a, b) => a.chain.localeCompare(b.chain) || Date.parse(a.validFrom) - Date.parse(b.validFrom));
  return { leaflets, errors };
}

// ---------- Prospekte einlesen (Cron + manuell) ----------

// Versionskennung des Einlese-Formats. Wird sie erhöht, liest der Cron alle aktuellen Prospekte neu ein
// (v2: mit Bildausschnitten). Bis dahin bleiben die alten Daten sichtbar.
const EXTRACT_VERSION = 'v2';
const pdfKey = (k: string) => `edeka:pdf:${EXTRACT_VERSION}:${k}`;
const errKey = (k: string) => `edeka:err:${EXTRACT_VERSION}:${k}`;
const metaKey = (k: string) => `edeka:meta:${EXTRACT_VERSION}:${k}`;

/**
 * Prospekte eines Markts finden. Normal über edeka.de; blockt edeka.de die Cloud (403),
 * direkt über die bekannte Blätterkatalog-Adresse des Markts.
 */
async function prospekteOf(env: Env, m: EdekaMarket): Promise<Prospekt[]> {
  try {
    const ps = await findProspekte(m);
    if (ps.length) await kvPut(env, `edeka:kat:${m.marketNo}`, [...new Set(ps.map((p) => catalogPath(p.key)))]);
    return ps;
  } catch (e) {
    const known =
      (await kvGet<string[]>(env, `edeka:kat:${m.marketNo}`)) ??
      ((await kvGet<ProspektIndex>(env, `edeka:idx:${m.marketNo}`))?.prospekte ?? []).map((p) => catalogPath(p.key));
    if (!known.length) throw e;
    return probeProspekte([...new Set(known)]);
  }
}

async function processMarket(env: Env, m: EdekaMarket, maxExtract = 1): Promise<string[]> {
  const log: string[] = [];
  if (!env.ANTHROPIC_API_KEY || !env.CACHE) return ['API-Key oder KV fehlt'];
  const prospekte = await prospekteOf(env, m);
  log.push(`${m.name}: ${prospekte.length} Prospekt(e) gefunden`);
  // Nichts gefunden (z. B. Quelle gestört): bisherigen Stand behalten statt leeren
  if (!prospekte.length) return log;
  const idx: ProspektIndex = { prospekte: [] };
  let extracted = 0;
  for (const p of prospekte) {
    const key = pdfKey(p.key);
    let offers = await kvGet<Offer[]>(env, key);
    if (!offers && extracted < maxExtract) {
      const err = await kvGet<{ at: number; tries?: number }>(env, errKey(p.key));
      if (err && (err.tries ?? 1) >= 2) {
        log.push(`${p.key}: zweimal fehlgeschlagen – kein weiterer automatischer Versuch`);
      } else if (err && Date.now() - err.at < 3 * HOUR) {
        log.push(`${p.key}: letzter Versuch fehlgeschlagen, warte`);
      } else {
        extracted++;
        // Harte Obergrenze: höchstens 4 KI-Einlesungen pro Woche, egal was passiert
        const capKey = `extract:count:${isoWeek(new Date())}`;
        const done = Number((await env.CACHE.get(capKey)) ?? 0);
        if (done >= 4) {
          log.push(`${p.key}: Wochenlimit für das Einlesen erreicht (${done})`);
          break;
        }
        await env.CACHE.put(capKey, String(done + 1), { expirationTtl: 14 * 86400 });
        try {
          const t0 = Date.now();
          if (await overBudget(env)) {
            log.push('Monatsbudget erreicht – Prospekt wird nicht eingelesen');
            break;
          }
          let cost = 0;
          const track: Tracker = async (model, usage) => {
            cost += costUsd(model, usage);
            await tracker(env)(model, usage);
          };
          offers = await extractProspekt(m, p, env.ANTHROPIC_API_KEY, env.EXTRACT_MODEL || env.MODEL || 'claude-sonnet-5-5', track);
          const ttl = Math.ceil((Date.parse(p.validTo) - Date.now()) / 1000) + 86400;
          await kvPut(env, key, offers, ttl);
          await kvPut(env, metaKey(p.key), { extractedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), costUsd: Math.round(cost * 100) / 100 }, ttl);
          log.push(`${p.key}: ${offers.length} Angebote eingelesen (${Math.round((Date.now() - t0) / 1000)} s)`);
        } catch (e) {
          await kvPut(env, errKey(p.key), { at: Date.now(), tries: (err?.tries ?? 0) + 1, msg: String(e) }, 8 * 86400);
          log.push(`${p.key}: Fehler ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    // Solange die neue Fassung fehlt, die alte weiter anzeigen
    if (!offers) offers = await kvGet<Offer[]>(env, `edeka:pdf:${p.key}`);
    if (offers) {
      const meta = (await kvGet<ProspektMeta>(env, metaKey(p.key))) ?? (await kvGet<ProspektMeta>(env, `edeka:meta:${p.key}`));
      idx.prospekte.push({ key: p.key, validFrom: p.validFrom, validTo: p.validTo, preview: p.preview, count: offers.length, ...meta });
    }
  }
  await kvPut(env, `edeka:idx:${m.marketNo}`, idx, 14 * 86400);
  return log;
}

async function runCron(env: Env): Promise<string[]> {
  const all = (await kvGet<Watched[]>(env, 'edeka:watch')) ?? [];
  const list = all.filter((m) => Date.now() - (m.lastSeen ?? Date.now()) < WATCH_DAYS * 86400_000);
  if (list.length !== all.length) await kvPut(env, 'edeka:watch', list);
  const log: string[] = [];
  await kvPut(env, 'cron:last', { at: new Date().toISOString(), markets: list.length });
  log.push(`Push: ${await weeklyPush(env).catch((e) => String(e))}`);
  for (const m of list) {
    try {
      log.push(...(await processMarket(env, m)));
    } catch (e) {
      log.push(`${m.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return log;
}

// ---------- Tageslimit für Rezepte ----------

async function checkLimit(env: Env, name: string, max: number): Promise<boolean> {
  if (!env.CACHE) return true;
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${name}:${day}`;
  const n = Number((await env.CACHE.get(key)) ?? 0);
  if (n >= max) return false;
  await env.CACHE.put(key, String(n + 1), { expirationTtl: 2 * 86400 });
  return true;
}

// ---------- HTTP ----------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
const error = (message: string, status = 500) => json({ error: message }, status);
const validPlz = (p: string | null | undefined): p is string => !!p && /^\d{5}$/.test(p);
const parseIds = (s: string | null) => [...new Set((s ?? '').split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0))].slice(0, 6);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      if (url.pathname === '/api/push/key' && env.CACHE) {
        return json({ publicKey: (await vapidKeys(env.CACHE)).publicKey });
      }
      if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
        const b = (await request.json()) as Partial<PushSub>;
        if (!b.endpoint || !validPlz(b.plz)) return error('Abo unvollständig', 400);
        const sub: PushSub = {
          endpoint: b.endpoint,
          plz: b.plz,
          markets: (b.markets ?? []).slice(0, 6),
          chains: (b.chains ?? []).slice(0, 12),
          watch: (b.watch ?? []).map((w) => String(w).slice(0, 40)).slice(0, 30),
          updatedAt: new Date().toISOString(),
        };
        const subs = (await subsOf(env)).filter((x) => x.endpoint !== sub.endpoint);
        await kvPut(env, 'push:subs', [...subs, sub].slice(-10));
        return json({ ok: true });
      }
      if (url.pathname === '/api/push/unsubscribe' && request.method === 'POST') {
        const b = (await request.json()) as { endpoint?: string };
        await kvPut(env, 'push:subs', (await subsOf(env)).filter((x) => x.endpoint !== b.endpoint));
        return json({ ok: true });
      }
      if (url.pathname === '/api/push/latest') {
        const subs = await subsOf(env);
        const sub = subs.find((x) => x.endpoint === url.searchParams.get('endpoint')) ?? subs[subs.length - 1];
        return json(sub ? await pushMessage(env, sub) : { title: 'Angebotsküche', body: 'Neue Angebote der Woche sind da.' });
      }
      if (url.pathname === '/api/push/test' && request.method === 'POST' && env.CACHE) {
        const b = (await request.json()) as { endpoint?: string };
        if (!b.endpoint || !(await subsOf(env)).some((x) => x.endpoint === b.endpoint)) return error('Gerät nicht angemeldet', 404);
        if (!(await checkLimit(env, 'pushtest', 10))) return error('Heute genug getestet', 429);
        return json({ status: await sendPush(env.CACHE, b.endpoint) });
      }

      // Löscht Cookies und Speicher dieser Website im Browser (andere Websites bleiben unberührt)
      if (url.pathname === '/api/clear') {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'clear-site-data': '"cookies", "storage"' },
        });
      }

      // Nach der Cloudflare-Anmeldung zurück in die App
      if (url.pathname === '/api/login') return Response.redirect(new URL('/', url).toString(), 302);

      if (url.pathname === '/api/img') {
        const u = url.searchParams.get('u');
        return u ? proxyImage(u) : error('Bild fehlt', 400);
      }

      // Welche Prospekte liegen eingelesen vor, und wann hat die KI sie gelesen?
      if (url.pathname === '/api/status') {
        const ids = parseIds(url.searchParams.get('markets'));
        const markets = (await Promise.all(ids.map((id) => marketById(env, id)))).filter((m): m is EdekaMarket => !!m);
        const prospekte = await Promise.all(
          markets.map(async (m) => {
            const idx = await kvGet<ProspektIndex>(env, `edeka:idx:${m.marketNo}`);
            const watch = (await kvGet<Watched[]>(env, 'edeka:watch'))?.find((w) => w.id === m.id);
            return {
              market: m.name,
              watched: !!watch,
              prospekte: (idx?.prospekte ?? []).map(({ key, ...rest }) => rest),
            };
          }),
        );
        const cron = await kvGet<{ at: string }>(env, 'cron:last');
        return json({ markets: prospekte, lastCheck: cron?.at ?? null, monthCostUsd: Math.round((await monthCost(env.CACHE)) * 100) / 100 });
      }

      if (url.pathname === '/api/deals') {
        const plz = url.searchParams.get('plz');
        if (!validPlz(plz)) return error('Bitte eine 5-stellige PLZ angeben.', 400);
        const markets = parseIds(url.searchParams.get('markets'));
        const data = await getOffers(env, plz, markets);
        return json(await computeDeals(env, plz, data.offers));
      }

      if (url.pathname === '/api/stores') {
        const plz = url.searchParams.get('plz');
        if (!validPlz(plz)) return error('Bitte eine 5-stellige PLZ angeben.', 400);
        const c = await centerOf(env, plz).catch(() => null);
        return json({ stores: await cached(env, `stores:${plz}`, 7 * 24 * HOUR, () => nearestStores(plz, c)) });
      }

      if (url.pathname === '/api/leaflets') {
        const plz = url.searchParams.get('plz');
        if (!validPlz(plz)) return error('Bitte eine 5-stellige PLZ angeben.', 400);
        return json(await getLeaflets(env, plz, parseIds(url.searchParams.get('markets'))));
      }

      // Stand des Prospekt-Einlesens für einen EDEKA-Markt
      if (url.pathname === '/api/debug/edeka') {
        const m = await marketById(env, Number(url.searchParams.get('market')));
        if (!m) return error('Markt unbekannt', 404);
        const idx = await kvGet<ProspektIndex>(env, `edeka:idx:${m.marketNo}`);
        const ps = await prospekteOf(env, m).catch((e) => String(e));
        const errs = Array.isArray(ps) ? await Promise.all(ps.map((p) => kvGet(env, errKey(p.key)))) : [];
        const watch = (await kvGet<Watched[]>(env, 'edeka:watch'))?.map((x) => `${x.name} (zuletzt ${new Date(x.lastSeen ?? 0).toISOString()})`);
        const first = idx?.prospekte[0] ? ((await kvGet<Offer[]>(env, pdfKey(idx.prospekte[0].key))) ?? []).slice(0, 15) : [];
        const week = await env.CACHE?.get(`extract:count:${isoWeek(new Date())}`);
        return json({
          market: m,
          watch,
          extractsThisWeek: Number(week ?? 0),
          idx,
          prospekte: ps,
          errors: errs,
          withCrop: first.filter((o) => o.crop).length,
          sample: first.map((o) => `${o.name} | ${o.price} | S.${o.page ?? '?'} | crop ${o.crop ? `${o.crop.x},${o.crop.y},${o.crop.w},${o.crop.h}` : 'KEIN'}`),
        });
      }

      // Prüft, welche Quellen von Cloudflare aus erreichbar sind
      if (url.pathname === '/api/debug/sources') {
        const urls = [
          'https://www.edeka.de/api/marketsearch/markets?searchstring=38536',
          'https://www.edeka.de/eh/service/eh/offers?marketId=10007022',
          'https://www.edeka.de/maerkte/801116/prospekte/',
          'https://blaetterkatalog.edeka.de/MINDEN/8011165/blaetterkatalog/xml/catalog.xml',
          'https://blaetterkatalog.edeka.de/MINDEN/8011165/blaetterkatalog/normal/bk_1.jpg',
        ];
        const variants: Record<string, Record<string, string>> = {
          mobil: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36', 'accept-language': 'de-DE,de;q=0.9' },
          desktop: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
            accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
            'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
            referer: 'https://www.edeka.de/',
          },
          ohne: {},
        };
        const out: Record<string, string> = {};
        for (const [name, headers] of Object.entries(variants)) {
          for (const u of urls) {
            try {
              const r = await fetch(u, { headers });
              out[`${name} ${u}`] = `${r.status} ${r.headers.get('content-type') ?? ''} ${r.headers.get('server') ?? ''}`;
            } catch (e) {
              out[`${name} ${u}`] = String(e);
            }
          }
        }
        return json(out);
      }

      if (url.pathname === '/api/health') {
        const day = new Date().toISOString().slice(0, 10);
        return json({
          ok: true,
          hasKey: !!env.ANTHROPIC_API_KEY,
          hasCache: !!env.CACHE,
          model: env.MODEL ?? null,
          monthCostUsd: Math.round((await monthCost(env.CACHE)) * 100) / 100,
          budgetUsd: budget(env),
          recipesToday: Number((await env.CACHE?.get(`rl:recipes:${day}`)) ?? 0),
          recipesPerDay: Number(env.DAILY_RECIPE_LIMIT ?? 15),
        });
      }

      // EDEKA blockt die Cloud: Das Handy holt die Marktliste selbst und meldet sie hier an
      if (url.pathname === '/api/edeka/markets' && request.method === 'POST') {
        const body = (await request.json().catch(() => null)) as { plz?: string; markets?: unknown } | null;
        const plz = body?.plz ?? null;
        if (!validPlz(plz)) return error('Bitte eine 5-stellige PLZ angeben.', 400);
        const list = await nearestFirst(env, plz, parseMarkets(body?.markets));
        await rememberMarkets(env, plz, list);
        return json({ nearby: list.map((m) => marketChainInfo(m)) });
      }

      if (url.pathname === '/api/offers' && request.method === 'GET') {
        const plz = url.searchParams.get('plz');
        if (!validPlz(plz)) return error('Bitte eine 5-stellige PLZ angeben.', 400);
        const data = await getOffers(env, plz, parseIds(url.searchParams.get('markets')), url.searchParams.get('refresh') === '1');
        await ensureSnapshot(env, plz, data.offers).catch(() => undefined);
        return json(data);
      }

      if (url.pathname === '/api/recipes' && request.method === 'POST') {
        if (!env.ANTHROPIC_API_KEY) {
          return error('Der API-Key fehlt. Trag ihn in Cloudflare als Secret ANTHROPIC_API_KEY ein.', 500);
        }
        const body = (await request.json()) as RecipeRequest;
        if (!validPlz(body.plz)) return error('Bitte eine 5-stellige PLZ angeben.', 400);
        if (await overBudget(env)) {
          return error(`Das KI-Budget von ${budget(env)} $ für diesen Monat ist aufgebraucht. Ab dem 1. geht es weiter.`, 429);
        }
        const max = Number(env.DAILY_RECIPE_LIMIT ?? 15);
        if (!(await checkLimit(env, 'recipes', max))) {
          return error(`Tageslimit von ${max} Rezeptanfragen erreicht. Morgen geht es weiter.`, 429);
        }
        const data = await getOffers(env, body.plz, (body.markets ?? []).slice(0, 6));
        return json(await generateRecipes(body, data.offers, env, tracker(env)));
      }

      // Prospekt eines Markts sofort einlesen (sonst macht das der Cron alle 30 Minuten)
      if (url.pathname === '/api/admin/extract') {
        const id = Number(url.searchParams.get('market'));
        const m = await marketById(env, id);
        if (!m) return error('Markt unbekannt – erst über die PLZ suchen.', 404);
        if (!(await checkLimit(env, 'extract', 6))) return error('Heute schon oft genug eingelesen.', 429);
        // Antwort streamen, damit die Verbindung während des Einlesens offen bleibt
        const { readable, writable } = new TransformStream();
        const w = writable.getWriter();
        const enc = new TextEncoder();
        const tick = setInterval(() => void w.write(enc.encode('.')), 10_000);
        (async () => {
          try {
            await watchMarket(env, m);
            const log = await processMarket(env, m, 2);
            await w.write(enc.encode('\n' + JSON.stringify({ log })));
          } catch (e) {
            await w.write(enc.encode('\n' + JSON.stringify({ error: String(e) })));
          } finally {
            clearInterval(tick);
            await w.close();
          }
        })();
        return new Response(readable, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
      }

      return error('Unbekannter Pfad', 404);
    } catch (e) {
      console.error(e);
      return error(e instanceof Error ? e.message : String(e), 502);
    }
  },

  async scheduled(_event: ScheduledController, env: Env) {
    console.log((await runCron(env)).join('\n'));
  },
} satisfies ExportedHandler<Env>;
