// Abgleich zwischen Geräten über das Cloudflare-Konto.
// Jeder Bereich (Einstellungen, Korb, Einkaufsliste …) hat einen Änderungszeitpunkt; die neuere Fassung gewinnt.
// Beim allerersten Abgleich eines Geräts wird zusammengeführt statt überschrieben, damit nichts verloren geht.

type Entry = { v: unknown; t: number };
type Doc = Record<string, Entry>;

const KEYS = ['settings', 'trip', 'cart', 'shopping', 'saved', 'lastRecipes', 'watch'];
export const isSynced = (k: string) => KEYS.includes(k) || /^savings:\d{4}-\d{2}$/.test(k);

const META = 'syncMeta';
const INIT = 'syncInit';

export interface SyncStatus {
  state: 'aus' | 'laeuft' | 'ok' | 'fehler';
  email?: string;
  at?: number;
  message?: string;
}
let status: SyncStatus = { state: 'aus' };
const setStatus = (s: SyncStatus) => {
  status = s;
  window.dispatchEvent(new CustomEvent('sync-status'));
};
export const syncStatus = () => status;

function get(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function set(k: string, v: string | null) {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* egal */
  }
}
const meta = (): Record<string, number> => {
  try {
    return JSON.parse(get(META) ?? '{}');
  } catch {
    return {};
  }
};
const parse = (raw: string | null): unknown => {
  try {
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
};

let dirty = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Von write() aufgerufen, wenn sich ein Bereich wirklich geändert hat */
export function markChanged(key: string) {
  if (!isSynced(key)) return;
  const m = meta();
  m[key] = Date.now();
  set(META, JSON.stringify(m));
  dirty.add(key);
  clearTimeout(timer);
  timer = setTimeout(() => void push(), 1500);
}

async function call(method: 'GET' | 'PUT', body?: unknown): Promise<{ email: string; doc: Doc }> {
  const res = await fetch('/api/sync', {
    method,
    redirect: 'manual',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new Error('Anmeldung abgelaufen');
  const d = await res.json();
  if (!res.ok) throw new Error(d.error ?? `Fehler ${res.status}`);
  return d;
}

// ---- Zusammenführen beim ersten Abgleich eines Geräts ----
const byId = <T extends { id: unknown }>(a: T[] = [], b: T[] = []) => [...a, ...b.filter((x) => !a.some((y) => y.id === x.id))];
const union = <T,>(a: T[] = [], b: T[] = []) => [...new Set([...a, ...b])];

function firstMerge(key: string, local: any, remote: any): unknown {
  if (local == null) return remote;
  if (remote == null) return local;
  switch (key) {
    case 'watch':
      return union(remote, local);
    case 'saved':
    case 'cart':
      return byId(remote, local);
    case 'shopping':
      return {
        recipes: byId(remote.recipes, local.recipes),
        offers: byId(remote.offers, local.offers),
        checked: union(remote.checked, local.checked),
        have: { ...(local.have ?? {}), ...(remote.have ?? {}) },
      };
    case 'settings': {
      // Ein Gerät ohne gewählte Märkte ist "neu": dann gelten die Einstellungen aus dem Konto
      const base = remote.plz || !local.plz ? remote : local;
      return {
        ...base,
        dislikes: union(remote.dislikes, local.dislikes),
        combos: [...(remote.combos ?? []), ...(local.combos ?? []).filter((c: any) => !(remote.combos ?? []).some((r: any) => r.name === c.name))],
      };
    }
    case 'lastRecipes':
      return Date.parse(local.createdAt ?? 0) > Date.parse(remote.createdAt ?? 0) ? local : remote;
    default:
      if (key.startsWith('savings:')) return Math.max(Number(local) || 0, Number(remote) || 0);
      return remote;
  }
}

/** Übernimmt Werte aus dem Konto und meldet geänderte Bereiche an die Ansichten */
function apply(doc: Doc, first: boolean): string[] {
  const m = meta();
  const changed: string[] = [];
  const keys = new Set([...Object.keys(doc).filter(isSynced), ...(first ? Object.keys(localStorage).filter(isSynced) : [])]);
  for (const k of keys) {
    const remote = doc[k];
    const localRaw = get(k);
    if (first) {
      const merged = firstMerge(k, parse(localRaw), remote?.v ?? null);
      const raw = merged == null ? null : JSON.stringify(merged);
      if (raw !== localRaw) {
        set(k, raw);
        changed.push(k);
      }
      // Ergebnis zurück ins Konto, wenn es vom Kontostand abweicht
      if (raw !== (remote?.v == null ? null : JSON.stringify(remote.v))) {
        m[k] = Date.now();
        dirty.add(k);
      } else m[k] = remote?.t ?? Date.now();
    } else if (remote && remote.t > (m[k] ?? 0)) {
      const raw = remote.v == null ? null : JSON.stringify(remote.v);
      if (raw !== localRaw) {
        set(k, raw);
        changed.push(k);
      }
      m[k] = remote.t;
      dirty.delete(k);
    } else if (!remote || remote.t < (m[k] ?? 0)) {
      if (m[k]) dirty.add(k);
    }
  }
  set(META, JSON.stringify(m));
  if (changed.length) window.dispatchEvent(new CustomEvent('sync', { detail: changed }));
  return changed;
}

let running: Promise<void> | null = null;

/** Holt den Stand aus dem Konto und schickt eigene Änderungen hin */
export function pull(): Promise<void> {
  if (running) return running;
  running = (async () => {
    setStatus({ ...status, state: 'laeuft' });
    try {
      const first = !get(INIT);
      const r = await call('GET');
      apply(r.doc, first);
      set(INIT, '1');
      await push(true);
      setStatus({ state: 'ok', email: r.email, at: Date.now() });
    } catch (e) {
      setStatus({ ...status, state: 'fehler', message: e instanceof Error ? e.message : String(e) });
    } finally {
      running = null;
    }
  })();
  return running;
}

async function push(inPull = false): Promise<void> {
  if (!get(INIT)) {
    // Noch nie abgeglichen: erst den Kontostand holen, sonst würde dieses Gerät alles überschreiben
    if (!inPull) void pull();
    return;
  }
  if (!dirty.size) return;
  const m = meta();
  const changes: Doc = {};
  const sending = [...dirty];
  for (const k of sending) changes[k] = { v: parse(get(k)), t: m[k] ?? Date.now() };
  dirty = new Set([...dirty].filter((k) => !sending.includes(k)));
  try {
    const r = await call('PUT', { changes });
    apply(r.doc, false);
    if (!inPull) setStatus({ state: 'ok', email: r.email, at: Date.now() });
  } catch (e) {
    sending.forEach((k) => dirty.add(k));
    setStatus({ ...status, state: 'fehler', message: e instanceof Error ? e.message : String(e) });
  }
}

/** Beim Start und beim Zurückwechseln in die App abgleichen */
export function startSync() {
  void pull();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pull();
    else void push();
  });
  window.addEventListener('online', () => void pull());
}
