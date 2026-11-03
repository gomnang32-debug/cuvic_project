import { DEPTS, buildLeague, ranked } from './lib/sim.js';
import { resolveSchool, searchSchools } from './lib/schools.js';
import { register } from './lib/api.js';
import { dateKey, fmtNum } from './lib/util.js';

const $ = (s) => document.querySelector(s);
const send = (m) => chrome.runtime.sendMessage(m);

$('#depts').innerHTML = DEPTS.map((s) => `<option value="${s}">`).join('');

const st = await send({ type: 'state' });
if (st.profile) {
  $('#school').value = st.profile.school;
  $('#dept').value = st.profile.dept;
  $('#nick').value = st.profile.nickname;
}
$('#rank').setAttribute('aria-checked', String(st.settings.ranking));
$('#rank').onclick = () => $('#rank').setAttribute('aria-checked', String($('#rank').getAttribute('aria-checked') !== 'true'));

// 학교를 고르면 오늘 바로 위 학교를 미리 보여줌
function preview() {
  const school = resolveSchool($('#school').value);
  if (!school) return ($('#vs').hidden = true);
  const lg = buildLeague({ date: dateKey(), now: Date.now(), demo: st.settings.demoLeague, school });
  const r = ranked(lg.schools);
  const me = r.find((s) => s.me);
  const rival = r[me.rank - 2];
  $('#vs').hidden = false;
  $('#vs').innerHTML = rival
    ? `<div><div class="hint" style="color:var(--inv-muted)">우리 학교 · 오늘 ${me.rank}위</div><div class="n">${school}</div></div><div class="k">VS</div><div style="text-align:right"><div class="hint" style="color:var(--inv-muted)">따라잡을 상대 · ${fmtNum(rival.score - me.score)}점 차</div><div class="n">${rival.name}</div></div>`
    : `<div><div class="hint" style="color:var(--inv-muted)">오늘 1위</div><div class="n">${school}</div></div><div class="k">1위</div><div style="text-align:right" class="hint">지키기만 하면 돼요</div>`;
}
// ---------- 학교 검색 (목록에서 고르기) ----------
const box = $('#school'), list = $('#schoolList'), hint = $('#schoolHint');
let items = [], active = -1, requested = null;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function setHint() {
  const v = box.value.trim();
  const hit = resolveSchool(v);
  if (hit) { hint.className = 'hint ok-hint'; hint.textContent = `✓ ${hit}`; }
  else if (requested && requested === v) { hint.className = 'hint pend-hint'; hint.textContent = '목록에 없는 학교예요. 등록 요청으로 시작하고, 승인되면 학교 대항전 점수에 더해져요. (그동안 공부 기록과 학점은 그대로 쌓여요)'; }
  else { hint.className = 'hint'; hint.textContent = '전국 4년제 대학 목록에서 골라요. 줄임말도 돼요.'; }
}
function open(show) {
  list.hidden = !show;
  box.setAttribute('aria-expanded', String(show));
}
function draw() {
  const v = box.value.trim();
  if (!v) { items = []; open(false); return; }
  items = searchSchools(v).map((s) => ({ name: s.name, region: s.region }));
  if (!resolveSchool(v)) items.push({ req: v });
  active = items.length && !items[0].req ? 0 : -1;
  list.innerHTML = items.map((it, i) => it.req
    ? `<li role="option" class="req" data-i="${i}" aria-selected="${i === active}">'${esc(it.req)}' 목록에 없어요 · 등록 요청하기</li>`
    : `<li role="option" data-i="${i}" aria-selected="${i === active}"><span>${esc(it.name)}</span><small>${esc(it.region)}</small></li>`).join('');
  open(true);
}
function choose(i) {
  const it = items[i];
  if (!it) return;
  if (it.req) { requested = it.req; box.value = it.req; }
  else { requested = null; box.value = it.name; }
  open(false);
  setHint();
  preview();
}
box.addEventListener('input', () => { requested = null; draw(); setHint(); preview(); });
box.addEventListener('focus', draw);
box.addEventListener('keydown', (e) => {
  if (list.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && active >= 0) {
    e.preventDefault();
    choose(active);
  } else if (e.key === 'Escape') open(false);
});
list.addEventListener('mousedown', (e) => { const li = e.target.closest('li'); if (li) { e.preventDefault(); choose(+li.dataset.i); } });
box.addEventListener('blur', () => {
  setTimeout(() => open(false), 100);
  const hit = resolveSchool(box.value);
  if (hit) { box.value = hit; setHint(); preview(); }
});
if (st.profile && !resolveSchool(st.profile.school)) requested = st.profile.school;
setHint();
preview();

$('#form').onsubmit = async (e) => {
  e.preventDefault();
  const typed = $('#school').value.trim();
  const school = resolveSchool(typed) || (requested === typed ? typed : '');
  if (typed && !school) { box.focus(); draw(); return ($('#err').textContent = "목록에서 학교를 골라 주세요. 없으면 '등록 요청하기'를 눌러요."); }
  const dept = $('#dept').value.trim();
  const nickname = $('#nick').value.trim();
  if (!school || !nickname) return ($('#err').textContent = '학교와 닉네임을 적어 주세요.');
  $('#submit').disabled = true;
  $('#submit').textContent = '등록 중…';
  const ranking = $('#rank').getAttribute('aria-checked') === 'true';
  const settings = { ...st.settings, ranking, studyMode: true };
  const profile = await register({ ...st, settings }, { school, dept, nickname, ...(st.profile?.userId ? {} : {}) });
  await send({ type: 'set', data: { profile, settings }, sync: true });
  location.href = 'dashboard.html#battle';
};
