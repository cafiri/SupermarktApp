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
    // Alles, was diese App im Browser gespeichert hat – andere Websites bleiben unberührt
    try {
      localStorage.clear();
      sessionStorage.clear();
      if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
      const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
      await Promise.all(regs.map((r) => r.unregister()));
    } catch {
      /* weiter mit dem Server-Teil */
    }
    // Der Server antwortet mit "Clear-Site-Data" und löscht damit auch die Cookies (inkl. Anmeldung) dieser Website
    location.href = '/api/clear';
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
        {!confirm ? (
          <button className="link danger-link" onClick={() => setConfirm(true)}>
            Alle Daten dieser App löschen
          </button>
        ) : (
          <>
            <p className="small">
              Löscht nur für diese App: Märkte, Korb, Einkaufsliste, Merkliste, gespeicherte Rezepte, Zwischenspeicher und Cookies. Du musst dich
              danach neu anmelden. Andere Websites bleiben unberührt.
            </p>
            <div className="app-actions">
              <button className="primary small-btn danger-btn" onClick={clearAll}>
                Ja, löschen
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
