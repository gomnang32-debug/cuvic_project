import { pad, dur, hms } from './lib/util.js';
import { TARGET_HOURS } from './lib/grade.js';

const $ = (s) => document.querySelector(s);
const send = (msg) => chrome.runtime.sendMessage(msg);
const open = (path) => chrome.tabs.create({ url: chrome.runtime.getURL(path) });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

$('#settings').onclick = () => chrome.runtime.openOptionsPage();
$('#home').onclick = (e) => { e.preventDefault(); open('dashboard.html#me'); };

let S = null;
let base = 0; // 마지막 상태를 받은 시각

const BANDS = {
  study: { label: '공부 중', color: 'var(--blue)', bg: 'var(--blue-soft)' },
  pending: { label: '판별 대기', color: 'var(--slate)', bg: 'var(--soft)' },
  distract: { label: '딴짓', color: 'var(--orange)', bg: 'var(--orange-soft)' },
  away: { label: '자리 비움', color: 'var(--muted)', bg: 'var(--band-away)' },
  outside: { label: '브라우저 밖', color: 'var(--muted)', bg: 'var(--band-away)' },
  neutral: { label: '측정 멈춤', color: 'var(--muted)', bg: 'var(--band-gray)' },
  off: { label: '공부 모드 꺼짐', color: 'var(--muted)', bg: 'var(--band-gray)' },
};

function verdictOf(s) {
  const t = s.tab;
  const corrected = t.source === '정정 기억';
  if (s.state === 'off') return { text: '공부 모드를 켜면 이 탭부터 판별해요', c: 'var(--ink2)', b: 'var(--soft)' };
  if (s.state === 'away') {
    const at = s.lastInputAt ? new Date(s.lastInputAt) : null;
    return { text: at ? `마지막 입력 ${pad(at.getHours())}:${pad(at.getMinutes())}까지만 인정했어요` : '입력이 없어 측정을 멈췄어요', c: 'var(--ink2)', b: 'var(--soft)' };
  }
  if (corrected) return { text: `정정됨 · 이 탭은 ${t.kind === 'study' ? '공부' : '딴짓'}로 기억할게요`, c: 'var(--ink)', b: 'var(--yellow-soft)', fix: '정정 취소', undo: true };
  switch (t.kind) {
    case 'study':
      return { text: '공부로 판별 · 순공 시간에 더하는 중', c: 'var(--blue)', b: 'var(--blue-soft)', fix: '이건 공부 아니야', as: 'distract' };
    case 'pending':
      return t.source === 'AI 판별 중'
        ? { text: '확인 중 · 공부로 나오면 지금부터 소급해 더해요', c: 'var(--ink2)', b: 'var(--soft)', fix: '이건 공부야', as: 'study' }
        : { text: `판별 보류 · 공부라면 눌러 주세요${s.pendingSec >= 60 ? `. 기다린 ${dur(s.pendingSec)}도 더해요` : ''}`, c: 'var(--ink2)', b: 'var(--soft)', fix: '이건 공부야', as: 'study', fix2: '딴짓 맞아', as2: 'distract' };
    case 'distract':
      return { text: '공부 아님 · 순공 시간이 멈춰 있어요', c: 'var(--orange)', b: 'var(--orange-soft)', fix: '이것도 공부예요', as: 'study', back: s.canGoBack };
    default:
      return t.domain
        ? { text: '처음 보는 사이트 · 측정을 멈췄어요', c: 'var(--ink2)', b: 'var(--soft)', fix: '이건 공부야', as: 'study', fix2: '딴짓이야', as2: 'distract' }
        : { text: '브라우저 화면 · 측정하지 않아요', c: 'var(--ink2)', b: 'var(--soft)' };
  }
}

function sourceLabel(s) {
  const t = s.tab;
  if (s.state === 'away') return `입력 없음 ${s.settings.idleMin}분`;
  if (!t.domain) return '';
  return t.source || '';
}

function render() {
  const s = S;
  if (!s) return;
  if (s.profile?.school) $('#schoolName').textContent = s.profile.school;
  if (!s.profile) {
    $('#main').innerHTML = `
      <div class="welcome">
        <h1>공부한 시간이<br>학점이 되는 곳</h1>
        <p class="sub" style="font-size:14px;margin:0">학교와 학과만 알려주면 바로 시작해요. 우리 학교 순공 시간으로 다른 학교와 겨뤄요.</p>
        <button class="btn" id="start">시작하기</button>
      </div>`;
    $('#start').onclick = () => open('onboarding.html');
    return;
  }
  const band = { ...BANDS[s.state] };
  if (s.state === 'distract') band.label = s.distractSec >= 60 ? `딴짓 ${Math.floor(s.distractSec / 60)}분째` : '딴짓 중';
  const on = s.settings.studyMode;
  const v = verdictOf(s);
  const t = s.tab;
  const initial = (t.label || t.domain || 'B').replace(/^www\./, '')[0].toUpperCase();
  const goal = s.settings.goalMin * 60;
  const left = goal - s.today.focusSec;
  const wk = s.week;
  const sc = s.school;
  const pct = Math.min(100, (wk.hours / TARGET_HOURS) * 100);

  $('#main').innerHTML = `
    <div class="band" style="background:${band.bg}">
      <div class="band-top">
        <div class="state" style="color:${band.color}"><span class="dot ${s.state === 'study' ? 'live' : ''}" style="background:${band.color};color:${band.color}"></span><span>${band.label}</span></div>
        <button class="mode" id="modeSw" role="switch" aria-checked="${on}"><span>공부 모드</span><span class="switch" aria-checked="${on}" tabindex="-1"></span></button>
      </div>
      <div class="lbl">오늘 순공 시간</div>
      <div class="timer" id="timer"></div>
      <div class="sub">${left > 0 ? `하루 목표 ${dur(goal)}까지 ${dur(left)} 남았어요` : `오늘 목표 ${dur(goal)} 달성! 지금부터는 보너스예요`}</div>
      ${on ? `<div class="combo" title="25분 연속 공부마다 학교 점수 +5"><div class="bar"><i id="comboBar"></i></div><span id="comboTxt"></span></div>` : ''}
    </div>
    <section>
      <div class="lbl">지금 보고 있는 탭</div>
      <div class="tabbox">
        <div class="tabrow">
          <span class="fav">${t.favicon && /^https?:|^data:/.test(t.favicon) ? `<img src="${esc(t.favicon)}" alt="">` : esc(initial)}</span>
          <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
            <div class="ttl">${esc(t.title || '새 탭')}</div>
            <div class="lbl">${esc(t.label || '브라우저')}${sourceLabel(s) ? ' · ' + esc(sourceLabel(s)) : ''}</div>
          </div>
        </div>
        <div class="verdict" style="color:${v.c};background:${v.b}">${v.text}</div>
        ${on && (v.fix || v.back) ? `<div class="actions">
            ${v.back ? `<button class="btn" id="back">공부 탭으로 돌아가기</button>` : ''}
            ${v.fix ? `<button class="btn line" id="fix">${v.fix}</button>` : ''}
            ${v.fix2 ? `<button class="btn line" id="fix2">${v.fix2}</button>` : ''}
          </div>` : ''}
      </div>
    </section>
    <div class="grid">
      <a class="mini" href="#" id="toMe">
        <div class="lbl">이번 주 예상 학점</div>
        <div class="big">${wk.grade}</div>
        <div class="sub">현재 페이스 · ${wk.total}점</div>
        <div class="pbar"><i style="width:${pct}%"></i></div>
        <div class="lbl" style="font-size:11px">${wk.hours.toFixed(1)} / ${TARGET_HOURS}시간</div>
      </a>
      <a class="mini" href="#" id="toBattle">
        <div class="lbl">우리 학교 오늘</div>
        ${sc?.pending ? `<div class="big" style="font-size:20px;padding:6px 0">${sc.rejected ? '등록 거절' : '등록 대기'}</div><div class="sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(sc.name)}</div><div class="lbl" style="font-size:11px;margin-top:4px">${sc.rejected ? '설정에서 학교를 다시 골라 주세요' : '승인되면 점수가 더해져요'}</div>`
        : sc ? `<div style="display:flex;align-items:baseline;gap:6px"><span class="big">${sc.rank}위</span>${sc.delta > 0 ? `<span style="font-size:12px;font-weight:600;color:var(--blue)">▲ ${sc.delta}</span>` : sc.delta < 0 ? `<span style="font-size:12px;font-weight:600;color:var(--orange)">▼ ${-sc.delta}</span>` : ''}</div>
        <div class="sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(sc.name)}</div>
        <div class="lbl" style="font-size:11px;margin-top:4px">1인 평균으로는 ${sc.avgRank}위${sc.online ? '' : ' · 오프라인'}</div>`
        : `<div class="big">–</div><div class="sub">순위 불러오는 중</div>`}
      </a>
    </div>
    <footer>
      <a href="#" id="dash">${s.siteUrl ? 'BUILD 사이트 열기' : '대시보드 열기'}</a>
      <button class="btn" id="toggle">${on ? '공부 모드 정지' : '공부 모드 시작'}</button>
    </footer>`;

  const act = async (m) => { S = await send(m); base = Date.now(); render(); };
  $('#modeSw').onclick = () => act({ type: 'toggle' });
  $('#toggle').onclick = () => act({ type: 'toggle' });
  // 사이트가 열려 있으면 사이트로, 아니면 확장 프로그램 안의 대시보드로
  const go = (v) => (s.siteUrl ? chrome.tabs.create({ url: s.siteUrl.replace(/\/$/, '') + '/#' + v }) : open('dashboard.html#' + v));
  $('#dash').onclick = (e) => { e.preventDefault(); go('me'); };
  $('#toMe').onclick = (e) => { e.preventDefault(); go('me'); };
  $('#toBattle').onclick = (e) => { e.preventDefault(); go('battle'); };
  if ($('#fix')) $('#fix').onclick = () => act(v.undo ? { type: 'undo' } : { type: 'correct', as: v.as });
  if ($('#fix2')) $('#fix2').onclick = () => act({ type: 'correct', as: v.as2 });
  if ($('#back')) $('#back').onclick = () => act({ type: 'goBack' });
  tick();
}

function tick() {
  if (!S?.profile || !$('#timer')) return;
  const extra = S.state === 'study' ? (Date.now() - base) / 1000 : 0;
  const t = hms(S.today.focusSec + extra);
  $('#timer').innerHTML = `${pad(t.h)}:${pad(t.m)}<small>:${pad(t.s)}</small>`;
  if ($('#comboBar')) {
    const c = S.comboSec + extra;
    $('#comboBar').style.width = Math.min(100, (c / 1500) * 100) + '%';
    $('#comboTxt').textContent = `콤보 ${Math.floor(c / 60)}/25분 · 오늘 ${S.today.combos}회`;
  }
}

async function refresh(first) {
  S = await send({ type: 'status', refresh: first });
  base = Date.now();
  render();
}
refresh(true);
setInterval(tick, 1000);
setInterval(() => refresh(false), 4000);
if (!sessionStorage.getItem('synced')) {
  sessionStorage.setItem('synced', '1');
  send({ type: 'syncNow' }).then(() => refresh(false));
}
