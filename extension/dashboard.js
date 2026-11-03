import { createDash, VIEW_TITLES } from './lib/dash-core.js';
import * as api from './lib/api.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const send = (m) => chrome.runtime.sendMessage(m);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let ST = null, S = null, LG = null;
const dash = createDash({
  root: $('#view'),
  smashEl: $('#smash'),
  settingsHref: 'options.html#account',
  startLabel: '공부 모드 켜고 참전하기',
  comboHint: '공부 탭에서 25분 연속',
  onStart: async () => { await send({ type: 'toggle', on: true }); await refresh(true); },
});

async function loadAll(withLeague) {
  [ST, S] = await Promise.all([send({ type: 'state' }), send({ type: 'status' })]);
  if (!ST.profile) return (location.href = 'onboarding.html');
  if (withLeague) LG = await api.getLeague(ST, S.state === 'study');
  else LG ||= ST.league;
  dash.setData({ ST, S, LG });
}

function header(view) {
  const p = ST.profile;
  $('#who').innerHTML = `<span class="av">${esc(p.nickname[0])}</span><b>${esc(p.nickname)}</b><span class="muted">· ${esc(p.school)}${p.dept ? ' ' + esc(p.dept) : ''}</span>`;
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === view));
  document.title = VIEW_TITLES[view] + ' · BUILD 대학교';
  const site = $('#siteLink');
  if (site) site.href = ST.settings.serverUrl;
}

function currentView() {
  const v = (location.hash || '#me').slice(1);
  return ['me', 'battle', 'campus'].includes(v) ? v : 'me';
}
function render() {
  if (!ST) return;
  header(currentView());
  dash.render(currentView());
}
async function refresh(withLeague) {
  await loadAll(withLeague);
  render();
  dash.checkSmash();
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
await send({ type: 'syncNow' }).catch(() => {});
await refresh(true);
setInterval(() => dash.tick(), 1000);
setInterval(() => refresh(true), 6000);
