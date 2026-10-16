import { useState } from 'react';

type Build = { sha: string; builtAt: string };
const current: Build = __BUILD__;

const fmt = (b: Build) =>
  `${new Date(b.builtAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${b.sha}`;

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
      done.push('Märkte, Korb, Einkaufsliste und Rezepte');
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
              <strong>✓ Gelöscht:</strong> {cleared.join(', ')}. Deine Merkliste ist geblieben.
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
              Löscht nur für diese App: Märkte, Korb, Einkaufsliste, gespeicherte Rezepte, Zwischenspeicher und Cookies. Die Merkliste bleibt.
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
