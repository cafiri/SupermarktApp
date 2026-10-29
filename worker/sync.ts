// Geräteübergreifender Abgleich: Wer angemeldet ist, sagt Cloudflare Access.
// Das Access-Token (JWT) wird mit den öffentlichen Schlüsseln des Access-Teams geprüft,
// damit niemand eine fremde E-Mail vortäuschen kann.

export interface SyncEntry {
  /** gespeicherter Wert (null = gelöscht) */
  v: unknown;
  /** Zeitpunkt der letzten Änderung (ms) */
  t: number;
}
export type SyncDoc = Record<string, SyncEntry>;

/** Bereiche, die abgeglichen werden dürfen */
export const isSyncKey = (k: string) =>
  ['settings', 'trip', 'cart', 'shopping', 'saved', 'lastRecipes', 'watch'].includes(k) || /^savings:\d{4}-\d{2}$/.test(k);

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}
let certs: { at: number; keys: Jwk[] } | null = null;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

async function accessKeys(team: string, force = false): Promise<Jwk[]> {
  if (!force && certs && Date.now() - certs.at < 3600_000) return certs.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access-Schlüssel nicht erreichbar (${res.status})`);
  const d = (await res.json()) as { keys?: Jwk[] };
  certs = { at: Date.now(), keys: d.keys ?? [] };
  return certs.keys;
}

function tokenFrom(req: Request): string | null {
  const h = req.headers.get('cf-access-jwt-assertion');
  if (h) return h;
  const c = req.headers.get('cookie') ?? '';
  return c.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1] ?? null;
}

/** E-Mail des angemeldeten Nutzers – oder ein Grund, warum es keine gibt */
export async function accessUser(req: Request, team: string | undefined, aud: string | undefined): Promise<{ email: string } | { reason: string }> {
  if (!team) return { reason: 'ACCESS_TEAM fehlt' };
  const token = tokenFrom(req);
  if (!token) return { reason: 'kein Access-Token' };
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return { reason: 'Token kaputt' };
  let header: { kid?: string; alg?: string };
  let payload: { email?: string; iss?: string; aud?: string | string[]; exp?: number; nbf?: number };
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(h)));
    payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  } catch {
    return { reason: 'Token nicht lesbar' };
  }
  if (header.alg !== 'RS256') return { reason: 'falsches Verfahren' };
  if (payload.iss !== `https://${team}`) return { reason: 'falscher Aussteller' };
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (aud && !auds.includes(aud)) return { reason: 'falsche App' };
  const now = Date.now() / 1000;
  if (!payload.exp || payload.exp < now || (payload.nbf && payload.nbf > now + 60)) return { reason: 'Token abgelaufen' };
  let keys = await accessKeys(team);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await accessKeys(team, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return { reason: 'Schlüssel unbekannt' };
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return { reason: 'Signatur ungültig' };
  if (!payload.email) return { reason: 'keine E-Mail im Token' };
  return { email: payload.email.toLowerCase() };
}

/** Speicherort je Nutzer (E-Mail nur als Hash im Schlüssel) */
export async function syncKey(email: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
  return `sync:${[...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Neuere Änderung gewinnt, je Bereich */
export function mergeDocs(base: SyncDoc, changes: SyncDoc): SyncDoc {
  const out: SyncDoc = { ...base };
  for (const [k, e] of Object.entries(changes)) {
    if (!isSyncKey(k) || !e || typeof e.t !== 'number') continue;
    if (!out[k] || e.t > out[k].t) out[k] = { v: e.v ?? null, t: Math.min(e.t, Date.now() + 60_000) };
  }
  return out;
}
