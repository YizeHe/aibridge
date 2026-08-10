/**
 * Icon-order captcha inspired by @yunstorage/icon-captcha
 * (simplified inline set for Workers; HMAC-signed token)
 */
import { hmacSign, hmacVerify, randomHex } from './crypto';

const ICONS: { id: string; label: string; emoji: string }[] = [
  { id: 'star', label: 'star', emoji: 'star' },
  { id: 'heart', label: 'heart', emoji: 'heart' },
  { id: 'bolt', label: 'bolt', emoji: 'bolt' },
  { id: 'cloud', label: 'cloud', emoji: 'cloud' },
  { id: 'moon', label: 'moon', emoji: 'moon' },
  { id: 'sun', label: 'sun', emoji: 'sun' },
  { id: 'leaf', label: 'leaf', emoji: 'leaf' },
  { id: 'fire', label: 'fire', emoji: 'fire' },
  { id: 'key', label: 'key', emoji: 'key' },
  { id: 'bell', label: 'bell', emoji: 'bell' },
  { id: 'book', label: 'book', emoji: 'book' },
  { id: 'flag', label: 'flag', emoji: 'flag' },
];

// Use geometric labels (no emoji per product UI preference) — SVG shapes by id
const SHAPE: Record<string, string> = {
  star: 'M12 2l2.4 7.2H22l-6 4.8 2.3 7.2L12 16.8 5.7 21.2 8 14 2 9.2h7.6z',
  heart: 'M12 21s-7-4.6-9.5-8.5C.5 9 2.5 5 6.5 5c2 0 3.5 1.2 4.5 2.5C12 6.2 13.5 5 15.5 5 19.5 5 21.5 9 21.5 12.5 19 16.4 12 21 12 21z',
  bolt: 'M13 2L4 14h7l-1 8 10-14h-7l0-6z',
  cloud: 'M6 18h12a4 4 0 0 0 .3-8A6 6 0 0 0 6.5 8 4.5 4.5 0 0 0 6 18z',
  moon: 'M18 14.5A7.5 7.5 0 0 1 9.5 6 7.5 7.5 0 1 0 18 14.5z',
  sun: 'M12 4V2m0 20v-2M4 12H2m20 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  leaf: 'M5 19c8 0 14-6 14-14-8 0-14 6-14 14zm0 0c3-3 6-5 9-6',
  fire: 'M12 2s4 4 4 8a4 4 0 1 1-8 0c0-2 1-4 2-5 0 2 1 3 2 3s2-1 2-3c1 1 2 3 2 5',
  key: 'M14 10a4 4 0 1 0-4 4h10v3h-2v-3h-2v3h-2v-3H14z',
  bell: 'M6 16v-5a6 6 0 1 1 12 0v5l2 2H4l2-2zm4 4h4',
  book: 'M4 5h7v14H4zM13 5h7v14h-7z',
  flag: 'M5 3v18M5 4h12l-2 4 2 4H5',
};

function pick<T>(arr: T[], n: number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}

export async function createChallenge(secret: string) {
  const targets = pick(ICONS, 3);
  const decoys = pick(
    ICONS.filter((i) => !targets.find((t) => t.id === i.id)),
    2
  );
  const items = pick([...targets, ...decoys], 5).map((icon, idx) => ({
    slotId: `s${idx}_${randomHex(3)}`,
    iconId: icon.id,
    label: icon.label,
    path: SHAPE[icon.id] || SHAPE.star,
    x: 10 + Math.random() * 70,
    y: 15 + Math.random() * 55,
  }));

  // answer = slotIds of targets in order of targets array
  const answer = targets.map((t) => items.find((it) => it.iconId === t.id)!.slotId);
  const exp = Math.floor(Date.now() / 1000) + 300;
  const payload = JSON.stringify({ a: answer, exp, n: randomHex(4) });
  const sig = await hmacSign(secret, payload);
  const token = btoa(payload) + '.' + sig;

  const promptLabels = targets.map((t) => t.label).join(' then ');
  return {
    token,
    prompt: `Click icons in order: ${promptLabels}`,
    items: items.map(({ slotId, path, x, y, label }) => ({ slotId, path, x, y, label })),
    expiresAt: exp,
  };
}

export async function verifyChallenge(
  secret: string,
  token: string,
  slots: string[]
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return { ok: false, reason: 'bad_token' };
  let payload: string;
  try {
    payload = atob(b64);
  } catch {
    return { ok: false, reason: 'bad_token' };
  }
  if (!(await hmacVerify(secret, payload, sig))) return { ok: false, reason: 'bad_token' };
  let data: { a: string[]; exp: number };
  try {
    data = JSON.parse(payload);
  } catch {
    return { ok: false, reason: 'bad_token' };
  }
  if (data.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' };
  if (!Array.isArray(slots) || slots.length !== data.a.length) {
    return { ok: false, reason: 'incomplete' };
  }
  for (let i = 0; i < data.a.length; i++) {
    if (slots[i] !== data.a[i]) return { ok: false, reason: 'wrong' };
  }
  return { ok: true };
}
