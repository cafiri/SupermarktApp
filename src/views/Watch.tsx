import { useEffect, useState } from 'react';
import { api } from '../store';
import type { Offer } from '../../shared/types';
import { shortChain } from '../format';
import { write } from '../store';
import { OfferRow } from './OfferRow';

export { matchWatch } from '../../shared/watch';
import { matchWatch } from '../../shared/watch';

export function readWatch(): string[] {
  try {
    return JSON.parse(localStorage.getItem('watch') ?? '[]');
  } catch {
    return [];
  }
}

/** Merkliste: Dinge, auf die man wartet. Zeigt, wo sie gerade im Angebot sind. */
export function WatchView(p: {
  terms: string[];
  setTerms: (t: string[]) => void;
  offers: Offer[];
  onToggleCart: (o: Offer) => void;
  inCart: Set<number>;
  plz: string;
  markets: number[];
  chains: string[];
}) {
  const [input, setInput] = useState('');
  const save = (t: string[]) => {
    p.setTerms(t);
    write('watch', t);
    void syncPush(t);
  };

  // ---- Benachrichtigung am Montagmorgen ----
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const [pushOn, setPushOn] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setPushOn(!!s)).catch(() => undefined);
  }, [supported]);

  async function syncPush(terms = p.terms) {
    if (!supported) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await api('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, plz: p.plz, markets: p.markets, chains: p.chains, watch: terms }),
    }).catch(() => undefined);
  }

  async function enablePush() {
    setPushMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setPushMsg('Benachrichtigungen sind für diese App blockiert. Erlaube sie in den Android-Einstellungen der App.');
        return;
      }
      const { publicKey } = await api<{ publicKey: string }>('/api/push/key');
      const reg = await navigator.serviceWorker.ready;
      const raw = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
      await syncPush();
      setPushOn(true);
      setPushMsg('Eingeschaltet. Du bekommst jeden Montagmorgen eine Nachricht zu deiner Merkliste.');
    } catch (e) {
      setPushMsg(`Hat nicht geklappt: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function disablePush() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/api/push/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
      await sub.unsubscribe();
    }
    setPushOn(false);
    setPushMsg('Ausgeschaltet.');
  }

  async function testPush() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await syncPush();
    const r = await api<{ status: number }>('/api/push/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch((e) => ({ status: 0, error: String(e) }));
    setPushMsg(r.status >= 200 && r.status < 300 ? 'Test gesendet – die Nachricht sollte gleich kommen.' : `Test fehlgeschlagen (${r.status}).`);
  }
  const add = () => {
    const t = input.trim();
    if (t.length < 2 || p.terms.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    save([...p.terms, t]);
    setInput('');
  };

  return (
    <section aria-label="Merkliste">
      <form
        className="search-row watch-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Worauf wartest du? z. B. Pizza, Garnelen" aria-label="Neuer Eintrag für die Merkliste" />
        <button type="submit" className="secondary" disabled={input.trim().length < 2}>
          Merken
        </button>
      </form>

      {supported && (
        <div className="push-box pad">
          {pushOn ? (
            <>
              <span>🔔 Montags um 7 Uhr bekommst du eine Nachricht zu deiner Merkliste.</span>
              <span className="push-actions">
                <button className="link" onClick={testPush}>
                  Test senden
                </button>
                <button className="link" onClick={disablePush}>
                  Ausschalten
                </button>
              </span>
            </>
          ) : (
            <button className="secondary small-btn" onClick={enablePush}>
              🔔 Montags benachrichtigen
            </button>
          )}
          {pushMsg && <span className="note">{pushMsg}</span>}
        </div>
      )}

      {!p.terms.length && (
        <p className="muted pad">
          Trag Produkte ein, auf die du wartest. Jede Woche siehst du hier, ob und wo sie im Angebot sind – auch schon für nächste Woche.
        </p>
      )}

      {p.terms.map((term) => {
        const hits = matchWatch(term, p.offers);
        const chains = [...new Set(hits.map((o) => shortChain(o.chain)))];
        return (
          <section key={term} className="watch-group">
            <div className="watch-head pad">
              <h3>{term}</h3>
              <button className="icon-btn" onClick={() => save(p.terms.filter((x) => x !== term))} aria-label={`${term} von der Merkliste nehmen`}>
                ✕
              </button>
            </div>
            {hits.length ? (
              <>
                <p className="watch-hit pad">Im Angebot bei {chains.join(', ')}</p>
                <ul className="offer-list">
                  {hits.slice(0, 8).map((o) => (
                    <OfferRow key={o.id} o={o} onToggleCart={p.onToggleCart} inCart={p.inCart.has(o.id)} />
                  ))}
                </ul>
                {hits.length > 8 && <p className="muted pad small">und {hits.length - 8} weitere</p>}
              </>
            ) : (
              <p className="muted pad watch-none">Diese Woche gibt es nichts.</p>
            )}
          </section>
        );
      })}
    </section>
  );
}
