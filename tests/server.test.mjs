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

test('자리 비움: 확장 프로그램이 나중에 뺀 시간(awaySec)은 서버 순공에서도 빠짐', async () => {
  const u = (await join('충북대학교', '자리비움')).json;
  await beat(u, { focusSec: 60, awaySec: 0 });
  // 자리 비움을 알아채고 40초를 뺌: 순공 20 + 뺀 시간 40 (총시간은 그대로 60)
  const r = await beat(u, { focusSec: 20, awaySec: 40 });
  assert.equal(r.status, 200);
  let d = (await api(srv.url, '/api/me', { userId: u.userId, token: u.token })).json.days[todayKey()];
  assert.equal(d.focusSec, 20);
  assert.equal(d.awaySec, 40);
  // 뺀 시간을 0으로 되돌려 보내도 다시 늘지 않음
  await beat(u, { focusSec: 60, awaySec: 0 });
  d = (await api(srv.url, '/api/me', { userId: u.userId, token: u.token })).json.days[todayKey()];
  assert.equal(d.focusSec, 20);
});

test('자리 비움: 뺀 시간을 부풀려도 측정 총시간 상한은 그대로 (순공이 늘지 않음)', async () => {
  const u = (await join('충북대학교', '총시간')).json;
  await beat(u, { focusSec: 60, awaySec: 0 });
  await beat(u, { focusSec: 60, awaySec: 99999 });
  const d = (await api(srv.url, '/api/me', { userId: u.userId, token: u.token })).json.days[todayKey()];
  assert.ok(d.focusSec + d.awaySec <= 60 + 95, `총시간이 ${d.focusSec + d.awaySec}초`);
  assert.ok(d.focusSec <= 60);
});

test('가입 횟수 제한: x-forwarded-for 앞부분을 바꿔도 프록시가 붙인 실제 IP로 셈', async () => {
  const lim = await startServer({ env: { TRUST_PROXY: '1', REGISTER_LIMIT: '2' } });
  try {
    const go = (xff) => fetch(lim.url + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': xff }, body: JSON.stringify({ school: '충북대', nickname: 'x' }) }).then((r) => r.status);
    const codes = [];
    for (let i = 1; i <= 4; i++) codes.push(await go(`10.0.0.${i}, 1.2.3.4`)); // 실제 IP는 마지막 1.2.3.4
    assert.deepEqual(codes, [200, 200, 429, 429]);
    assert.equal(await go('5.6.7.8'), 200, '다른 실제 IP는 따로 셈');
  } finally {
    await lim.stop();
  }
});

test('하루 상한: 1인 하루 순공은 DAY_CAP_HOURS를 넘지 않음', async () => {
  const cap = await startServer({ env: { DAY_CAP_HOURS: '0.01' } }); // 36초
  try {
    const u = (await api(cap.url, '/api/register', { school: '충북대', nickname: 'cap' })).json;
    await api(cap.url, '/api/heartbeat', { userId: u.userId, token: u.token, date: todayKey(), focusSec: 80 });
    const d = (await api(cap.url, '/api/me', { userId: u.userId, token: u.token })).json.days[todayKey()];
    assert.ok(d.focusSec <= 36, `상한을 넘음: ${d.focusSec}초`);
  } finally {
    await cap.stop();
  }
});

test('신규 계정: MIN_ACCOUNT_AGE_HOURS 동안은 순위 목록에만 보이고 학교 총점에는 안 들어감', async () => {
  const s2 = await startServer({ env: { MIN_ACCOUNT_AGE_HOURS: '1' } });
  try {
    const u = (await api(s2.url, '/api/register', { school: '충북대', nickname: '새계정' })).json;
    await api(s2.url, '/api/heartbeat', { userId: u.userId, token: u.token, date: todayKey(), focusSec: 60 });
    const lg = (await api(s2.url, '/api/league?userId=' + u.userId)).json;
    const me = lg.schools.find((x) => x.name === '충북대학교');
    assert.equal(me?.score || 0, 0, '신규 계정 점수가 학교 총점에 들어감');
    assert.ok(lg.users.some((x) => x.nickname === '새계정' && x.score > 0), '순위 목록에 안 보임');
  } finally {
    await s2.stop();
  }
});

test('출처별 기록: 사이트에서 뺀 시간이 확장 프로그램이 잰 순공을 깎지 않음', async () => {
  const u = (await join('충북대학교', '두출처')).json;
  await beat(u, { via: 'ext', focusSec: 60, awaySec: 0 });
  await beat(u, { via: 'web', focusSec: 10, awaySec: 30 });
  const d = (await api(srv.url, '/api/me', { userId: u.userId, token: u.token })).json.days[todayKey()];
  assert.equal(d.focusSec, 60);
  // 두 곳이 같은 시간을 잰 경우에도 더하지 않음
  await beat(u, { via: 'web', focusSec: 60, awaySec: 30 });
  const d2 = (await api(srv.url, '/api/me', { userId: u.userId, token: u.token })).json.days[todayKey()];
  assert.ok(d2.focusSec <= 60 + 2, `두 출처가 더해짐: ${d2.focusSec}초`);
});
