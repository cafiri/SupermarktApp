import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';

// Neue Versionen sofort übernehmen: die Seite lädt neu, sobald ein Update bereitliegt.
// Beim Zurückkehren in die App wird nach Updates gesucht.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => void updateSW(true),
  onRegisteredSW: (_url, reg) => {
    if (!reg) return;
    const check = () => void reg.update().catch(() => undefined);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
    setInterval(check, 30 * 60_000);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
