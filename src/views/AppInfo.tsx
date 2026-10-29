import { useEffect, useState } from 'react';
import { pull, syncStatus, type SyncStatus } from '../sync';

type Build = { sha: string; builtAt: string };
const current: Build = __BUILD__;

const fmt = (b: Build) =>
  `${new Date(b.builtAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${b.sha}`;

/** Abgleich zwischen Handy und PC über das Cloudflare-Konto */
export function SyncInfo() {
  const [s, setS] = useState<SyncStatus>(syncStatus);
  useEffect(() => {
    const f = () => setS({ ...syncStatus() });
    window.addEventListener('sync-status', f);
    return () => window.removeEventListener('sync-status', f);
  }, []);
  const time = s.at ? new Date(s.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <section className="card">
      <h2>Abgleich zwischen Geräten</h2>
      <p className="muted small">
        Märkte, Einstellungen, „Mag ich nicht“, Rezepte, gespeicherte Rezepte, Korb, Einkaufsliste und Merkliste sind auf allen Geräten gleich, auf
        denen du mit deinem Cloudflare-Konto angemeldet bist.
      </p>
      {s.state === 'ok' && (
        <p className="note">
          ✓ Abgeglichen um {time}
          {s.email ? ` · ${s.email}` : ''}
        </p>
      )}
      {s.state === 'laeuft' && <p className="muted small">Gleiche ab …</p>}
      {s.state === 'fehler' && <p className="error">Abgleich hat nicht geklappt: {s.message}</p>}
      <button className="secondary small-btn" onClick={() => void pull()} disabled={s.state === 'laeuft'}>
        Jetzt abgleichen
      </button>
    </section>
  );
}

/** Version der App, Update-Prüfung und "alle Daten dieser Website löschen" */
export function AppInfo() {
  const [check, setCheck] = useState<'idle' | 'checking' | 'aktuell' | 'neu' | 'fehler'>('idle');
  const [latest, setLatest] = useState<Build | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [cleared, setCleared] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function checkUpdate() {
    setCheck('checking');
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store', redirect: 'manual' });
      if (!res.ok) throw new Error();
      const b = (await res.json()) as Build;
      setLatest(b);
      setCheck(b.sha === current.sha && b.builtAt === current.builtAt ? 'aktuell' : 'neu');
    } catch {
      setCheck('fehler');
    }
  }

  async function update() {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update().catch(() => undefined);
    location.reload();
  }

  async function clearAll() {
    setBusy(true);
    const done: string[] = [];
    // Merkliste behalten
    const watch = localStorage.getItem('watch');
    try {
      // Server antwortet mit "Clear-Site-Data": löscht Cookies und Speicher – nur für diese Website
      const res = await fetch('/api/clear', { cache: 'no-store', redirect: 'manual' });
      if (res.ok) done.push('Cookies');
    } catch {
      /* offline – lokal trotzdem löschen */
    }
    try {
      localStorage.clear();
      sessionStorage.clear();
      done.push('Märkte, Korb, Einkaufsliste und Rezepte auf diesem Gerät');
    } catch {
      /* egal */
    }
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        done.push(`Zwischenspeicher (${keys.length})`);
      }
      const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
      await Promise.all(regs.map((r) => r.unregister()));
      if (regs.length) done.push('Offline-Version der App');
    } catch {
      /* egal */
    }
    // Merkliste zurücklegen (auch nach kurzer Verzögerung, falls der Server-Teil später greift)
    const restore = () => {
      try {
        if (watch) localStorage.setItem('watch', watch);
      } catch {
        /* egal */
      }
    };
    restore();
    setTimeout(restore, 500);
    setBusy(false);
    setCleared(done);
  }

  return (
    <section className="card app-info">
      <h2>App</h2>
      <p className="muted small">Version {fmt(current)}</p>
      <div className="app-actions">
        <button className="secondary small-btn" onClick={checkUpdate} disabled={check === 'checking'}>
          {check === 'checking' ? 'Prüfe …' : 'Auf Updates prüfen'}
        </button>
        {check === 'neu' && (
          <button className="primary small-btn" onClick={update}>
            Jetzt aktualisieren
          </button>
        )}
      </div>
      {check === 'aktuell' && <p className="note">Du hast die neueste Version.</p>}
      {check === 'neu' && latest && <p className="note">Neue Version verfügbar: {fmt(latest)}</p>}
      {check === 'fehler' && <p className="error">Konnte nicht prüfen. Bist du online und angemeldet?</p>}

      <div className="danger">
        {cleared ? (
          <div className="cleared" role="status">
            <p>
              <strong>✓ Gelöscht:</strong> {cleared.join(', ')}. Deine Merkliste ist geblieben. Alles, was in deinem Konto abgeglichen ist, kommt beim Neustart zurück.
            </p>
            <p className="small muted">
              Beim Neustart meldet Cloudflare dich meist automatisch wieder an, weil es sich den Login auf seiner eigenen Seite merkt. Willst du
              dich komplett abmelden, nimm „Abmelden“.
            </p>
            <div className="app-actions">
              <button className="primary small-btn" onClick={() => location.replace('/')}>
                App neu starten
              </button>
              <a className="secondary small-btn" href="/cdn-cgi/access/logout">
                Abmelden
              </a>
            </div>
          </div>
        ) : !confirm ? (
          <button className="link danger-link" onClick={() => setConfirm(true)}>
            Alle Daten dieser App löschen
          </button>
        ) : (
          <>
            <p className="small">
              Löscht nur für diese App und nur auf diesem Gerät: Märkte, Korb, Einkaufsliste, gespeicherte Rezepte, Zwischenspeicher und Cookies. Die Merkliste bleibt, und dein abgeglichener Stand im Konto auch.
              Andere Websites bleiben unberührt.
            </p>
            <div className="app-actions">
              <button className="primary small-btn danger-btn" onClick={clearAll} disabled={busy}>
                {busy ? 'Lösche …' : 'Ja, löschen'}
              </button>
              <button className="secondary small-btn" onClick={() => setConfirm(false)}>
                Abbrechen
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
