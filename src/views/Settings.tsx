import type { Settings } from '../store';
import { AppInfo } from './AppInfo';
import { CostInfo, Dislikes, ProspektInfo } from './Markets';

/** Einstellungen: Mag ich nicht, eingelesene Prospekte, KI-Kosten, App-Version */
export function SettingsView(p: { settings: Settings; markets: number[]; onToggleDislike: (n: string) => void }) {
  return (
    <>
      <h2 className="section-title">Einstellungen</h2>
      <Dislikes list={p.settings.dislikes ?? []} toggle={p.onToggleDislike} />
      <ProspektInfo markets={p.markets} />
      <CostInfo />
      <AppInfo />
    </>
  );
}
