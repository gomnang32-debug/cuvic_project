// 랭킹 서버 통신. 서버가 꺼져 있으면 같은 리그 계산(sim.js)을 브라우저 안에서 돌려 오프라인으로 보여줌.
import { buildLeague, userScore } from './sim.js';
import { dateKey } from './util.js';
import { resolveSchool } from './schools.js';

/** 서버 없이 판단: 목록에 있는 학교면 ok, 아니면 등록 대기 */
const localStatus = (p) => (resolveSchool(p.school) || p.schoolStatus === 'ok' ? 'ok' : 'pending');

async function call(base, path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3500);
  try {
    const res = await fetch(base.replace(/\/$/, '') + path, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
    });
    if (!res.ok) throw new Error(path + ' ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function register(st, profile) {
  try {
    const r = await call(st.settings.serverUrl, '/api/register', { method: 'POST', body: JSON.stringify(profile) });
    return { ...profile, school: r.school || profile.school, schoolStatus: r.schoolStatus || localStatus(profile), userId: r.userId, token: r.token, online: true };
  } catch {
    const school = resolveSchool(profile.school) || profile.school;
    return { ...profile, school, schoolStatus: localStatus({ school }), userId: 'local-' + crypto.randomUUID(), token: null, online: false };
  }
}

/** 소속 변경. 바뀐 학교 이름(공식 이름)과 상태를 돌려줌 */
export async function updateProfile(st, p) {
  const school = resolveSchool(p.school) || p.school;
  const local = { ...p, school, schoolStatus: localStatus({ school }) };
  if (!p?.token) return local;
  try {
    const r = await call(st.settings.serverUrl, '/api/profile', { method: 'POST', body: JSON.stringify(p) });
    return { ...p, school: r.school || school, schoolStatus: r.schoolStatus || local.schoolStatus };
  } catch {
    return local;
  }
}

export async function deleteAccount(st) {
  const p = st.profile;
  if (!p?.token) return;
  try {
    await call(st.settings.serverUrl, '/api/delete', { method: 'POST', body: JSON.stringify({ userId: p.userId, token: p.token }) });
  } catch {}
}

/** 오늘 기록을 서버로 보냄. 보내는 것: 순공 합계·콤보·이탈 횟수·지금 공부 중인지 */
export async function heartbeat(st, studying) {
  const p = st.profile;
  if (!p) return false;
  if (!p.token) {
    // 오프라인 가입 상태면 서버에 다시 가입 시도
    try {
      const r = await call(st.settings.serverUrl, '/api/register', { method: 'POST', body: JSON.stringify(p) });
      p.userId = r.userId;
      p.token = r.token;
    } catch {
      return false;
    }
  }
  const date = dateKey();
  const d = st.days[date] || { focusSec: 0, combos: 0, distractions: 0 };
  try {
    await call(st.settings.serverUrl, '/api/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ userId: p.userId, token: p.token, date, focusSec: Math.floor(d.focusSec), combos: d.combos, distractions: d.distractions, studying, hours: (d.hours || []).map(Math.round), via: 'ext' }),
    });
    return true;
  } catch {
    return false;
  }
}

export async function getLeague(st, studying = false) {
  const p = st.profile || {};
  const date = dateKey();
  const q = new URLSearchParams({ date, school: p.school || '', dept: p.dept || '', userId: p.userId || '' });
  try {
    const data = await call(st.settings.serverUrl, '/api/league?' + q);
    return { ...data, online: true, fetchedAt: Date.now() };
  } catch {
    const d = st.days[date] || { focusSec: 0, combos: 0 };
    const status = p.school ? localStatus(p) : null;
    const me = p.school && st.settings.ranking && status === 'ok'
      ? [{ id: p.userId, school: p.school, dept: p.dept, nickname: p.nickname, score: userScore(d.focusSec, d.combos), focusSec: d.focusSec, studying }]
      : [];
    const lg = buildLeague({ date, now: Date.now(), demo: st.settings.demoLeague, real: me, school: status === 'ok' ? p.school : undefined, dept: p.dept, userId: p.userId });
    return { ...lg, me: p.school ? { school: p.school, schoolStatus: status } : null, online: false, fetchedAt: Date.now() };
  }
}
