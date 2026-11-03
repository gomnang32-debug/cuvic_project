// BUILD 대학교 — 측정 엔진 (MV3 service worker)
// 공부 모드가 켜져 있는 동안: 지금 보고 있는 탭을 판별해서 공부 탭에 머문 시간만 '순공'으로 더함.
import { load, save, emptyDay } from './lib/store.js';
import { classify, isAmbiguous, labelOf } from './lib/rules.js';
import { aiClassify } from './lib/ai.js';
import * as api from './lib/api.js';
import { dateKey, dur, clock } from './lib/util.js';
import { weekReport } from './lib/grade.js';
import { ranked, userScore } from './lib/sim.js';

const COMBO_SEC = 25 * 60;
const DISTRACT_COUNT_SEC = 30; // 30초 넘게 머물면 이탈 1회
const DISTRACT_ALERT_SEC = 120; // 2분 넘으면 알림
const ALERT_COOLDOWN = 10 * 60 * 1000;
const MAX_GAP = 75; // 이보다 긴 공백(절전 등)은 인정하지 않음

let ST = null;
let queue = Promise.resolve();
/** 이벤트가 겹쳐도 상태가 꼬이지 않게 직렬 실행 */
function serial(fn) {
  const p = queue.then(async () => {
    if (!ST) ST = await load();
    return fn();
  });
  queue = p.catch((e) => console.error('[BUILD]', e));
  return p;
}
const persist = () => save(ST);

function day(key = dateKey()) {
  if (!ST.days[key]) ST.days[key] = emptyDay();
  return ST.days[key];
}

function rt() {
  ST.rt ||= {};
  const r = ST.rt;
  r.pendingMap ||= {};
  r.recent ||= [];
  r.idle ||= 'active';
  if (r.focused === undefined) r.focused = true;
  return r;
}

/** 지금 상태: off | outside | away | study | pending | distract | neutral */
function stateNow() {
  const r = rt();
  if (!ST.settings.studyMode) return 'off';
  if (r.idle === 'locked') return 'away';
  if (r.idle === 'idle' && !(r.audible && r.kind === 'study')) return 'away';
  if (!r.focused) return 'outside';
  return r.kind || 'neutral';
}

function credit(sec, now) {
  const d = day(dateKey(now));
  const h = new Date(now).getHours();
  d.focusSec += sec;
  d.hours[h] += sec;
  rt().recent.push([now, sec, h, dateKey(now)]);
}

/** 마지막 갱신 이후 흐른 시간을 현재 상태에 정산 */
function advance(now = Date.now()) {
  const r = rt();
  let dt = r.lastTs ? (now - r.lastTs) / 1000 : 0;
  r.lastTs = now;
  if (r.day !== dateKey(now)) {
    r.day = dateKey(now);
    r.pendingMap = {};
    r.comboSec = 0;
  }
  if (dt <= 0) return;
  if (dt > MAX_GAP) dt = 0;
  const s = stateNow();
  const d = day(dateKey(now));
  if (s === 'study') {
    credit(dt, now);
    r.comboSec = (r.comboSec || 0) + dt;
    while (r.comboSec >= COMBO_SEC) {
      r.comboSec -= COMBO_SEC;
      d.combos += 1;
    }
  } else if (s === 'pending' && r.key) {
    r.pendingMap[r.key] = (r.pendingMap[r.key] || 0) + dt;
  } else if (s === 'distract') {
    r.distractSec = (r.distractSec || 0) + dt;
    d.distractSec += dt;
    r.comboSec = 0;
    if (!r.distractCounted && r.distractSec >= DISTRACT_COUNT_SEC) {
      d.distractions += 1;
      r.distractCounted = true;
    }
  } else if (s === 'away') {
    r.comboSec = 0;
  }
  // 오래된 기록 정리 (자리 비움 소급 차감용)
  const keep = (ST.settings.idleMin * 60 + 120) * 1000;
  r.recent = r.recent.filter((x) => now - x[0] < keep);
  checkAlerts(now, s);
}

function checkAlerts(now, s) {
  const r = rt();
  const d = day();
  const n = ST.settings.notify;
  if (s === 'distract' && n.distract && r.distractSec >= DISTRACT_ALERT_SEC && now - (r.lastDistractAlert || 0) > ALERT_COOLDOWN) {
    r.lastDistractAlert = now;
    const min = Math.floor(r.distractSec / 60);
    notify('distract', `공부 탭에서 ${min}분째 벗어나 있어요`, `${labelOf(r.domain)} 탭을 보고 있어요. 돌아갈까요?`, [
      { title: '공부 탭으로 돌아가기' },
      { title: '이것도 공부예요' },
    ]);
  }
  const goalSec = ST.settings.goalMin * 60;
  if (n.goal && !d.goalNotified && d.focusSec >= goalSec) {
    d.goalNotified = true;
    const w = weekReport(ST.days);
    notify('goal', `오늘 목표 ${dur(goalSec)}을 채웠어요`, `순공 ${dur(d.focusSec)}. 이번 주 예상 학점은 ${w.grade}예요.`, [{ title: '오늘 기록 보기' }]);
  }
}

function notify(id, title, message, buttons = []) {
  chrome.notifications.create(id + ':' + Date.now(), {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    buttons,
    priority: 2,
    requireInteraction: id === 'distract',
  });
}

/** 활성 탭 다시 읽고 판별 */
async function refreshTab() {
  const r = rt();
  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch {}
  const url = tab?.url || '';
  const title = tab?.title || '';
  const c = classify(url, title, ST);
  const changedKey = c.key !== r.key;
  const changedDomain = c.domain !== r.domain;
  Object.assign(r, {
    tabId: tab?.id ?? null,
    windowId: tab?.windowId ?? null,
    url,
    title,
    favicon: tab?.favIconUrl || '',
    audible: !!tab?.audible,
    domain: c.domain,
    label: c.label,
    key: c.key,
    kind: c.kind,
    source: c.source,
  });
  if (changedDomain || c.kind !== 'distract') {
    r.distractSec = 0;
    r.distractCounted = false;
  }
  if (c.kind === 'study' && tab) r.lastStudyTabId = tab.id;
  if (c.needsAI && changedKey) runAI(c.key, c.domain, title);
  updateBadge();
}

async function runAI(key, domain, title) {
  try {
    const v = await aiClassify({ apiKey: ST.settings.aiKey, model: ST.settings.aiModel, domain, title });
    await serial(async () => resolvePending(key, v, 'AI 판별'));
  } catch (e) {
    console.warn('[BUILD] AI 판별 실패', e);
  }
}

/** 판별 대기였던 탭의 결과가 나오면: 공부면 대기 시간을 소급해서 더함 */
function resolvePending(key, v, by) {
  advance();
  const r = rt();
  ST.aiCache[key] = { v, by, ts: Date.now() };
  const waited = r.pendingMap[key] || 0;
  delete r.pendingMap[key];
  if (v === 'study' && waited > 0) credit(waited, Date.now());
  if (r.key === key) {
    r.kind = v;
    r.source = by;
    if (v === 'study') r.lastStudyTabId = r.tabId;
  }
  updateBadge();
  return persist();
}

function updateBadge() {
  const s = stateNow();
  const d = ST.days[dateKey()];
  const sec = d ? d.focusSec : 0;
  const color = { study: '#1D4ED8', pending: '#475569', distract: '#C2410C', away: '#5B6270', outside: '#5B6270', neutral: '#5B6270' }[s] || '#5B6270';
  chrome.action.setBadgeText({ text: s === 'off' ? '' : clock(sec).replace(/^0/, '') });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' });
  chrome.action.setTitle({ title: s === 'off' ? 'BUILD 대학교 · 공부 모드 꺼짐' : `BUILD 대학교 · 오늘 순공 ${dur(sec)}` });
}

// ---------- 랭킹 동기화 ----------
async function sync() {
  if (!ST.profile) return;
  const studying = stateNow() === 'study';
  if (ST.settings.ranking) await api.heartbeat(ST, studying);
  const lg = await api.getLeague(ST, studying);
  const prev = ST.league;
  ST.league = lg;
  // 서버에서 학교가 승인·합쳐졌으면 반영
  if (lg.me && ST.profile && (lg.me.schoolStatus !== ST.profile.schoolStatus || lg.me.school !== ST.profile.school)) {
    ST.profile = { ...ST.profile, school: lg.me.school, schoolStatus: lg.me.schoolStatus };
  }
  const me = ranked(lg.schools).find((s) => s.me);
  if (me) {
    const d = day();
    if (d.firstRank == null) d.firstRank = me.rank;
    const prevRank = prev && prev.date === lg.date ? ranked(prev.schools).find((s) => s.me)?.rank : null;
    if (prevRank && me.rank < prevRank && ST.settings.notify.rank && ST.settings.studyMode) {
      const avgRank = ranked(lg.schools, 'avg').find((s) => s.me)?.rank;
      notify('rank', `${me.name}가 오늘 ${me.rank}위로 올라섰어요`, `${prevRank}위에서 ${prevRank - me.rank}계단 올랐어요. 1인 평균으로는 ${avgRank}위예요.`, [{ title: '대항전 보기' }]);
    }
  }
}

// ---------- 이벤트 ----------
function setup() {
  chrome.alarms.create('tick', { periodInMinutes: 0.5 });
  chrome.alarms.create('sync', { periodInMinutes: 1 });
  return serial(async () => {
    chrome.idle.setDetectionInterval(Math.max(15, ST.settings.idleMin * 60));
    rt().lastTs = Date.now();
    await refreshTab();
    await persist();
    await registerBridge();
  });
}

// ---------- 사이트 연결 ----------
const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };
const isLocal = (o) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o || '');
/** 배포된 사이트 주소면 그 주소에서도 연결 스크립트가 돌게 등록 (localhost는 manifest에 이미 있음) */
async function registerBridge() {
  try {
    const old = await chrome.scripting.getRegisteredContentScripts({ ids: ['site-bridge'] });
    if (old.length) await chrome.scripting.unregisterContentScripts({ ids: ['site-bridge'] });
    const o = originOf(ST.settings.serverUrl);
    if (!o || isLocal(o)) return;
    if (!(await chrome.permissions.contains({ origins: [o + '/*'] }))) return;
    await chrome.scripting.registerContentScripts([{ id: 'site-bridge', matches: [o + '/*'], js: ['site-bridge.js'], runAt: 'document_start' }]);
  } catch (e) {
    console.warn('[BUILD] 사이트 연결 스크립트 등록 실패', e);
  }
}
async function siteReachable() {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(ST.settings.serverUrl.replace(/\/$/, '') + '/api/health', { signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  }
}
/** 사이트 계정을 확장 프로그램 계정으로 씀 */
function adopt(account, origin) {
  ST.profile = { school: account.school, dept: account.dept || '', nickname: account.nickname, userId: account.userId, token: account.token, schoolStatus: account.schoolStatus, online: true };
  if (origin) ST.settings.serverUrl = origin;
  if (account.ranking === false) ST.settings.ranking = false;
}

chrome.runtime.onInstalled.addListener(async (info) => {
  await setup();
  if (info.reason !== 'install') return;
  // 사이트가 열려 있으면 사이트에서 가입·연결, 아니면 확장 프로그램 자체 첫 실행 화면
  const url = (await serial(siteReachable)) ? ST.settings.serverUrl : chrome.runtime.getURL('onboarding.html');
  chrome.tabs.create({ url });
});
chrome.runtime.onStartup.addListener(setup);

chrome.alarms.onAlarm.addListener((a) =>
  serial(async () => {
    advance();
    if (a.name === 'tick') await refreshTab();
    if (a.name === 'sync') await sync();
    updateBadge();
    await persist();
  }),
);

const onTabEvent = () => serial(async () => { advance(); await refreshTab(); await persist(); });
chrome.tabs.onActivated.addListener(onTabEvent);
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  if (!tab.active) return;
  if (info.url || info.title || info.status === 'complete' || 'audible' in info) onTabEvent();
});
chrome.windows.onFocusChanged.addListener((wid) =>
  serial(async () => {
    advance();
    rt().focused = wid !== chrome.windows.WINDOW_ID_NONE;
    if (rt().focused) await refreshTab();
    updateBadge();
    await persist();
  }),
);

chrome.idle.onStateChanged.addListener((state) =>
  serial(async () => {
    const now = Date.now();
    advance(now);
    const r = rt();
    if (state !== 'active') {
      const keepMedia = state === 'idle' && r.audible && r.kind === 'study';
      if (!keepMedia) {
        // 마지막 입력 시각 이후 더한 시간을 되돌림
        const cutoff = now - ST.settings.idleMin * 60 * 1000;
        let back = 0;
        for (const [t, sec, h, k] of r.recent) {
          const part = Math.min(sec, Math.max(0, (t - cutoff) / 1000));
          if (part > 0 && ST.days[k]) {
            ST.days[k].focusSec = Math.max(0, ST.days[k].focusSec - part);
            ST.days[k].hours[h] = Math.max(0, ST.days[k].hours[h] - part);
            back += part;
          }
        }
        r.recent = [];
        r.lastInputAt = cutoff;
        r.comboSec = 0;
        r.awayDeducted = back;
      }
    } else {
      r.lastInputAt = null;
    }
    r.idle = state;
    updateBadge();
    await persist();
  }),
);

chrome.notifications.onButtonClicked.addListener((nid, idx) =>
  serial(async () => {
    const kind = nid.split(':')[0];
    chrome.notifications.clear(nid);
    if (kind === 'distract') {
      if (idx === 0) await goBack();
      else await correct('study');
    } else if (kind === 'goal') {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#me') });
    } else if (kind === 'rank') {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#battle') });
    }
  }),
);
chrome.notifications.onClicked.addListener((nid) => {
  chrome.notifications.clear(nid);
  const kind = nid.split(':')[0];
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#' + (kind === 'rank' ? 'battle' : 'me')) });
});

async function goBack() {
  const id = rt().lastStudyTabId;
  if (id == null) return;
  try {
    const tab = await chrome.tabs.update(id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch {}
}

/** 정정: 지금 탭을 공부/딴짓으로 기억 */
async function correct(as) {
  advance();
  const r = rt();
  if (!r.domain) return;
  const k = isAmbiguous(r.domain) ? r.key : r.domain;
  ST.overrides[k] = as;
  const c = (ST.corrections[r.domain] ||= { study: 0, distract: 0 });
  c[as] += 1;
  if (as === 'study' && r.pendingMap[r.key]) {
    credit(r.pendingMap[r.key], Date.now());
    delete r.pendingMap[r.key];
  }
  r.prevKind = r.kind;
  r.prevSource = r.source;
  r.kind = as;
  r.source = '정정 기억';
  if (as === 'study') {
    r.lastStudyTabId = r.tabId;
    r.distractSec = 0;
    r.distractCounted = false;
  }
  updateBadge();
  await persist();
}

async function undoCorrect() {
  advance();
  const r = rt();
  if (!r.domain) return;
  const as = ST.overrides[r.key] || ST.overrides[r.domain];
  delete ST.overrides[r.key];
  delete ST.overrides[r.domain];
  if (as && ST.corrections[r.domain]) ST.corrections[r.domain][as] = Math.max(0, ST.corrections[r.domain][as] - 1);
  await refreshTab();
  await persist();
}

function snapshot() {
  const r = rt();
  const today = day();
  const w = weekReport(ST.days);
  const lg = ST.league;
  let school = null;
  if (lg && ST.profile) {
    const tot = ranked(lg.schools).find((s) => s.me);
    const avg = ranked(lg.schools, 'avg').find((s) => s.me);
    if (tot) school = { name: tot.name, rank: tot.rank, avgRank: avg?.rank, delta: today.firstRank ? today.firstRank - tot.rank : 0, online: lg.online };
    else if (ST.profile.schoolStatus && ST.profile.schoolStatus !== 'ok') school = { name: ST.profile.school, pending: true, rejected: ST.profile.schoolStatus === 'rejected' };
  }
  return {
    state: stateNow(),
    settings: ST.settings,
    profile: ST.profile,
    tab: { title: r.title, domain: r.domain, label: r.label, kind: r.kind, source: r.source, favicon: r.favicon, audible: r.audible },
    distractSec: r.distractSec || 0,
    pendingSec: (r.key && r.pendingMap[r.key]) || 0,
    lastInputAt: r.lastInputAt || null,
    comboSec: r.comboSec || 0,
    today: { focusSec: today.focusSec, distractions: today.distractions, combos: today.combos, score: userScore(today.focusSec, today.combos) },
    week: { grade: w.grade, total: w.total, hours: w.hours, projectedHours: w.projectedHours },
    school,
    canGoBack: r.lastStudyTabId != null && r.lastStudyTabId !== r.tabId,
    siteUrl: ST.profile?.token && ST.league?.online ? ST.settings.serverUrl : null,
  };
}

// ---------- 화면(팝업·설정·대시보드)과 통신 ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  serial(async () => {
    switch (msg.type) {
      case 'status':
        advance();
        if (msg.refresh) await refreshTab();
        await persist();
        return snapshot();
      case 'toggle': {
        advance();
        ST.settings.studyMode = msg.on ?? !ST.settings.studyMode;
        rt().lastTs = Date.now();
        rt().comboSec = 0;
        await refreshTab();
        await persist();
        sync().then(persist);
        return snapshot();
      }
      case 'correct':
        await correct(msg.as);
        return snapshot();
      case 'undo':
        await undoCorrect();
        return snapshot();
      case 'goBack':
        await goBack();
        return snapshot();
      case 'state': // 화면이 전체 상태를 읽을 때
        advance();
        await persist();
        return ST;
      case 'set': // 화면에서 바꾼 값 반영 (settings, lists, profile, days 등 최상위 키 단위)
        advance();
        Object.assign(ST, msg.data);
        chrome.idle.setDetectionInterval(Math.max(15, ST.settings.idleMin * 60));
        await refreshTab();
        await persist();
        if (msg.sync) await sync().then(persist);
        await registerBridge();
        return ST;
      case 'reload': // 초기화 등으로 storage를 통째로 바꾼 뒤
        ST = await load();
        chrome.idle.setDetectionInterval(Math.max(15, ST.settings.idleMin * 60));
        await refreshTab();
        await persist();
        return true;
      case 'siteHello': {
        // 사이트가 열릴 때마다: 계정이 없는 쪽에 있는 쪽 계정을 넘겨줌
        const a = msg.account;
        const p = ST.profile;
        if (a?.token && (!p || !p.token)) {
          adopt(a, msg.origin);
          await persist();
          sync().then(persist);
          return { linked: true };
        }
        if (a?.token && p?.userId === a.userId) {
          if (originOf(ST.settings.serverUrl) !== msg.origin) { ST.settings.serverUrl = msg.origin; await persist(); }
          return { linked: false };
        }
        if (!a && p?.token && originOf(ST.settings.serverUrl) === msg.origin) return { account: { ...p, ranking: ST.settings.ranking } };
        return {};
      }
      case 'siteLink': // 사이트에서 '이 계정으로 연결' 누름
        if (!msg.account?.token) return {};
        adopt(msg.account, msg.origin);
        await persist();
        sync().then(persist);
        return { linked: true };
      case 'syncNow':
        advance();
        await sync();
        await persist();
        return ST.league;
      default:
        return null;
    }
  }).then(reply, (e) => reply({ error: String(e) }));
  return true;
});
