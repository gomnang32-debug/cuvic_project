// BUILD 대학교 사이트 — 공부 타이머 · 내 기록 · 대항전 · 캠퍼스 · 설정
// 확장 프로그램 없이도 동작: 이 탭을 보고 있는 동안만 순공으로 잼.
// 확장 프로그램이 있으면 같은 계정으로 자동 연결되고, 다른 탭의 공부도 자동 판별해서 잼.
import { createDash, VIEW_TITLES } from '/lib/dash-core.js';
import { resolveSchool, searchSchools, ALL_SCHOOLS } from '/lib/schools.js';
import { DEPTS, ranked, userScore } from '/lib/sim.js';
import { dateKey, pad, hms, dur, fmtNum, hourOf } from '/lib/util.js';
import { weekReport, defaultSemesterStart, TARGET_HOURS } from '/lib/grade.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const K = { account: 'build-account', settings: 'build-web-settings', days: 'build-web-days', timer: 'build-timer' };
const COMBO = 1500;
const AWAY_COUNT = 30; // 30초 넘게 비우면 이탈 1회
const emptyDay = () => ({ focusSec: 0, hours: new Array(24).fill(0), distractions: 0, combos: 0 });

let account = LS.get(K.account, null);
let settings = { goalMin: 240, checkMin: 25, semesterStart: defaultSemesterStart(), ...LS.get(K.settings, {}) };
let localDays = LS.get(K.days, {});
let serverDays = {};
let LG = null;
let ext = { present: false, status: null, at: 0 };
let timer = { running: false, comboSec: 0, ...LS.get(K.timer, {}), lastTs: Date.now(), lastInput: Date.now(), awaySince: null, checking: false };

// ---------- 공통 ----------
function toast(t, ms = 2400) {
  const el = $('#toast');
  el.textContent = t;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), { status: r.status });
  return j;
}
function modal(html) {
  const m = $('#modal');
  if (!html) { m.hidden = true; m.innerHTML = ''; return null; }
  m.innerHTML = `<div class="card">${html}</div>`;
  m.hidden = false;
  return m;
}
function saveAccount(a) { account = a; a ? LS.set(K.account, a) : LS.del(K.account); postExt('hello', { account }); }
function saveSettings() { LS.set(K.settings, settings); }
const saveDays = () => LS.set(K.days, localDays);
const saveTimer = () => LS.set(K.timer, { running: timer.running, comboSec: timer.comboSec });

// ---------- 확장 프로그램 연결 ----------
function postExt(type, data = {}) { window.postMessage({ source: 'build-site', type, ...data }, location.origin); }
const extLinked = () => ext.present && ext.status?.profile?.userId === account?.userId && Date.now() - ext.at < 8000;
window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.source !== 'build-ext') return;
  const m = e.data;
  if (m.type === 'status') {
    const was = extLinked();
    ext = { present: true, status: m.data, at: Date.now() };
    // 확장 프로그램이 재기 시작하면 웹 타이머는 내려놓음 (두 곳에서 같이 재지 않게)
    if (extLinked() && timer.running) {
      sendBeat(false); // 지금까지 웹에서 잰 기록을 서버에 남겨야 확장 프로그램이 그 값부터 이어서 잼
      timer.running = false; timer.awaySince = null; saveTimer();
      if (m.data.state === 'off') postExt('toggle', { on: true }); // 웹에서 켜 둔 공부를 확장 프로그램이 이어받음
    }
    if (was !== extLinked()) render();
  } else if (m.type === 'account' && m.account && !account) {
    saveAccount(m.account);
    toast('확장 프로그램 계정으로 연결했어요');
    boot();
  } else if (m.type === 'linked') {
    toast('확장 프로그램과 연결됐어요. 이제 다른 탭의 공부도 자동으로 재요');
  }
});

// ---------- 기록 ----------
function today() {
  const k = dateKey();
  return (localDays[k] ||= emptyDay());
}
function allDays() {
  const out = {};
  for (const src of [serverDays, localDays]) {
    for (const [k, d] of Object.entries(src)) if (!out[k] || d.focusSec > out[k].focusSec) out[k] = d;
  }
  if (extLinked()) {
    const k = dateKey();
    const t = ext.status.today;
    const base = out[k] || emptyDay();
    if (t.focusSec >= base.focusSec) out[k] = { ...base, focusSec: t.focusSec, combos: t.combos, distractions: t.distractions };
  }
  return out;
}
const isActive = () => document.visibilityState === 'visible' && document.hasFocus();
function stateNow() {
  if (extLinked()) return ext.status.state;
  if (!timer.running) return 'off';
  if (timer.checking) return 'away';
  return isActive() ? 'study' : 'outside';
}
function comboNow() { return extLinked() ? ext.status.comboSec || 0 : timer.comboSec; }

function credit(dt, now) {
  const d = today();
  const h = hourOf(now);
  d.focusSec += dt;
  d.hours[h] += dt;
  timer.comboSec += dt;
  if (timer.comboSec >= COMBO) {
    timer.comboSec -= COMBO;
    d.combos += 1;
    toast('25분 집중 콤보! 우리 학교 점수 +5');
  }
  if (!d.goalShown && d.focusSec >= settings.goalMin * 60) {
    d.goalShown = true;
    toast(`오늘 목표 ${dur(settings.goalMin * 60)} 달성!`, 4000);
  }
}
function leaveTab(now = Date.now()) {
  if (timer.running && !timer.awaySince && !extLinked()) timer.awaySince = now;
}
function backToTab(now = Date.now()) {
  if (!timer.awaySince) return;
  const away = (now - timer.awaySince) / 1000;
  timer.awaySince = null;
  if (away >= AWAY_COUNT) {
    today().distractions += 1;
    timer.comboSec = 0;
    toast(`${dur(away) === '0분' ? Math.round(away) + '초' : dur(away)} 동안 이 탭을 벗어났어요 · 그 시간은 빠졌어요`, 3500);
  }
  timer.lastInput = now;
}

function loop() {
  const now = Date.now();
  if (timer.running && !extLinked()) {
    const dt = Math.min(5, Math.max(0, (now - timer.lastTs) / 1000));
    if (!timer.checking && (now - timer.lastInput) / 60000 >= settings.checkMin) openCheck();
    if (isActive() && !timer.checking) {
      if (timer.awaySince) backToTab(now);
      else credit(dt, now);
    } else leaveTab(now);
  }
  timer.lastTs = now;
  if (view === 'study') updateStudy();
  else if (dash) dash.tick();
}

// 자리 확인: 입력이 오래 없으면 물어봄 (책으로 공부 중이면 '계속')
function openCheck() {
  timer.checking = true;
  const m = modal(`<h2>아직 공부 중인가요?</h2><p>${settings.checkMin}분 동안 이 화면에 입력이 없었어요.<br>책이나 노트로 공부 중이었다면 계속을 눌러 주세요. 답이 없으면 5분 뒤 멈춰요.</p><button class="btn go" id="chkYes">계속 공부하기</button><button class="btn line" id="chkNo">여기서 멈추기</button>`);
  const close = (keep) => {
    clearTimeout(openCheck.t);
    timer.checking = false;
    timer.lastInput = Date.now();
    timer.lastTs = Date.now();
    modal(null);
    if (!keep) stop();
    render();
  };
  $('#chkYes', m).onclick = () => close(true);
  $('#chkNo', m).onclick = () => close(false);
  openCheck.t = setTimeout(() => close(false), 5 * 60 * 1000);
}

const markInput = () => { timer.lastInput = Date.now(); };
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, markInput, { passive: true }));
let lastMove = 0;
window.addEventListener('pointermove', () => { const n = Date.now(); if (n - lastMove > 2000) { lastMove = n; markInput(); } }, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { leaveTab(); heartbeat(); saveDays(); }
  else { backToTab(); heartbeat(); }
});
window.addEventListener('blur', () => leaveTab());
window.addEventListener('focus', () => backToTab());
window.addEventListener('pagehide', () => {
  saveDays();
  saveTimer();
  if (account && !extLinked()) navigator.sendBeacon?.('/api/heartbeat', JSON.stringify(hbBody(false)));
});

/** 서버에 있는 오늘 기록이 더 크면 그 값부터 이어서 잼 (확장 프로그램·다른 기기에서 잰 시간이 사라지지 않게) */
function baseline() {
  const s = serverDays[dateKey()];
  if (!s) return;
  const d = today();
  if ((s.focusSec || 0) > d.focusSec) {
    d.focusSec = s.focusSec;
    if (Array.isArray(s.hours) && s.hours.length === 24) {
      let hrs = d.hours.map((x, i) => Math.max(x, Number(s.hours[i]) || 0));
      const sum = hrs.reduce((a, x) => a + x, 0);
      if (sum > d.focusSec) hrs = hrs.map((x) => (x * d.focusSec) / sum);
      d.hours = hrs;
    }
  }
  d.combos = Math.max(d.combos, s.combos || 0);
  d.distractions = Math.max(d.distractions, s.distractions || 0);
  saveDays();
}

function start() {
  if (extLinked()) return postExt('toggle', { on: true });
  baseline();
  loadMe().then(() => { if (timer.running) baseline(); });
  timer.running = true;
  timer.lastTs = Date.now();
  timer.lastInput = Date.now();
  timer.awaySince = null;
  saveTimer();
  heartbeat();
  render();
}
function stop() {
  if (extLinked()) return postExt('toggle', { on: false });
  timer.running = false;
  timer.awaySince = null;
  saveTimer();
  saveDays();
  heartbeat();
  render();
}

// ---------- 서버 ----------
function hbBody(studying) {
  const d = today();
  return { userId: account.userId, token: account.token, date: dateKey(), focusSec: Math.floor(d.focusSec), combos: d.combos, distractions: d.distractions, hours: d.hours.map(Math.round), studying, via: 'web' };
}
async function sendBeat(studying) {
  if (!account) return;
  try { await api('/api/heartbeat', hbBody(studying)); } catch (e) { if (e.status === 401) logout(true); }
}
function heartbeat() {
  if (!account || extLinked()) return;
  return sendBeat(timer.running && isActive() && !timer.checking);
}
async function loadMe() {
  if (!account) return;
  try {
    const r = await api('/api/me', { userId: account.userId, token: account.token });
    serverDays = r.days || {};
    const p = r.profile;
    if (p.school !== account.school || p.schoolStatus !== account.schoolStatus || p.dept !== account.dept || p.nickname !== account.nickname || p.ranking !== account.ranking) {
      saveAccount({ ...account, ...p });
    }
  } catch (e) {
    if (e.status === 401) logout(true);
  }
}
async function loadLeague() {
  if (!account) return;
  const q = new URLSearchParams({ date: dateKey(), userId: account.userId });
  try {
    const j = await api('/api/league?' + q);
    LG = { ...j, online: true, fetchedAt: Date.now() };
    if (j.me && (j.me.schoolStatus !== account.schoolStatus || j.me.school !== account.school)) saveAccount({ ...account, school: j.me.school, schoolStatus: j.me.schoolStatus });
  } catch {}
}
function logout(expired) {
  saveAccount(null);
  serverDays = {};
  LG = null;
  if (expired) toast('계정 정보가 없어서 처음 화면으로 돌아왔어요');
  boot();
}
const loginCode = () => btoa(unescape(encodeURIComponent(JSON.stringify({ u: account.userId, t: account.token })))).replace(/=+$/, '');

// ---------- 화면 ----------
let view = 'study';
let dash = null;
function header() {
  const top = $('#top');
  top.hidden = !account;
  if (!account) return;
  $('#who').innerHTML = `<span class="av">${esc(account.nickname[0])}</span><b>${esc(account.nickname)}</b><span class="muted">· ${esc(account.school)}${account.dept ? ' ' + esc(account.dept) : ''}</span>`;
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === view));
  document.title = ({ study: '공부하기', settings: '설정', ...VIEW_TITLES })[view] + ' · BUILD 대학교';
}
function dashData() {
  return {
    ST: { profile: account, settings: { goalMin: settings.goalMin, semesterStart: settings.semesterStart, ranking: account.ranking !== false }, days: allDays() },
    S: { state: stateNow(), comboSec: comboNow() },
    LG,
  };
}

function render() {
  header();
  if (!account) return viewJoin();
  if (view === 'study') return viewStudy();
  if (view === 'settings') return viewSettings();
  dash.setData(dashData());
  dash.render(view);
}

const BANDS = {
  study: ['공부 중', 'var(--blue)', 'var(--blue-soft)'],
  pending: ['판별 대기', 'var(--slate)', 'var(--soft)'],
  distract: ['딴짓 중 · 시간 멈춤', 'var(--orange)', 'var(--orange-soft)'],
  away: ['자리 확인 중', 'var(--muted)', 'var(--band-away)'],
  outside: ['탭을 벗어남 · 시간 멈춤', 'var(--orange)', 'var(--orange-soft)'],
  neutral: ['측정 멈춤', 'var(--muted)', 'var(--band-gray)'],
  off: ['대기 중', 'var(--muted)', 'var(--card)'],
};

function viewStudy() {
  const now = new Date();
  $('#view').innerHTML = `
  <div class="h1row"><div><div class="sub">${now.getMonth() + 1}월 ${now.getDate()}일 · ${esc(account.school)}</div><div class="h1">오늘의 공부</div></div><div class="sub" id="modeNote"></div></div>
  <div class="study">
    <div class="card timer-card" id="tcard">
      <div class="chip-state" id="chip"></div>
      <div class="lbl">오늘 순공 시간</div>
      <div class="big-timer" id="bigT">00:00<small>:00</small></div>
      <div class="prog"><div class="t"><span>하루 목표 ${dur(settings.goalMin * 60)}</span><span id="goalTxt"></span></div><div class="b"><i id="goalBar"></i></div></div>
      <div class="prog combo"><div class="t"><span>25분 집중 콤보 · 학교 점수 +5</span><span id="comboTxt"></span></div><div class="b"><i id="comboBar"></i></div></div>
      <div id="extTab"></div>
      <div class="go-row"><button class="btn go" id="go"></button></div>
      <div class="how" id="how"></div>
    </div>
    <div class="side-col">
      <a class="panel mini-rank" href="#battle" style="text-decoration:none;color:inherit" id="rankCard"></a>
      <a class="panel" href="#me" style="text-decoration:none;color:inherit" id="gradeCard"></a>
      <div class="panel ext-card" id="extCard"></div>
    </div>
  </div>`;
  $('#go').onclick = () => (stateNow() === 'off' ? start() : stop());
  updateStudy(true);
}

let lastSig = '';
function updateStudy(force) {
  if (!$('#bigT')) return;
  const linked = extLinked();
  const st = stateNow();
  const days = allDays();
  const d = days[dateKey()] || emptyDay();
  // 확장 프로그램 모드에서는 마지막 상태 이후 흐른 시간을 화면에서만 더해 보여줌
  const extra = linked && st === 'study' ? (Date.now() - ext.at) / 1000 : 0;
  const t = hms(d.focusSec + extra);
  $('#bigT').innerHTML = `${pad(t.h)}:${pad(t.m)}<small>:${pad(t.s)}</small>`;
  const goal = settings.goalMin * 60;
  $('#goalBar').style.width = Math.min(100, ((d.focusSec + extra) / goal) * 100) + '%';
  $('#goalTxt').textContent = d.focusSec >= goal ? '달성!' : `${dur(goal - d.focusSec)} 남음`;
  const c = comboNow() + extra;
  $('#comboBar').style.width = Math.min(100, (c / COMBO) * 100) + '%';
  $('#comboTxt').textContent = `${Math.floor(c / 60)}/25분 · 오늘 ${d.combos}회`;

  const sig = [st, linked, timer.running, ext.status?.tab?.title, LG?.fetchedAt, account.schoolStatus].join('|');
  if (!force && sig === lastSig) return;
  lastSig = sig;
  let [label, color, bg] = BANDS[st] || BANDS.neutral;
  if (linked && st === 'neutral' && ext.status.tab?.source === 'BUILD 사이트') [label, color, bg] = ['공부 모드 켜짐 · 공부할 탭으로 가면 재기 시작해요', 'var(--blue)', 'var(--card)'];
  $('#tcard').style.background = bg;
  $('#chip').innerHTML = `<span class="dot ${st === 'study' ? 'live' : ''}" style="background:${color};color:${color}"></span><span style="color:${color}">${label}</span>`;
  const on = st !== 'off';
  $('#go').textContent = on ? '공부 멈추기' : '공부 시작';
  $('#go').classList.toggle('stop', on);
  $('#modeNote').innerHTML = linked ? '<span class="badge"><span class="dot live" style="width:8px;height:8px;background:var(--live);color:var(--live)"></span>확장 프로그램으로 자동 판별 중</span>' : '<span class="badge">웹 타이머 · 이 탭에 있는 시간만 재요</span>';
  $('#how').innerHTML = linked
    ? '<b>확장 프로그램이 자동으로 재는 중이에요.</b> 인강·LMS·백준·노션처럼 공부로 판별된 탭에 있는 시간만 더하고, 딴짓 탭은 빼요. 이 사이트는 닫아 둬도 돼요.'
    : `<b>이 탭을 열어 둔 채로 공부하세요.</b> 다른 탭이나 프로그램으로 넘어가면 시간이 멈추고, ${AWAY_COUNT}초 넘게 비우면 이탈 1회예요. 책으로 공부할 땐 그냥 켜 두면 되고, ${settings.checkMin}분 동안 입력이 없으면 "공부 중인가요?"를 물어봐요.`;
  const tab = linked && ext.status.tab;
  $('#extTab').innerHTML = tab && on ? `<div class="tabnow"><span class="lbl">지금 탭</span><span class="ttl">${esc(tab.title || '브라우저')}</span><span class="tag">${esc(tab.source || tab.label || '')}</span></div>` : '';

  // 학교 순위
  const lg = LG ? ranked(LG.schools) : [];
  const me = lg.find((s) => s.me);
  const rival = me && me.rank > 1 ? lg[me.rank - 2] : null;
  $('#rankCard').innerHTML = account.schoolStatus && account.schoolStatus !== 'ok'
    ? `<div class="lbl">우리 학교 오늘</div><div style="font-size:22px;font-weight:700;margin:6px 0">등록 대기</div><div class="sub">${esc(account.school)} · 승인되면 대항전 점수에 더해져요</div>`
    : me ? `<div class="lbl">우리 학교 오늘 · ${esc(me.name)}</div><div style="display:flex;align-items:baseline;gap:10px;margin:6px 0"><span class="r">${me.rank}위</span><span class="mono" style="font-weight:700;font-size:18px">${fmtNum(me.score)}점</span></div><div class="sub">${rival ? `위 ${esc(rival.name)}까지 ${fmtNum(rival.score - me.score)}점 · 대항전 보기 →` : '오늘 1위! 대항전 보기 →'}</div>`
      : '<div class="lbl">우리 학교 오늘</div><div class="sub" style="margin-top:8px">순위 불러오는 중…</div>';
  const w = weekReport(days);
  $('#gradeCard').innerHTML = `<div class="lbl">이번 주 예상 학점</div><div style="display:flex;align-items:baseline;gap:10px;margin:6px 0"><span class="kpi" style="font-size:44px">${w.grade}</span><span class="sub">${w.total}점</span></div><div class="prog"><div class="b"><i style="width:${Math.min(100, (w.hours / TARGET_HOURS) * 100)}%"></i></div><div class="t"><span>${w.hours.toFixed(1)} / ${TARGET_HOURS}시간</span><span>내 기록 →</span></div></div>`;
  const card = $('#extCard');
  card.classList.toggle('on', linked);
  if (linked) card.innerHTML = '<div class="lbl">확장 프로그램</div><div style="font-weight:700;margin:6px 0">연결됨 · 탭 자동 판별 중</div><div class="sub">공부 사이트 목록·AI 판별은 확장 프로그램 설정에서 바꿔요.</div>';
  else if (ext.present && ext.status?.profile) card.innerHTML = `<div class="lbl">확장 프로그램</div><div style="font-weight:700;margin:6px 0">다른 계정과 연결돼 있어요</div><div class="sub" style="margin-bottom:10px">확장 프로그램: ${esc(ext.status.profile.nickname)} · ${esc(ext.status.profile.school)}</div><button class="btn line" id="linkExt">이 계정으로 연결하기</button>`;
  else card.innerHTML = '<div class="lbl">탭 자동 판별 (선택)</div><div style="font-weight:700;margin:6px 0">다른 탭에서 공부한다면</div><div class="sub" style="margin-bottom:10px">인강·PDF·백준처럼 다른 탭에서 공부하면 웹 타이머는 멈춰요. 확장 프로그램을 설치하면 공부 탭에 있는 시간만 자동으로 더해요.</div><button class="btn line" id="howExt">설치 방법</button>';
  if ($('#linkExt')) $('#linkExt').onclick = () => postExt('link', { account });
  if ($('#howExt')) $('#howExt').onclick = showExtGuide;
}

function showExtGuide() {
  const m = modal(`<h2>확장 프로그램 설치</h2><p style="text-align:left">1. BUILD 폴더의 <b>extension</b> 폴더를 받아요.<br>2. 크롬 주소창에 <b>chrome://extensions</b> → 오른쪽 위 <b>개발자 모드</b> 켜기<br>3. <b>압축해제된 확장 프로그램을 로드합니다</b> → extension 폴더 선택<br>4. 이 페이지를 새로고침하면 <b>이 계정으로 자동 연결</b>돼요.<br><br>크롬 웹 스토어에 올라가면 "Chrome에 추가" 한 번으로 설치돼요.</p><button class="btn" id="okGuide">알겠어요</button>`);
  $('#okGuide', m).onclick = () => modal(null);
}

// ---------- 가입 ----------
function schoolPicker(root, initial = '') {
  const box = $('#school', root), list = $('#schoolList', root), hint = $('#schoolHint', root);
  let items = [], active = -1;
  const st = { requested: initial && !resolveSchool(initial) ? initial : null };
  box.value = initial;
  const setHint = () => {
    const v = box.value.trim();
    const hit = resolveSchool(v);
    if (hit) { hint.className = 'hint ok-hint'; hint.textContent = `✓ ${hit}`; }
    else if (st.requested && st.requested === v) { hint.className = 'hint pend-hint'; hint.textContent = '목록에 없는 학교예요. 등록 요청으로 시작하고, 승인되면 학교 대항전 점수에 더해져요.'; }
    else { hint.className = 'hint'; hint.textContent = '전국 4년제 대학 목록에서 골라요. 줄임말도 돼요.'; }
  };
  const open = (show) => { list.hidden = !show; box.setAttribute('aria-expanded', String(show)); };
  const draw = () => {
    const v = box.value.trim();
    if (!v) { items = []; open(false); return; }
    items = searchSchools(v).map((s) => ({ name: s.name, region: s.region }));
    if (!resolveSchool(v)) items.push({ req: v });
    active = items.length && !items[0].req ? 0 : -1;
    list.innerHTML = items.map((it, i) => it.req
      ? `<li role="option" class="req" data-i="${i}" aria-selected="${i === active}">'${esc(it.req)}' 목록에 없어요 · 등록 요청하기</li>`
      : `<li role="option" data-i="${i}" aria-selected="${i === active}"><span>${esc(it.name)}</span><small>${esc(it.region)}</small></li>`).join('');
    open(true);
  };
  const choose = (i) => {
    const it = items[i];
    if (!it) return;
    if (it.req) { st.requested = it.req; box.value = it.req; } else { st.requested = null; box.value = it.name; }
    open(false);
    setHint();
  };
  box.addEventListener('input', () => { st.requested = null; draw(); setHint(); });
  box.addEventListener('focus', draw);
  box.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') open(false);
  });
  list.addEventListener('mousedown', (e) => { const li = e.target.closest('li'); if (li) { e.preventDefault(); choose(+li.dataset.i); } });
  box.addEventListener('blur', () => { setTimeout(() => open(false), 100); const hit = resolveSchool(box.value); if (hit) { box.value = hit; setHint(); } });
  setHint();
  return {
    value() {
      const v = box.value.trim();
      return resolveSchool(v) || (st.requested === v ? v : '');
    },
    focus() { box.focus(); draw(); },
  };
}
const schoolField = (label = '학교') => `<div class="field combo-wrap"><label for="school">${label}</label><input class="input" id="school" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="schoolList" placeholder="학교 검색 (예: 충북대, 카이스트)" autocomplete="off"><ul class="sug" id="schoolList" role="listbox" hidden></ul><span class="hint" id="schoolHint"></span></div>`;

function viewJoin() {
  document.title = 'BUILD 대학교 — 공부한 시간이 학점이 되는 곳';
  $('#view').innerHTML = `
  <div class="join">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:28px"><span class="logo"><b>BUILD</b><span>대학교</span></span><button class="theme-btn" data-theme-toggle aria-label="라이트/다크 모드 전환">${$('.top .theme-btn').innerHTML}</button></div>
    <div class="cols">
      <form class="card main" id="joinForm" autocomplete="off">
        <h1>공부한 시간이<br>학점이 되는 곳</h1>
        <p class="lead">공부 시작을 누르고 이 탭을 열어 두면 순공 시간을 잽니다. 그 시간이 매주 학점이 되고, 우리 학교 점수가 되어 다른 학교와 겨뤄요.</p>
        <div class="row2">${schoolField()}
          <div class="field"><label for="dept">학과 <span class="hint" style="font-weight:400">(선택)</span></label><input class="input" id="dept" list="depts" placeholder="비워 둬도 돼요"><datalist id="depts">${DEPTS.map((d) => `<option value="${esc(d)}">`).join('')}</datalist></div>
        </div>
        <div class="field"><label for="nick">닉네임</label><input class="input" id="nick" maxlength="12" placeholder="랭킹에 보일 이름"><span class="hint">실명 대신 닉네임만 공개돼요.</span></div>
        <div class="err" id="err" role="alert"></div>
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><button class="btn go" type="submit" id="joinBtn">가입하고 공부 시작</button><button type="button" class="linkbtn" id="loginBtn">이미 계정이 있어요 (로그인 코드)</button></div>
      </form>
      <aside class="card side">
        <div class="feat"><span class="n">1</span><div><b>순공 시간 = 학점</b>주 25시간이면 시간 점수 만점. 딴짓으로 탭을 벗어나면 집중도 점수가 깎여요.</div></div>
        <div class="feat"><span class="n">2</span><div><b>학교 대항전</b>순공 1분이 우리 학교 1점. 매일 0시에 새 판이 열려요.</div></div>
        <div class="feat"><span class="n">3</span><div><b>캠퍼스 짓기</b>학점이 확정될 때마다 내 캠퍼스에 한 층씩 올라가요.</div></div>
        <div class="how" style="margin-top:8px">확장 프로그램(선택)을 설치하면 다른 탭에서 하는 공부도 자동으로 판별해서 잽니다. 설치돼 있으면 이 사이트와 자동으로 연결돼요.</div>
      </aside>
    </div>
  </div>`;
  const picker = schoolPicker($('#view'));
  $('#loginBtn').onclick = showLogin;
  $('#joinForm').onsubmit = async (e) => {
    e.preventDefault();
    const school = picker.value();
    const nickname = $('#nick').value.trim();
    const dept = $('#dept').value.trim();
    if (!school) { picker.focus(); return ($('#err').textContent = "학교를 목록에서 골라 주세요. 없으면 '등록 요청하기'를 눌러요."); }
    if (!nickname) return ($('#err').textContent = '닉네임을 적어 주세요.');
    $('#joinBtn').disabled = true;
    try {
      const r = await api('/api/register', { school, dept, nickname });
      saveAccount({ userId: r.userId, token: r.token, school: r.school, schoolStatus: r.schoolStatus, dept, nickname, ranking: true });
      await boot();
      start();
      toast('가입 완료! 공부를 시작했어요');
    } catch (err) {
      $('#err').textContent = '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.';
      $('#joinBtn').disabled = false;
    }
  };
}

function showLogin() {
  const m = modal('<h2>로그인 코드</h2><p>다른 기기의 설정 › 다른 기기에서 쓰기에 있는 코드를 붙여 넣어요.</p><input class="input" id="codeIn" placeholder="로그인 코드"><div class="err" id="codeErr"></div><button class="btn" id="codeGo">로그인</button><button class="btn line" id="codeX">닫기</button>');
  $('#codeX', m).onclick = () => modal(null);
  $('#codeGo', m).onclick = async () => {
    try {
      const raw = $('#codeIn', m).value.trim();
      const { u, t } = JSON.parse(decodeURIComponent(escape(atob(raw))));
      const r = await api('/api/me', { userId: u, token: t });
      saveAccount({ ...r.profile, userId: u, token: t });
      serverDays = r.days || {};
      modal(null);
      boot();
      toast(`${r.profile.nickname}님, 다시 오셨네요`);
    } catch {
      $('#codeErr', m).textContent = '코드를 확인해 주세요.';
    }
  };
}

// ---------- 설정 ----------
function viewSettings() {
  const t = window.BuildTheme?.get() || 'system';
  $('#view').innerHTML = `
  <div class="set">
    <div class="h1row"><div class="h1">설정</div></div>
    <section class="card sec">
      <h2>소속</h2>
      <div class="grid3">${schoolField()}
        <div class="field"><label for="dept">학과 <span class="hint" style="font-weight:400">(선택)</span></label><input class="input" id="dept" list="depts" value="${esc(account.dept || '')}" placeholder="비워 둬도 돼요"><datalist id="depts">${DEPTS.map((d) => `<option value="${esc(d)}">`).join('')}</datalist></div>
        <div class="field"><label for="nick">닉네임</label><input class="input" id="nick" maxlength="12" value="${esc(account.nickname)}"></div>
      </div>
      <button class="btn line" id="saveP">소속 저장</button>
      <div class="row"><div><b>랭킹 참여</b><span class="hint">끄면 내 순공이 학교 점수에 더해지지 않아요.</span></div><button class="switch" id="rankSw" role="switch" aria-checked="${account.ranking !== false}" aria-label="랭킹 참여"></button></div>
    </section>
    <section class="card sec">
      <h2>공부</h2>
      <div class="row"><div><b>하루 목표</b></div><select class="input" id="goalMin">${[60, 120, 180, 240, 300, 360, 480].map((m) => `<option value="${m}" ${m === settings.goalMin ? 'selected' : ''}>${m / 60}시간</option>`).join('')}</select></div>
      <div class="row"><div><b>자리 확인 간격</b><span class="hint">이 시간 동안 입력이 없으면 "아직 공부 중인가요?"를 물어봐요. (웹 타이머)</span></div><select class="input" id="checkMin">${[10, 25, 40, 60].map((m) => `<option value="${m}" ${m === settings.checkMin ? 'selected' : ''}>${m}분</option>`).join('')}</select></div>
      <div class="row"><div><b>개강일</b><span class="hint">'n주차' 계산에 써요.</span></div><input class="input" type="date" id="sem" value="${settings.semesterStart}"></div>
    </section>
    <section class="card sec">
      <h2>화면</h2>
      <div class="row"><div><b>테마</b></div><div class="seg" id="themeSeg"><button data-t="system" class="${t === 'system' ? 'on' : ''}">시스템 설정</button><button data-t="light" class="${t === 'light' ? 'on' : ''}">라이트</button><button data-t="dark" class="${t === 'dark' ? 'on' : ''}">다크</button></div></div>
    </section>
    <section class="card sec">
      <h2>확장 프로그램 (선택)</h2>
      <div class="row"><div><b>${extLinked() ? '연결됨 · 탭 자동 판별 중' : ext.present ? '설치됨 · 다른 계정과 연결' : '설치 안 됨'}</b><span class="hint">설치하면 다른 탭에서 하는 공부도 자동으로 판별해서 잽니다. 이 사이트를 열면 같은 계정으로 자동 연결돼요.</span></div>${extLinked() ? '' : ext.present ? '<button class="btn line" id="linkExt2">이 계정으로 연결</button>' : '<button class="btn line" id="howExt2">설치 방법</button>'}</div>
    </section>
    <section class="card sec">
      <h2>다른 기기에서 쓰기</h2>
      <p class="hint" style="font-size:14px;margin:4px 0 12px">다른 컴퓨터에서 '이미 계정이 있어요'를 누르고 이 코드를 붙여 넣으면 같은 계정으로 이어져요. 남에게 보여주지 마세요.</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn line" id="showCode">로그인 코드 보기</button><span id="codeBox" style="flex:1;min-width:200px"></span></div>
    </section>
    <section class="card sec">
      <h2>계정</h2>
      <div class="row"><span class="hint" style="font-size:14px">이 브라우저에서만 로그아웃해요. 로그인 코드가 있으면 다시 들어올 수 있어요.</span><button class="btn line" id="logout">로그아웃</button></div>
      <div class="row"><span class="hint" style="font-size:14px">계정을 지우면 서버의 학점·순공 기록이 모두 지워지고 되돌릴 수 없어요.</span><button class="btn danger" id="del">계정 삭제</button></div>
    </section>
  </div>`;
  const picker = schoolPicker($('#view'), account.school);
  $('#saveP').onclick = async () => {
    const school = picker.value();
    const nickname = $('#nick').value.trim();
    if (!school) return toast("학교를 목록에서 골라 주세요. 없으면 '등록 요청하기'");
    if (!nickname) return toast('닉네임을 적어 주세요');
    try {
      const r = await api('/api/profile', { userId: account.userId, token: account.token, school, dept: $('#dept').value.trim(), nickname });
      saveAccount({ ...account, school: r.school, schoolStatus: r.schoolStatus, dept: $('#dept').value.trim(), nickname });
      await loadLeague();
      toast(r.schoolStatus === 'ok' ? `${r.school}로 저장했어요` : `'${r.school}' 등록을 요청했어요`);
      render();
    } catch { toast('저장하지 못했어요'); }
  };
  $('#rankSw').onclick = async () => {
    const ranking = account.ranking === false;
    try { await api('/api/profile', { userId: account.userId, token: account.token, ranking }); saveAccount({ ...account, ranking }); render(); } catch { toast('저장하지 못했어요'); }
  };
  $('#goalMin').onchange = (e) => { settings.goalMin = +e.target.value; saveSettings(); };
  $('#checkMin').onchange = (e) => { settings.checkMin = +e.target.value; saveSettings(); };
  $('#sem').onchange = (e) => { if (e.target.value) { settings.semesterStart = e.target.value; saveSettings(); } };
  $$('#themeSeg button').forEach((b) => (b.onclick = () => { window.BuildTheme.set(b.dataset.t); render(); }));
  if ($('#linkExt2')) $('#linkExt2').onclick = () => postExt('link', { account });
  if ($('#howExt2')) $('#howExt2').onclick = showExtGuide;
  $('#showCode').onclick = () => { $('#codeBox').innerHTML = `<div class="code">${loginCode()}</div>`; };
  $('#logout').onclick = () => { if (confirm('로그아웃할까요? 로그인 코드를 저장해 두지 않았다면 다시 들어올 수 없어요.')) { stop(); logout(); } };
  $('#del').onclick = async () => {
    if (!confirm('계정과 서버 기록을 모두 지울까요? 되돌릴 수 없어요.')) return;
    try { await api('/api/delete', { userId: account.userId, token: account.token }); } catch {}
    LS.del(K.days); LS.del(K.timer); localDays = {}; timer.running = false;
    logout();
  };
}

// ---------- 시작 ----------
function route() {
  const v = (location.hash || '#study').slice(1);
  view = ['study', 'me', 'battle', 'campus', 'settings'].includes(v) ? v : 'study';
  window.scrollTo(0, 0);
  lastSig = '';
  render();
}
window.addEventListener('hashchange', route);

async function boot() {
  if (!account) {
    // 확장 프로그램에 계정이 있으면 받아오기
    postExt('hello', { account: null });
    await new Promise((r) => setTimeout(r, 700));
    if (!account) return render();
  }
  await Promise.all([loadMe(), loadLeague()]);
  route();
}

dash = createDash({
  root: $('#view'),
  smashEl: $('#smash'),
  settingsHref: '#settings',
  startLabel: '공부 시작하고 참전하기',
  comboHint: '25분 연속 공부',
  onStart: () => { start(); location.hash = '#study'; },
});
document.addEventListener('themechange', () => { if (view === 'settings') render(); });
await boot();
postExt('hello', { account });
setInterval(loop, 1000);
setInterval(() => { saveDays(); saveTimer(); }, 5000);
setInterval(heartbeat, 30000);
setInterval(async () => {
  if (!account) return;
  await loadLeague();
  if (view === 'battle' || view === 'me') { dash.setData(dashData()); dash.render(view); dash.checkSmash(); }
}, 6000);
setInterval(loadMe, 60000);
