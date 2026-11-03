import { DEPTS } from './lib/sim.js';
import { ALL_SCHOOLS, resolveSchool } from './lib/schools.js';
import { dateKey, addDays, rng, hash } from './lib/util.js';
import { emptyDay } from './lib/store.js';
import * as api from './lib/api.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const send = (m) => chrome.runtime.sendMessage(m);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let ST = await send({ type: 'state' });
let listTab = 'study';

function toast(t) {
  $('#toast').textContent = t;
  $('#toast').classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $('#toast').classList.remove('show'), 1800);
}
async function set(data, sync) {
  ST = await send({ type: 'set', data, sync });
  render();
}
const setSettings = (patch, sync) => set({ settings: { ...ST.settings, ...patch } }, sync);

$('#schools').innerHTML = ALL_SCHOOLS.map((s) => `<option value="${s.name}">${s.region}</option>`).join('');
$('#depts').innerHTML = DEPTS.map((s) => `<option value="${s}">`).join('');

// ---------- 사이트 목록 ----------
function cleanDomain(v) {
  v = v.trim().toLowerCase();
  try { if (v.includes('/')) v = new URL(v.includes('://') ? v : 'https://' + v).hostname; } catch {}
  return v.replace(/^www\./, '');
}
function renderSites() {
  const L = ST.lists;
  $('#tStudy').textContent = `공부 사이트 ${L.study.length}`;
  $('#tDis').textContent = `딴짓 사이트 ${L.distract.length}`;
  $('#tStudy').classList.toggle('on', listTab === 'study');
  $('#tDis').classList.toggle('on', listTab === 'distract');
  const items = L[listTab];
  const color = listTab === 'study' ? 'var(--blue)' : 'var(--orange)';
  $('#list').innerHTML = items.length
    ? items.map((it, i) => `<div class="site"><span class="dot" style="background:${color};width:8px;height:8px"></span><span class="mono">${esc(it.domain)}</span><span class="tag">${esc(it.how)}</span><button class="x" data-i="${i}" aria-label="${esc(it.domain)} 삭제">×</button></div>`).join('')
    : `<div class="empty">아직 없어요. 기본 규칙 목록(${listTab === 'study' ? 'LMS, 백준, GitHub, 노션 등' : '웹툰, SNS, OTT, 커뮤니티 등'})이 먼저 적용되고 있어요.</div>`;
  $$('#list .x').forEach((b) => (b.onclick = () => {
    const arr = [...ST.lists[listTab]];
    arr.splice(+b.dataset.i, 1);
    set({ lists: { ...ST.lists, [listTab]: arr } });
  }));

  // 정정 3회 제안
  const sug = Object.entries(ST.corrections).map(([d, c]) => {
    if (ST.dismissed[d]) return null;
    if (c.study >= 3 && !L.study.some((x) => x.domain === d)) return { d, as: 'study', n: c.study };
    if (c.distract >= 3 && !L.distract.some((x) => x.domain === d)) return { d, as: 'distract', n: c.distract };
    return null;
  }).filter(Boolean)[0];
  $('#suggest').innerHTML = sug
    ? `<div class="banner"><span>${esc(sug.d)} 판별을 ${sug.n}번 ${sug.as === 'study' ? '공부' : '딴짓'}로 바꾸셨어요. ${sug.as === 'study' ? '공부' : '딴짓'} 사이트에 넣을까요?</span><button class="btn" id="sugYes">${sug.as === 'study' ? '공부' : '딴짓'} 사이트에 추가</button><button class="btn line" id="sugNo">나중에</button></div>`
    : '';
  if (sug) {
    $('#sugYes').onclick = () => {
      const other = sug.as === 'study' ? 'distract' : 'study';
      set({ lists: { ...ST.lists, [sug.as]: [...ST.lists[sug.as], { domain: sug.d, how: `정정 ${sug.n}회로 추가`, ts: Date.now() }], [other]: ST.lists[other].filter((x) => x.domain !== sug.d) } });
      toast(`${sug.d}를 추가했어요`);
    };
    $('#sugNo').onclick = () => set({ dismissed: { ...ST.dismissed, [sug.d]: Date.now() } });
  }
}
$('#tStudy').onclick = () => { listTab = 'study'; renderSites(); };
$('#tDis').onclick = () => { listTab = 'distract'; renderSites(); };
$('#addForm').onsubmit = (e) => {
  e.preventDefault();
  const d = cleanDomain($('#addInput').value);
  if (!d || !d.includes('.')) return toast('도메인을 확인해 주세요 (예: notion.so)');
  const other = listTab === 'study' ? 'distract' : 'study';
  if (ST.lists[listTab].some((x) => x.domain === d)) return toast('이미 있어요');
  set({ lists: { ...ST.lists, [listTab]: [...ST.lists[listTab], { domain: d, how: '직접 추가', ts: Date.now() }], [other]: ST.lists[other].filter((x) => x.domain !== d) } });
  $('#addInput').value = '';
};

// ---------- 알림 ----------
$$('[data-n]').forEach((b) => (b.onclick = () => setSettings({ notify: { ...ST.settings.notify, [b.dataset.n]: !ST.settings.notify[b.dataset.n] } })));

// ---------- 측정 ----------
$('#idleMin').onchange = (e) => setSettings({ idleMin: +e.target.value });
$('#goalMin').onchange = (e) => setSettings({ goalMin: +e.target.value });
$('#semesterStart').onchange = (e) => e.target.value && setSettings({ semesterStart: e.target.value });
$('#aiKey').onchange = (e) => { setSettings({ aiKey: e.target.value.trim() }); toast(e.target.value.trim() ? 'AI 판별을 켰어요' : 'AI 판별을 껐어요'); };
$('#aiModel').onchange = (e) => setSettings({ aiModel: e.target.value.trim() || 'claude-haiku-5-5' });

// ---------- 계정 ----------
$('#ranking').onclick = () => setSettings({ ranking: !ST.settings.ranking }, true);
$('#demoLeague').onclick = () => setSettings({ demoLeague: !ST.settings.demoLeague }, true);
$('#serverUrl').onchange = async (e) => {
  const url = e.target.value.trim().replace(/\/$/, '');
  let origin = null;
  try { origin = new URL(url).origin; } catch { return toast('주소를 확인해 주세요 (예: https://build-univ.onrender.com)'); }
  // 배포된 사이트면 그 사이트에서 연결 스크립트가 돌 수 있게 권한 요청
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    const ok = await chrome.permissions.request({ origins: [origin + '/*'] }).catch(() => false);
    if (!ok) toast('권한이 없으면 사이트와 자동 연결이 안 돼요. 순위 동기화는 계속 돼요');
  }
  setSettings({ serverUrl: url }, true);
};
$('#check').onclick = async () => {
  $('#srvStatus').textContent = '확인 중…';
  const lg = await api.getLeague(ST);
  $('#srvStatus').innerHTML = lg.online ? '<span class="ok">● 연결됨</span>' : '<span class="bad">● 연결 안 됨 · 오프라인 리그 사용 중</span>';
};
$('#saveProfile').onclick = async () => {
  const p = { ...(ST.profile || {}), school: $('#pSchool').value.trim(), dept: $('#pDept').value.trim(), nickname: $('#pNick').value.trim() };
  if (!p.school || !p.nickname) return toast('학교와 닉네임을 적어 주세요');
  const hit = resolveSchool(p.school);
  if (!hit && !confirm(`'${p.school}'은(는) 학교 목록에 없어요.\n등록 요청을 보낼까요? 승인되기 전까지는 공부 기록만 쌓이고 학교 대항전 점수에는 더해지지 않아요.`)) return;
  const profile = p.userId ? await api.updateProfile(ST, p) : await api.register(ST, p);
  await set({ profile }, true);
  $('#pSchool').value = profile.school;
  toast(profile.schoolStatus === 'ok' ? `${profile.school}로 저장했어요` : `'${profile.school}' 등록을 요청했어요`);
};
$('#del').onclick = async () => {
  if (!confirm('계정을 지우면 서버의 기록과 이 브라우저의 기록이 모두 지워져요. 계속할까요?')) return;
  await api.deleteAccount(ST);
  await chrome.storage.local.clear();
  await send({ type: 'reload' });
  location.href = 'onboarding.html';
};

// ---------- 발표·테스트 ----------
$('#seed').onclick = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = { ...ST.days };
  const r = rng(hash('seed|' + (ST.profile?.nickname || 'me')));
  for (let i = 1; i <= 62; i++) {
    const d = addDays(today, -i);
    const k = dateKey(d);
    if (days[k]?.focusSec > 0) continue;
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    if (r() < (weekend ? 0.35 : 0.08)) continue;
    const day = emptyDay();
    const hrs = weekend ? 1 + r() * 3 : 2.5 + r() * 4;
    const pattern = [9, 10, 11, 14, 15, 16, 19, 20, 21, 22, 23];
    let left = hrs * 3600;
    while (left > 0) {
      const h = pattern[Math.floor(r() * pattern.length)];
      const add = Math.min(left, 900 + r() * 1800, 3600 - day.hours[h]);
      if (add <= 0) continue;
      day.hours[h] += add;
      left -= add;
    }
    day.focusSec = day.hours.reduce((a, b) => a + b, 0);
    day.distractions = Math.round((day.focusSec / 3600) * (0.5 + r() * 1.6));
    day.combos = Math.floor((day.focusSec / 1500) * 0.7);
    day.goalNotified = true;
    days[k] = day;
  }
  set({ days });
  toast('지난 8주 기록을 채웠어요');
};
$('#wipe').onclick = () => {
  if (!confirm('순공·학점 기록을 모두 지울까요?')) return;
  set({ days: {}, aiCache: {}, corrections: {}, overrides: {} });
  toast('기록을 초기화했어요');
};

// ---------- 화면 테마 ----------
function renderTheme() {
  const t = window.BuildTheme.get();
  $$('#themeSeg button').forEach((b) => { b.classList.toggle('on', b.dataset.t === t); b.setAttribute('aria-checked', String(b.dataset.t === t)); });
}
$$('#themeSeg button').forEach((b) => (b.onclick = () => window.BuildTheme.set(b.dataset.t)));
document.addEventListener('themechange', renderTheme);
window.addEventListener('storage', renderTheme);
renderTheme();

// ---------- 그리기 ----------
function render() {
  const s = ST.settings;
  renderSites();
  $$('[data-n]').forEach((b) => b.setAttribute('aria-checked', String(!!s.notify[b.dataset.n])));
  $('#idleMin').value = String(s.idleMin);
  $('#goalMin').value = String(s.goalMin);
  $('#semesterStart').value = s.semesterStart;
  if (document.activeElement !== $('#aiKey')) $('#aiKey').value = s.aiKey;
  $('#aiModel').value = s.aiModel;
  $('#ranking').setAttribute('aria-checked', String(s.ranking));
  $('#demoLeague').setAttribute('aria-checked', String(s.demoLeague));
  if (document.activeElement !== $('#serverUrl')) $('#serverUrl').value = s.serverUrl;
  const p = ST.profile;
  if (p && document.activeElement?.closest?.('.grid3') == null) {
    $('#pSchool').value = p.school;
    $('#pDept').value = p.dept;
    $('#pNick').value = p.nickname;
  }
  $('#rankDesc').textContent = p ? `${[p.school + (p.schoolStatus && p.schoolStatus !== 'ok' ? ' (등록 대기)' : ''), p.dept, p.nickname].filter(Boolean).join(' · ')}. 끄면 점수를 보내지 않아요.` : '아직 소속이 없어요. 위에서 저장하세요.';
}
render();

// 왼쪽 메뉴 현재 위치 표시
const obs = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) $$('#nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id));
}), { rootMargin: '-30% 0px -60% 0px' });
$$('.sec').forEach((s) => obs.observe(s));
