// 3) 웹 타이머 테스트 — 실제 브라우저(Chromium)로 사이트를 열고 가입 → 측정 → 탭 이탈을 확인
// 시간은 Playwright의 가짜 시계(page.clock)로 빨리 감아서 몇 초 만에 끝냄.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, api, todayKey } from './helpers.mjs';

let srv, browser;
before(async () => {
  srv = await startServer({ demo: false });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await srv?.stop();
});

/** 사이트를 열고 화면에서 직접 가입 (가입하면 바로 공부가 시작됨) */
async function openAndJoin(nick) {
  const page = await browser.newPage();
  // 이 탭이 '보고 있는 탭'인지 여부를 테스트에서 조절할 수 있게 함 (실제 탭 전환 대신)
  await page.addInitScript(() => {
    window.__focus = true;
    document.hasFocus = () => window.__focus;
  });
  await page.clock.install();
  await page.goto(srv.url);
  await page.fill('#school', '충북대');
  await page.press('#school', 'Tab'); // 칸을 벗어나면 공식 이름으로 바뀜
  await page.fill('#nick', nick);
  await page.click('#joinBtn');
  await page.waitForFunction(() => document.querySelector('#go')?.textContent === '공부 멈추기');
  return page;
}
const days = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('build-web-days') || '{}'));
const todayOf = async (page) => {
  const all = await days(page);
  return Object.values(all)[0] || { focusSec: 0, distractions: 0 };
};
/** 탭을 벗어남 / 돌아옴 흉내 */
const leave = (page) => page.evaluate(() => { window.__focus = false; window.dispatchEvent(new Event('blur')); });
const back = (page) => page.evaluate(() => { window.__focus = true; window.dispatchEvent(new Event('focus')); });

test('FR3 웹 타이머: 가입 후 이 탭을 보고 있는 동안 순공 시간이 쌓임', async () => {
  const page = await openAndJoin('웹측정');
  await page.clock.runFor(20_000);
  const d = await todayOf(page);
  assert.ok(d.focusSec >= 15 && d.focusSec <= 25, `20초 뒤 순공 ${d.focusSec}초`);
  await page.close();
});

test('FR3 웹 타이머: 다른 탭·창으로 가면 멈추고, 돌아오면 다시 흐름', async () => {
  const page = await openAndJoin('웹이탈');
  await page.clock.runFor(10_000);
  const t1 = (await todayOf(page)).focusSec;
  await leave(page);
  await page.clock.runFor(20_000); // 20초 동안 다른 곳에 있음
  const t2 = (await todayOf(page)).focusSec;
  assert.ok(t2 - t1 <= 1, `벗어난 동안에도 ${t2 - t1}초가 쌓임`);
  await back(page);
  await page.clock.runFor(10_000);
  const t3 = (await todayOf(page)).focusSec;
  assert.ok(t3 - t2 >= 8, `돌아온 뒤 ${t3 - t2}초만 쌓임`);
  await page.close();
});

test('FR4 웹 타이머: 30초 넘게 벗어나면 이탈 1회, 30초 미만은 이탈 아님', async () => {
  const page = await openAndJoin('웹30초');
  await page.clock.runFor(3_000);
  await leave(page);
  await page.clock.runFor(10_000);
  await back(page);
  await page.clock.runFor(6_000);
  assert.equal((await todayOf(page)).distractions, 0, '10초 이탈이 이탈로 잡힘');
  await leave(page);
  await page.clock.runFor(31_000);
  await back(page);
  await page.clock.runFor(6_000);
  assert.equal((await todayOf(page)).distractions, 1, '31초 이탈이 이탈로 안 잡힘');
  await page.close();
});

test('FR4 웹 타이머: 25분 동안 입력이 없으면 "아직 공부 중인가요?"를 묻고, 5분 답이 없으면 멈춤', async () => {
  const page = await openAndJoin('웹자리비움');
  await page.clock.runFor(25 * 60_000 + 2_000);
  await assert.doesNotReject(page.waitForSelector('#modal:not([hidden]) >> text=아직 공부 중인가요?', { timeout: 3000 }));
  const before = (await todayOf(page)).focusSec;
  await page.clock.runFor(5 * 60_000 + 2_000);
  assert.equal(await page.textContent('#go'), '공부 시작', '5분 뒤에도 멈추지 않음');
  const afterSec = (await todayOf(page)).focusSec;
  assert.ok(afterSec - before <= 2, `물어보는 동안에도 ${afterSec - before}초가 쌓임`);
  await page.close();
});

test('FR6 웹 타이머: 공부한 시간이 서버(학교 대항전)에 보고됨', async () => {
  const page = await openAndJoin('웹보고');
  await page.clock.runFor(35_000); // 30초마다 서버로 보고
  const acc = await page.evaluate(() => JSON.parse(localStorage.getItem('build-account')));
  // 서버 쪽 기록이 생길 때까지 잠깐 기다림 (실제 네트워크 요청)
  let d;
  for (let i = 0; i < 20 && !(d?.focusSec > 0); i++) {
    d = (await api(srv.url, '/api/me', { userId: acc.userId, token: acc.token })).json.days?.[todayKey()];
    if (!(d?.focusSec > 0)) await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(d && d.focusSec > 0, '서버에 오늘 기록이 없음');
  assert.equal(acc.school, '충북대학교');
  await page.close();
});
