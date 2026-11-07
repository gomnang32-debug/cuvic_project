// 4) 확장 프로그램 테스트 — 실제 Chromium에 확장 프로그램을 올리고 탭을 바꿔 가며 측정 결과를 확인
// 공부/딴짓 사이트는 인터넷 대신 가짜 페이지로 응답해서(주소와 제목만 같게) 오프라인에서도 돌아감.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { EXT_DIR, sleep } from './helpers.mjs';

let ctx, sw, ctl, userDir;

/** 가짜 사이트: 요청한 주소에 맞는 제목의 빈 페이지를 돌려줌 */
const TITLES = {
  'www.acmicpc.net': '1000번: A+B',
  'comic.naver.com': '네이버 웹툰',
  'www.youtube.com': '영상 - YouTube',
};

before(async () => {
  userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-ext-'));
  ctx = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium', // 새 헤드리스 모드: 확장 프로그램을 화면 없이 실행 가능
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  await ctx.route(/^https:\/\/(www\.acmicpc\.net|comic\.naver\.com|www\.youtube\.com)\//, (route) => {
    const u = new URL(route.request().url());
    const title = u.searchParams.get('title') || TITLES[u.hostname] || u.hostname;
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><title>${title}</title><p>${title}</p>` });
  });
  sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  const id = new URL(sw.url()).host;
  // 확장 프로그램에 메시지를 보낼 창구로 설정 페이지를 열어 둠
  ctl = await ctx.newPage();
  await ctl.goto(`chrome-extension://${id}/options.html`);
});
after(async () => {
  await ctx?.close();
  if (userDir) fs.rmSync(userDir, { recursive: true, force: true });
});

const send = (msg) => ctl.evaluate((m) => chrome.runtime.sendMessage(m), msg);
const status = () => send({ type: 'status', refresh: true });

/** 새 탭에서 사이트를 열고 그 탭을 '보고 있는 탭'으로 만듦 */
async function visit(url) {
  const p = await ctx.newPage();
  await p.goto(url);
  await p.bringToFront();
  await sleep(600); // 탭 전환 이벤트가 처리될 시간
  return p;
}

test('공부 모드를 켜기 전에는 시간을 재지 않음', async () => {
  const p = await visit('https://www.acmicpc.net/problem/1000');
  await sleep(2500);
  const s = await status();
  assert.equal(s.state, 'off');
  assert.equal(s.today.focusSec, 0);
  await p.close();
});

test('FR2·FR3 공부 사이트(백준)에 있는 동안 순공 시간이 쌓임', async () => {
  await send({ type: 'toggle', on: true });
  const p = await visit('https://www.acmicpc.net/problem/1000');
  const t0 = (await status()).today.focusSec;
  await sleep(4000);
  const s = await status();
  assert.equal(s.state, 'study');
  assert.equal(s.tab.source, '기본 규칙 목록');
  assert.ok(s.today.focusSec - t0 >= 3, `4초 동안 ${s.today.focusSec - t0}초만 쌓임`);
  await p.close();
});

test('FR3 딴짓 사이트(웹툰)로 넘어가면 시간이 멈춤', async () => {
  const p = await visit('https://comic.naver.com/webtoon');
  const t0 = (await status()).today.focusSec;
  await sleep(3000);
  const s = await status();
  assert.equal(s.state, 'distract');
  assert.ok(s.today.focusSec - t0 < 1, `딴짓 탭에서 ${s.today.focusSec - t0}초가 쌓임`);
  await p.close();
});

test('FR2 같은 유튜브라도 제목으로 강의(공부)와 예능(딴짓)을 나눔', async () => {
  const lecture = await visit('https://www.youtube.com/watch?v=1&title=' + encodeURIComponent('[자료구조] 7강 힙 정렬 강의 - YouTube'));
  assert.equal((await status()).tab.kind, 'study');
  await lecture.close();
  const fun = await visit('https://www.youtube.com/watch?v=2&title=' + encodeURIComponent('예능 하이라이트 모음 - YouTube'));
  assert.equal((await status()).tab.kind, 'distract');
  await fun.close();
});

test('FR2 정정: 딴짓으로 판별된 탭을 "이건 공부야"로 고치면 바로 공부로 잼', async () => {
  const p = await visit('https://www.youtube.com/watch?v=3&title=' + encodeURIComponent('리액션 영상 - YouTube'));
  assert.equal((await status()).tab.kind, 'distract');
  const s1 = await send({ type: 'correct', as: 'study' });
  assert.equal(s1.tab.kind, 'study');
  assert.equal(s1.tab.source, '정정 기억');
  const t0 = s1.today.focusSec;
  await sleep(3000);
  const s2 = await status();
  assert.ok(s2.today.focusSec - t0 >= 2, '정정한 뒤에도 시간이 쌓이지 않음');
  await p.close();
});

test('FR4 딴짓 탭에 30초 넘게 머물면 이탈 1회로 기록', { timeout: 60_000 }, async () => {
  const before = (await status()).today.distractions;
  const p = await visit('https://comic.naver.com/webtoon?v=2');
  await sleep(31_500);
  const s = await status();
  assert.equal(s.today.distractions - before, 1);
  assert.ok(s.distractSec >= 30);
  await p.close();
});

test('공부 모드를 끄면 공부 사이트에서도 멈춤', async () => {
  await send({ type: 'toggle', on: false });
  const p = await visit('https://www.acmicpc.net/');
  const t0 = (await status()).today.focusSec;
  await sleep(2500);
  const s = await status();
  assert.equal(s.state, 'off');
  assert.ok(s.today.focusSec - t0 < 1);
  await p.close();
});

/** 가짜 로컬 사이트를 열고, 확장 프로그램 연결 스크립트가 보내 주는 메시지를 모음 */
async function openLocal(origin) {
  await ctx.route(origin + '/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>로컬 페이지</title>' }));
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.__got = [];
    window.addEventListener('message', (e) => { if (e.data?.source === 'build-ext') window.__got.push(e.data); });
  });
  await p.goto(origin + '/');
  return p;
}

test('보안: 다른 포트의 로컬 페이지에는 연결 스크립트가 들어가지 않아 계정을 바꿀 수 없음', async () => {
  const before = (await status()).profile;
  const p = await openLocal('http://localhost:5173');
  assert.equal(await p.evaluate(() => document.documentElement.dataset.buildExt), undefined);
  await p.evaluate(() => window.postMessage({ source: 'build-site', type: 'link', account: { token: 'evil', userId: 'evil', school: '해킹대학교', nickname: 'x' } }, location.origin));
  await sleep(800);
  assert.deepEqual((await status()).profile, before);
  await p.close();
});

test('보안: 사이트로 보내는 상태에는 API 키·토큰 같은 설정이 들어 있지 않음', async () => {
  await send({ type: 'set', data: { settings: { ...(await send({ type: 'state' })).settings, aiKey: 'sk-ant-secret' } } });
  const p = await openLocal('http://localhost:8787');
  await sleep(2500);
  const got = await p.evaluate(() => window.__got);
  assert.ok(got.some((m) => m.type === 'status'), '연결 스크립트 상태를 받지 못함');
  const text = JSON.stringify(got);
  assert.ok(!text.includes('sk-ant-secret'), 'API 키가 페이지로 나감');
  await send({ type: 'set', data: { settings: { ...(await send({ type: 'state' })).settings, aiKey: '' } } });
  await p.close();
});

test('보안: 서버 주소를 배포 주소로 바꾸면 로컬 8787 페이지는 더 이상 믿지 않음', async () => {
  const st = await send({ type: 'state' });
  await send({ type: 'set', data: { settings: { ...st.settings, serverUrl: 'https://build.example.com' } } });
  try {
    const p = await openLocal('http://localhost:8787');
    await sleep(2500);
    const got = await p.evaluate(() => window.__got);
    assert.equal(got.filter((m) => m.type === 'status').length, 0, '배포 주소로 바꿨는데 로컬 페이지가 상태를 받음');
    await p.close();
  } finally {
    await send({ type: 'set', data: { settings: { ...st.settings } } });
  }
});
