// Web-Push ohne Nutzdaten: Der Server "klingelt" nur, der Service Worker holt den Text von /api/push/latest.
// So braucht es keine Verschlüsselung der Nachricht – nur eine VAPID-Signatur (ES256).

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

interface StoredKeys {
  publicKey: string; // base64url, unkomprimiert (65 Bytes)
  privateJwk: JsonWebKey;
}

/** VAPID-Schlüssel: einmal erzeugt und im KV gespeichert */
export async function vapidKeys(kv: KVNamespace): Promise<StoredKeys> {
  const existing = await kv.get<StoredKeys>('push:vapid', 'json');
  if (existing) return existing;
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  const priv = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const keys = { publicKey: b64url(pub), privateJwk: priv };
  await kv.put('push:vapid', JSON.stringify(keys));
  return keys;
}

export interface PushSub {
  endpoint: string;
  plz: string;
  markets: number[];
  chains: string[];
  watch: string[];
  updatedAt: string;
}

/** Schickt einen leeren Push an ein Gerät. Gibt den HTTP-Status zurück (404/410 = Abo abgelaufen). */
export async function sendPush(kv: KVNamespace, endpoint: string): Promise<number> {
  const keys = await vapidKeys(kv);
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const aud = new URL(endpoint).origin;
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:angebotskueche@example.invalid' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${b64url(sig)}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `vapid t=${jwt}, k=${keys.publicKey}`, TTL: String(24 * 3600), Urgency: 'normal', 'Content-Length': '0' },
  });
  return res.status;
}
