import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Leaflet, Recipe, RecipeRequest, RecipesResponse } from '../shared/types';
import { api, loadLastRecipes, LoginError, useCart, useOffers, useSavedRecipes, useSettings, useShoppingList, useStores, useTrip, write } from './store';
import { shortChain } from './format';
import { CookView, type GenState } from './views/Cook';
import { ShoppingView } from './views/Shopping';
import { ListContext } from './actions';
import { OffersView } from './views/Offers';
import { MarketsView } from './views/Markets';
import { RecipeDetail } from './views/RecipeDetail';
import { LeafletView } from './views/LeafletView';

type Tab = 'kochen' | 'angebote' | 'einkauf' | 'maerkte';

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
  const cart = useCart();
  const saved = useSavedRecipes();
  const [replacing, setReplacing] = useState<string | null>(null);
  const shopping = useShoppingList();
  const stores = useStores(plz || null);
  const [wishes, setWishes] = useState('');
  const [gen, setGen] = useState<GenState>({ loading: false, error: null, loginExpired: false, startedAt: 0 });
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

  const ready = !!plz && activeChains.length > 0;

  // Rezepte werden NUR hier gebaut – ausgelöst durch den Knopf im Kochen-Tab
  const generate = useCallback(async (replaceId?: string) => {
    if (!ready || gen.loading || replacing) return;
    if (replaceId) setReplacing(replaceId);
    else setGen({ loading: true, error: null, loginExpired: false, startedAt: Date.now() });
    try {
      const body: RecipeRequest = {
        plz,
        chains: activeChains,
        markets,
        diet: settings.diet,
        persons: settings.persons,
        days: settings.days,
        maxMinutes: settings.maxMinutes,
        cart: cart.cart.map((o) => o.id),
        cartMode: settings.cartMode,
        wishes,
        dislikes: settings.dislikes ?? [],
        fast: settings.fast,
        replace: replaceId ? { avoidTitles: (results?.recipes ?? []).map((r) => r.title) } : undefined,
      };
      const data = await api<RecipesResponse>('/api/recipes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      let next = data;
      if (replaceId && results && data.recipes[0]) {
        // Nur das eine Rezept austauschen, Rest bleibt
        const recipes = results.recipes.map((r) => (r.id === replaceId ? data.recipes[0] : r)).sort((a, b) => a.perPortion - b.perPortion);
        next = { ...results, recipes };
      }
      setResults(next);
      write('lastRecipes', next);
      setGen((g) => ({ ...g, loading: false }));
    } catch (e) {
      setGen((g) => ({ ...g, loading: false, error: e instanceof Error ? e.message : String(e), loginExpired: e instanceof LoginError }));
    } finally {
      setReplacing(null);
    }
  }, [ready, gen.loading, replacing, plz, activeChains, markets, settings, cart.cart, wishes, results]);

  const toggleDislike = useCallback(
    (name: string) => {
      const d = settings.dislikes ?? [];
      const has = d.some((x) => x.toLowerCase() === name.toLowerCase());
      updateSettings({ dislikes: has ? d.filter((x) => x.toLowerCase() !== name.toLowerCase()) : [...d, name] });
    },
    [settings.dislikes, updateSettings],
  );

  const chainCounts = useMemo(() => {
    const m = new Map<string, number>();
    offers.data?.chains.forEach((c) => m.set(c.name, c.count));
    return m;
  }, [offers.data]);

  const listActions = { toggleListOffer: shopping.toggleOffer, isOnList: shopping.hasOffer };

  if (detail)
    return (
      <RecipeDetail
        recipe={detail}
        onBack={closeDetail}
        onList={() => shopping.toggleRecipe(detail)}
        onListNow={shopping.has(detail)}
        saved={saved.isSaved(detail)}
        onSave={() => saved.toggle(detail)}
        dislikes={settings.dislikes ?? []}
        onDislike={toggleDislike}
      />
    );
  if (leaflet)
    return (
      <ListContext.Provider value={listActions}>
      <LeafletView
        chain={leaflet.chain}
        leaflets={leaflet.leaflets}
        offers={(offers.data?.offers ?? []).filter((o) => o.chain === leaflet.chain)}
        onBack={closeDetail}
        onToggleCart={cart.toggle}
        inCart={cart.ids}
      />
      </ListContext.Provider>
    );

  return (
    <ListContext.Provider value={listActions}>
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
            cart={cart.cart}
            removeFromCart={cart.remove}
            clearCart={cart.clear}
            cartRemoved={cart.removed}
            dismissCartRemoved={cart.dismissRemoved}
            wishes={wishes}
            setWishes={setWishes}
            gen={gen}
            onGenerate={() => generate()}
            onReplace={(id) => generate(id)}
            replacing={replacing}
            saved={saved.saved}
            isSaved={saved.isSaved}
            onSave={saved.toggle}
            baseChains={baseChains}
            activeChains={activeChains}
            setActiveChains={(list) => setSkipToday(baseChains.filter((c) => !list.includes(c)))}
            results={results}
            onOpen={openDetail}
            onList={shopping.toggleRecipe}
            isOnList={shopping.has}
            ready={ready}
            goToMarkets={() => setTab('maerkte')}
            goToOffers={() => setTab('angebote')}
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
            onToggleCart={cart.toggle}
            inCart={cart.ids}
            hasPlz={!!plz}
            goToMarkets={() => setTab('maerkte')}
          />
        )}
        {tab === 'einkauf' && (
          <ShoppingView
            recipes={shopping.recipes}
            singles={shopping.offers}
            removeSingle={shopping.toggleOffer}
            checked={shopping.checked}
            toggleItem={shopping.toggleItem}
            removeRecipe={shopping.toggleRecipe}
            clear={shopping.clear}
            onOpen={openDetail}
            stores={stores}
            goToCook={() => setTab('kochen')}
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
            stores={stores}
            onToggleDislike={toggleDislike}
          />
        )}
      </main>

      {cart.cart.length > 0 && tab !== 'kochen' && (
        <button className="cart-bar" onClick={() => setTab('kochen')}>
          <span className="cart-bar-count">{cart.cart.length}</span>
          <span className="cart-bar-names">{cart.cart.map((o) => o.name).join(', ')}</span>
          <span className="cart-bar-go">Zum Korb</span>
        </button>
      )}

      <nav className="tabbar" aria-label="Bereiche">
        <TabButton id="kochen" tab={tab} setTab={setTab} label="Kochen" icon={<PotIcon />} />
        <TabButton id="angebote" tab={tab} setTab={setTab} label="Angebote" icon={<TagIcon />} />
        <TabButton
          id="einkauf"
          tab={tab}
          setTab={setTab}
          label="Einkauf"
          icon={<ListIcon />}
          badge={shopping.recipes.length + shopping.offers.length || undefined}
        />
        <TabButton id="maerkte" tab={tab} setTab={setTab} label="Märkte" icon={<PinIcon />} />
      </nav>
    </div>
    </ListContext.Provider>
  );
}

function TabButton(props: { id: Tab; tab: Tab; setTab: (t: Tab) => void; label: string; icon: JSX.Element; badge?: number }) {
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
      {props.badge ? <span className="tab-badge">{props.badge}</span> : null}
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
const ListIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 6h11 M9 12h11 M9 18h11 M4 6l1 1 2-2 M4 12l1 1 2-2 M4 18l1 1 2-2" />
  </svg>
);
const PinIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" />
    <circle cx="12" cy="9" r="2.5" />
  </svg>
);
