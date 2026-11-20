// Ist die Cloudflare-Anmeldung abgelaufen, sofort zur Anmeldemaske wechseln –
// statt erst später beim Laden der Angebote einen Fehler zu zeigen.

const TRY = 'loginTry';
let lastCheck = 0;

function banner() {
  if (document.getElementById('login-banner')) return;
  const b = document.createElement('div');
  b.id = 'login-banner';
  b.className = 'login-banner';
  b.setAttribute('role', 'alert');
  b.innerHTML = '<span>Deine Anmeldung ist abgelaufen.</span> <a href="/api/login">Jetzt anmelden</a>';
  document.body.appendChild(b);
}

function goLogin() {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(TRY) ?? 0);
    sessionStorage.setItem(TRY, String(Date.now()));
  } catch {
    /* egal */
  }
  // Schutz vor Endlosschleife: kurz nach einem Versuch nur einen Hinweis zeigen
  if (Date.now() - last < 2 * 60_000) return banner();
  location.replace('/api/login');
}

export async function checkLogin(force = false) {
  if (!navigator.onLine) return;
  if (!force && Date.now() - lastCheck < 5 * 60_000) return;
  lastCheck = Date.now();
  let res: Response;
  try {
    res = await fetch(`/version.json?login=${Date.now()}`, { redirect: 'manual', cache: 'no-store' });
  } catch {
    return; // offline oder Netz weg – nicht zur Anmeldung schicken
  }
  const ct = res.headers.get('content-type') ?? '';
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403 || !ct.includes('json')) goLogin();
  else document.getElementById('login-banner')?.remove();
}

export function startLoginCheck() {
  void checkLogin(true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkLogin();
  });
}
