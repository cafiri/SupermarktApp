// Cloudflare Worker: liefert die App aus (statische Dateien) und die API unter /api/*
import { fetchRawOffers } from './marktguru';
import { normalizeAll } from './normalize';
import { generateRecipes } from './recipes';
import type { OffersResponse, RecipeRequest } from '../shared/types';

export interface Env {
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  MODEL?: string;
}

const OFFER_TTL = 6 * 3600_000;
const memo = new Map<string, { at: number; data: OffersResponse }>();

export async function getOffers(plz: string, force = false): Promise<OffersResponse> {
  const hit = memo.get(plz);
  if (!force && hit && Date.now() - hit.at < OFFER_TTL) return hit.data;
  const raw = await fetchRawOffers(plz);
  const { offers, chains } = normalizeAll(raw);
  const data: OffersResponse = { plz, fetchedAt: new Date().toISOString(), chains, offers };
  memo.set(plz, { at: Date.now(), data });
  return data;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function error(message: string, status = 500): Response {
  return json({ error: message }, status);
}

const validPlz = (p: string | null): p is string => !!p && /^\d{5}$/.test(p);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      if (url.pathname === '/api/health') {
        return json({ ok: true, hasKey: !!env.ANTHROPIC_API_KEY, model: env.MODEL ?? null });
      }

      if (url.pathname === '/api/offers' && request.method === 'GET') {
        const plz = url.searchParams.get('plz');
        if (!validPlz(plz)) return error('Bitte eine 5-stellige PLZ angeben.', 400);
        return json(await getOffers(plz, url.searchParams.get('refresh') === '1'));
      }

      if (url.pathname === '/api/recipes' && request.method === 'POST') {
        if (!env.ANTHROPIC_API_KEY) {
          return error('Der API-Key fehlt. Trag ihn in Cloudflare als Secret ANTHROPIC_API_KEY ein.', 500);
        }
        const body = (await request.json()) as RecipeRequest;
        if (!validPlz(body.plz)) return error('Bitte eine 5-stellige PLZ angeben.', 400);
        const offers = await getOffers(body.plz);
        return json(await generateRecipes(body, offers.offers, env));
      }

      return error('Unbekannter Pfad', 404);
    } catch (e) {
      console.error(e);
      return error(e instanceof Error ? e.message : String(e), 502);
    }
  },
} satisfies ExportedHandler<Env>;
