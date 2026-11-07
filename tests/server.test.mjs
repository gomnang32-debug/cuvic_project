// 2) 대항전 서버 테스트 — 실제 서버를 임시 기록 폴더로 띄워서 API를 호출
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, todayKey } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer({ demo: false }); });
after(async () => { await srv?.stop(); });

const join = (school, nickname = '테스터', dept = '소프트웨어학부') => api(srv.url, '/api/register', { school, nickname, dept });
const beat = (u, extra) => api(srv.url, '/api/heartbeat', { userId: u.userId, token: u.token, date: todayKey(), combos: 0, distractions: 0, studying: true, ...extra });

test('FR1 가입: 줄임말로 가입해도 공식 학교 이름으로 저장', async () => {
  const r = await join('충북대');
  assert.equal(r.status, 200);
  assert.equal(r.json.school, '충북대학교');
  assert.equal(r.json.schoolStatus, 'ok');
});

test('FR1 가입: 학교·닉네임이 없으면 거부', async () => {
  assert.equal((await join('', '이름')).status, 400);
  assert.equal((await join('충북대학교', '')).status, 400);
});

test('FR1 학교 등록: 목록에 없는 학교는 대기, 3명이 요청하면 자동 승인', async () => {
  const a = await join('테스트예술대학교', '하나');
  assert.equal(a.json.schoolStatus, 'pending');
  await join('테스트예술대학교', '둘');
  const c = await join('테스트예술대학교', '셋');
  assert.equal(c.json.schoolStatus, 'ok');
});

test('기록 조작 방지: 지난 보고 이후 흐른 시간보다 많이 늘릴 수 없음', async () => {
  const u = (await join('충북대학교', '조작시도')).json;
  // 첫 보고: 60초 (자정 이후 흐른 시간 안이라 인정)
  const first = await beat(u, { focusSec: 60 });
  assert.equal(first.status, 200);
  // 바로 10시간이라고 보고 → 지난 보고 이후 몇 초밖에 안 지났으므로 거의 늘지 않아야 함
  const second = await beat(u, { focusSec: 36000, combos: 20 });
  const me = await api(srv.url, '/api/me', { userId: u.userId, token: u.token });
  const d = me.json.days[todayKey()];
  assert.ok(d.focusSec <= 60 + 95, `부풀린 기록이 반영됨: ${d.focusSec}초`);
  // 25분 콤보도 실제 순공 시간보다 많이 인정되지 않음
  assert.equal(d.combos, 0);
  assert.ok(second.json.score <= 2);
});

test('기록 조작 방지: 이미 쌓인 기록은 줄어들지 않음', async () => {
  const u = (await join('충북대학교', '감소시도')).json;
  await beat(u, { focusSec: 60 }); // 가입 직후라 여유 시간(90초) 안에서만 인정됨
  await beat(u, { focusSec: 10 });
  const d = (await api(srv.url, '/api/me', { userId: u.userId, token: u.token })).json.days[todayKey()];
  assert.ok(d.focusSec >= 60);
});

test('인증: 토큰이 틀리면 기록을 받지 않음', async () => {
  const u = (await join('충북대학교', '토큰')).json;
  const r = await beat({ ...u, token: 'wrong' }, { focusSec: 30 });
  assert.equal(r.status, 401);
});

test('지난 날짜 기록은 받지 않음', async () => {
  const u = (await join('충북대학교', '어제')).json;
  const r = await beat(u, { focusSec: 30, date: '2000-01-01' });
  assert.equal(r.json.ignored, 'date');
});

test('FR6 대항전: 점수가 학교 순위에 반영되고, 닉네임·학과만 공개(토큰 비공개)', async () => {
  const u = (await join('충북대학교', '공개확인', '컴퓨터공학과')).json;
  await beat(u, { focusSec: 600 });
  const lg = await api(srv.url, '/api/league?userId=' + u.userId);
  assert.equal(lg.status, 200);
  const text = JSON.stringify(lg.json);
  assert.ok(text.includes('충북대학교'));
  assert.ok(text.includes('공개확인'));
  assert.ok(!text.includes(u.token), '토큰이 공개 응답에 들어 있음');
});

test('비기능: 서버에 방문 기록(주소·제목)을 보내도 저장하지 않음', async () => {
  const u = (await join('충북대학교', '방문기록')).json;
  await beat(u, { focusSec: 30, url: 'https://secret.example.com/page', title: '비밀 제목' });
  const me = await api(srv.url, '/api/me', { userId: u.userId, token: u.token });
  const text = JSON.stringify(me.json);
  assert.ok(!text.includes('secret.example.com') && !text.includes('비밀 제목'));
});

test('보안: userId가 __proto__·constructor여도 토큰 없이 통과하지 못함', async () => {
  for (const userId of ['__proto__', 'constructor', 'toString']) {
    const r = await api(srv.url, '/api/profile', { userId, school: '서울대', nickname: 'pwn' });
    assert.equal(r.status, 401, userId);
  }
  assert.equal({}.school, undefined, 'Object.prototype이 오염됨');
});

test('기록 조작 방지: 가입 전 시간은 인정하지 않음 (첫 보고에 몇 시간을 주장해도 거의 0)', async () => {
  const u = (await join('충북대학교', '새벽가입')).json;
  await beat(u, { focusSec: 5 * 3600 });
  const d = (await api(srv.url, '/api/me', { userId: u.userId, token: u.token })).json.days[todayKey()];
  assert.ok(d.focusSec <= 95, `가입 직후 ${d.focusSec}초가 인정됨`);
});

test('기록 조작 방지: 짧은 간격으로 여러 번 보내도 여유 시간(90초)이 쌓이지 않음', async () => {
  const u = (await join('충북대학교', '연타')).json;
  for (let i = 0; i < 30; i++) await beat(u, { focusSec: 86400 });
  const d = (await api(srv.url, '/api/me', { userId: u.userId, token: u.token })).json.days[todayKey()];
  assert.ok(d.focusSec <= 100, `연타로 ${d.focusSec}초까지 늘어남`);
});

test('KST 기준: 서버가 UTC로 돌아도 한국 날짜로 보낸 기록을 받음', async () => {
  const utc = await startServer({ env: { TZ: 'UTC' } });
  try {
    const u = (await api(utc.url, '/api/register', { school: '충북대', nickname: 'utc' })).json;
    const r = await api(utc.url, '/api/heartbeat', { userId: u.userId, token: u.token, date: todayKey(), focusSec: 30 });
    assert.equal(r.status, 200);
    assert.equal(r.json.ignored, undefined);
  } finally {
    await utc.stop();
  }
});

test('가입 횟수 제한: 한 IP에서 1시간에 정해진 수 이상은 가입 불가', async () => {
  const lim = await startServer({ env: { REGISTER_LIMIT: '2' } });
  try {
    const go = () => api(lim.url, '/api/register', { school: '충북대', nickname: 'x' });
    assert.equal((await go()).status, 200);
    assert.equal((await go()).status, 200);
    assert.equal((await go()).status, 429);
  } finally {
    await lim.stop();
  }
});
