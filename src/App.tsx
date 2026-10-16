import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Leaflet, Offer, Recipe, RecipesResponse } from '../shared/types';
import { loadLastRecipes, useOffers, useSettings, useTrip, write } from './store';
import { shortChain } from './format';
import { CookView } from './views/Cook';
import { OffersView } from './views/Offers';
import { MarketsView } from './views/Markets';
import { RecipeDetail } from './views/RecipeDetail';
import { LeafletView } from './views/LeafletView';

type Tab = 'kochen' | 'angebote' | 'maerkte';

export default function App() {
  const [settings, updateSettings] = useSettings();
  const [trip, setTrip] = useTrip();
  const [tab, setTab] = useState<Tab>(() => (settings.plz && settings.chains.length ? 'kochen' : 'maerkte'));

  // Aktive PLZ und Märkte: unterwegs die Reiseauswahl, sonst die Standard-Märkte
  const plz = trip?.plz ?? settings.plz;
  const baseChains = trip?.chains ?? settings.chains;
  const markets = trip?.markets ?? settings.markets ?? [];
  // Heute abgewählte Märkte (nur für diese Sitzung)
  const [skipToday, setSkipToday] = useState<string[]>([]);
  const activeChains = baseChains.filter((c) => !skipToday.includes(c));

  const offers = useOffers(plz || null, markets);
  const [focus, setFocus] = useState<Offer | null>(null);
  const [results, setResults] = useState<RecipesResponse | null>(() => loadLastRecipes());
  const [detail, setDetail] = useState<Recipe | null>(null);
  const [leaflet, setLeaflet] = useState<{ chain: string; leaflets: Leaflet[] } | null>(null);

  // Android-Zurück-Taste schließt Rezept- und Prospektansicht
  useEffect(() => {
    const onPop = () => {
      setDetail(null);
      setLeaflet(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const openDetail = useCallback((r: Recipe) => {
    history.pushState({ detail: r.id }, '');
    setDetail(r);
    window.scrollTo(0, 0);
  }, []);
  const closeDetail = useCallback(() => history.back(), []);
  const openLeaflet = useCallback((chain: string, leaflets: Leaflet[]) => {
    history.pushState({ leaflet: chain }, '');
    setLeaflet({ chain, leaflets });
    window.scrollTo(0, 0);
  }, []);

  const onResults = useCallback((r: RecipesResponse) => {
    setResults(r);
    write('lastRecipes', r);
  }, []);

  const cookWith = useCallback((o: Offer) => {
    if (leaflet) history.back();
    setFocus(o);
    setTab('kochen');
    window.scrollTo(0, 0);
  }, []);

  const chainCounts = useMemo(() => {
    const m = new Map<string, number>();
    offers.data?.chains.forEach((c) => m.set(c.name, c.count));
    return m;
  }, [offers.data]);

  if (detail) return <RecipeDetail recipe={detail} onBack={closeDetail} />;
  if (leaflet)
    return (
      <LeafletView
        chain={leaflet.chain}
        leaflets={leaflet.leaflets}
        offers={(offers.data?.offers ?? []).filter((o) => o.chain === leaflet.chain)}
        onBack={closeDetail}
        onCook={cookWith}
      />
    );

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <h1 className="brand">Angebotsküche</h1>
          {plz && (
            <button className="plz-pill" onClick={() => setTab('maerkte')} aria-label="Märkte und PLZ ändern">
              {trip ? 'Unterwegs' : 'Zuhause'} · {plz}
            </button>
          )}
        </div>
        {baseChains.length > 0 && (
          <div className="chain-row" role="group" aria-label="Heute einkaufen bei">
            {baseChains.map((c) => {
              const on = !skipToday.includes(c);
              return (
                <button
                  key={c}
                  className={`chain-chip ${on ? 'on' : ''}`}
                  aria-pressed={on}
                  onClick={() => setSkipToday((s) => (on ? [...s, c] : s.filter((x) => x !== c)))}
                >
                  {shortChain(c)}
                  {chainCounts.has(c) && <span className="count">{chainCounts.get(c)}</span>}
                </button>
              );
            })}
            {trip && (
              <button className="chain-chip trip-end" onClick={() => setTrip(null)}>
                Zurück nach Hause
              </button>
            )}
          </div>
        )}
      </header>

      <main className="content">
        {tab === 'kochen' && (
          <CookView
            settings={settings}
            updateSettings={updateSettings}
            plz={plz}
            chains={activeChains}
            markets={markets}
            focus={focus}
            clearFocus={() => setFocus(null)}
            results={results}
            onResults={onResults}
            onOpen={openDetail}
            ready={!!plz && activeChains.length > 0}
            goToMarkets={() => setTab('maerkte')}
          />
        )}
        {tab === 'angebote' && (
          <OffersView
            offers={offers.data?.offers ?? []}
            chains={activeChains}
            loading={offers.loading}
            error={offers.error}
            onReload={offers.reload}
            fetchedAt={offers.data?.fetchedAt}
            notes={offers.data?.notes ?? []}
            plz={plz}
            markets={markets}
            onOpenLeaflet={openLeaflet}
            onCook={cookWith}
            hasPlz={!!plz}
            goToMarkets={() => setTab('maerkte')}
          />
        )}
        {tab === 'maerkte' && (
          <MarketsView
            settings={settings}
            updateSettings={updateSettings}
            trip={trip}
            setTrip={(t) => {
              setTrip(t);
              setSkipToday([]);
            }}
            onDone={() => setTab('kochen')}
          />
        )}
      </main>

      <nav className="tabbar" aria-label="Bereiche">
        <TabButton id="kochen" tab={tab} setTab={setTab} label="Kochen" icon={<PotIcon />} />
        <TabButton id="angebote" tab={tab} setTab={setTab} label="Angebote" icon={<TagIcon />} />
        <TabButton id="maerkte" tab={tab} setTab={setTab} label="Märkte" icon={<PinIcon />} />
      </nav>
    </div>
  );
}

function TabButton(props: { id: Tab; tab: Tab; setTab: (t: Tab) => void; label: string; icon: JSX.Element }) {
  const active = props.id === props.tab;
  return (
    <button
      className={`tab ${active ? 'active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        props.setTab(props.id);
        window.scrollTo(0, 0);
      }}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

const PotIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 11h16v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z M2 11h2 M20 11h2 M9 7c0-1.5 1-2 1-3 M14 7c0-1.5 1-2 1-3" />
  </svg>
);
const TagIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 12V4h8l10 10-8 8z" />
    <circle cx="7.5" cy="8.5" r="1.5" />
  </svg>
);
const PinIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" />
    <circle cx="12" cy="9" r="2.5" />
  </svg>
);
