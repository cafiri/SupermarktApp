// Kosten der Claude-Aufrufe mitzählen und ein Monatsbudget einhalten.
// Preise in US-Dollar pro 1 Mio. Tokens (Eingabe, Ausgabe), Stand Oktober 2026.
const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function costUsd(model: string, u: Usage | undefined): number {
  if (!u) return 0;
  const [inp, out] = PRICES[model] ?? PRICES['claude-sonnet-5-5'];
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  return (input * inp + (u.output_tokens ?? 0) * out) / 1_000_000;
}

const monthKey = () => `cost:${new Date().toISOString().slice(0, 7)}`;

export async function monthCost(kv: KVNamespace | undefined): Promise<number> {
  if (!kv) return 0;
  return Number((await kv.get(monthKey())) ?? 0);
}

export async function addCost(kv: KVNamespace | undefined, usd: number): Promise<void> {
  if (!kv || !usd) return;
  const now = await monthCost(kv);
  await kv.put(monthKey(), (now + usd).toFixed(4), { expirationTtl: 70 * 86400 });
}

export type Tracker = (model: string, usage: Usage | undefined) => Promise<void>;
