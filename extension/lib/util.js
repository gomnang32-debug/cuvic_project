// 공용 유틸 — 확장 프로그램과 서버(Node)가 함께 씀
export const pad = (n) => String(n).padStart(2, '0');

// 날짜·주·시간대는 기기나 서버의 시간대와 상관없이 항상 한국 시간(UTC+9, 서머타임 없음) 기준.
// (Render 서버는 UTC, 해외에서 쓰는 노트북은 현지 시간이라 로컬 시간을 쓰면 날짜가 어긋남)
const KST = 9 * 3600 * 1000;
const DAY = 86400 * 1000;
/** 한국 시간으로 본 연·월·일·요일·시 */
function kst(t) {
  const x = new Date(new Date(t).getTime() + KST);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), wd: x.getUTCDay(), h: x.getUTCHours() };
}

export function dateKey(d = new Date()) {
  const k = kst(d);
  return `${k.y}-${pad(k.m + 1)}-${pad(k.d)}`;
}
/** 'YYYY-MM-DD' → 그날 한국 시간 0시 */
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - KST);
}
/** 한국 시간 기준 몇 시(0~23) */
export const hourOf = (t = Date.now()) => kst(t).h;
/** 한국 시간 기준 요일 (0=일 … 6=토) */
export const weekdayOf = (t = Date.now()) => kst(t).wd;
/** 그날 한국 시간 0시 (ms) */
export const kstMidnight = (t = Date.now()) => parseKey(dateKey(t)).getTime();
export function addDays(d, n) {
  return new Date(new Date(d).getTime() + n * DAY);
}
/** 한국 시간 월요일 0시 */
export function weekStart(d = new Date()) {
  const t = new Date(d).getTime();
  return new Date(kstMidnight(t) - ((weekdayOf(t) + 6) % 7) * DAY);
}
export const weekKey = (d) => dateKey(weekStart(d));

export function domainOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export function hms(sec) {
  sec = Math.max(0, Math.floor(sec));
  return { h: Math.floor(sec / 3600), m: Math.floor((sec % 3600) / 60), s: sec % 60 };
}
export function clock(sec) {
  const t = hms(sec);
  return `${pad(t.h)}:${pad(t.m)}`;
}
/** 3시간 42분 / 18분 */
export function dur(sec) {
  const t = hms(sec);
  if (t.h && t.m) return `${t.h}시간 ${t.m}분`;
  if (t.h) return `${t.h}시간`;
  return `${t.m}분`;
}
export const fmtNum = (n) => Math.round(n).toLocaleString('ko-KR');

/** FNV-1a 32bit */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/** 결정적 난수 (mulberry32) */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
