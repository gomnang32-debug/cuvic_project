// 공용 유틸 — 확장 프로그램과 서버(Node)가 함께 씀
export const pad = (n) => String(n).padStart(2, '0');

export function dateKey(d = new Date()) {
  d = new Date(d);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
/** 월요일 0시 */
export function weekStart(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
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
