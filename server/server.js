// BUILD 대학교 — 학교 대항전 서버 (Node 18+, 외부 패키지 없음)
//   실행:  node server/server.js        (기본 포트 8787)
//   옵션:  --lan(같은 와이파이 친구와 대결)  --reset(모든 점수·가입 기록 지우고 시작)
//          PORT=8787  DEMO=0(데모 학교 끄기)
//   사이트:  http://localhost:8787   (공부 타이머 · 내 기록 · 대항전 · 캠퍼스)
//   학교 등록 요청 관리: http://localhost:8787/admin  (이 PC에서만, 또는 ADMIN_KEY 설정 시 /admin?key=…)
//   인터넷 배포: HOST=0.0.0.0, PORT=(호스팅이 정함), DATA_DIR=(영구 디스크 경로), ADMIN_KEY=(관리 비밀번호)
//   조작 방지: TRUST_PROXY=1(프록시 뒤), REGISTER_LIMIT=20, DAY_CAP_HOURS=16, MIN_ACCOUNT_AGE_HOURS=0 (README 참고)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildLeague, ranked, userScore, SCHOOLS, DEPTS } from '../extension/lib/sim.js';
import { dateKey, kstMidnight } from '../extension/lib/util.js';
import { resolveSchool, norm } from '../extension/lib/schools.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || (process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1');
const DEMO = process.env.DEMO !== '0';
const DB_FILE = path.join(process.env.DATA_DIR || path.join(DIR, 'data'), 'db.json');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // Render처럼 프록시 뒤에서 돌 때만 x-forwarded-for를 믿음
const REGISTER_LIMIT = Number(process.env.REGISTER_LIMIT || 20); // IP 하나당 1시간에 가입 가능한 계정 수
const DAY_CAP = Number(process.env.DAY_CAP_HOURS || 16) * 3600; // 1인 하루 순공 상한 (사람이 실제로 할 수 있는 만큼)
// 가입 후 이 시간이 지난 계정만 학교 총점에 더함 (0이면 바로 반영). 계정을 잔뜩 만들어 학교 점수를 올리는 것을 막음.
// 대회 시연처럼 가입하자마자 학교 점수에 들어가야 할 때는 0으로 두고, 실제 운영 때 24 정도로 켬
const MIN_ACCOUNT_AGE = Number(process.env.MIN_ACCOUNT_AGE_HOURS || 0) * 3600 * 1000;
const ROOT = path.join(DIR, '..');
const STATIC = [
  // [URL 접두어, 실제 폴더]  — 사이트는 확장 프로그램과 같은 라이브러리·스타일을 그대로 씀
  ['/app/', path.join(DIR, 'public', 'app')],
  ['/lib/', path.join(ROOT, 'extension', 'lib')],
  ['/styles/', path.join(ROOT, 'extension', 'styles')],
  ['/icons/', path.join(ROOT, 'extension', 'icons')],
];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon' };

// ---------- 저장소 (JSON 파일) ----------
// 사용자 ID·학교 이름처럼 밖에서 들어온 문자열을 키로 쓰는 객체는 프로토타입 없는 객체로 둠
// ('__proto__'·'constructor' 같은 키로 Object.prototype을 건드리지 못하게)
const dict = (o = {}) => Object.assign(Object.create(null), o);
const own = (o, k) => typeof k === 'string' && Object.hasOwn(o, k);
const EMPTY = () => ({ users: dict(), days: dict(), events: dict(), ranks: dict(), schools: { approved: dict(), requests: dict() } });
let db = EMPTY();
if (process.argv.includes('--reset')) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db));
  console.log('  기록을 모두 지웠어요 (--reset)');
}
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
} catch {}
db.schools ||= {};
for (const k of ['users', 'days', 'events', 'ranks']) db[k] = dict(db[k]);
for (const k of Object.keys(db.days)) db.days[k] = dict(db.days[k]);
db.schools.approved = dict(db.schools.approved);
db.schools.requests = dict(db.schools.requests);
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
  }, 500);
}

const clean = (s, n = 30) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const AUTO_APPROVE = 3; // 같은 학교를 3명이 요청하면 자동 승인

// ---------- 학교 확인 ----------
/** 목록에 있으면 공식 이름, 승인된 학교면 그 이름, 아니면 입력 그대로 */
function canonicalSchool(input) {
  const name = clean(input);
  const hit = resolveSchool(name);
  if (hit) return hit;
  const ap = Object.keys(db.schools.approved).find((n) => norm(n) === norm(name));
  return ap || name;
}
function schoolStatus(name) {
  if (resolveSchool(name) || db.schools.approved[name]) return 'ok';
  const rq = db.schools.requests[norm(name)];
  return rq?.status === 'rejected' ? 'rejected' : 'pending';
}
function requestSchool(name, userId) {
  if (schoolStatus(name) === 'ok') return;
  const k = norm(name);
  const rq = (db.schools.requests[k] ||= { name, users: [], ts: Date.now(), status: 'pending' });
  if (!rq.users.includes(userId)) rq.users.push(userId);
  if (rq.status === 'pending' && rq.users.length >= AUTO_APPROVE) approveSchool(k, '사용자 3명 요청');
}
function approveSchool(k, by) {
  const rq = db.schools.requests[k];
  if (!rq) return;
  rq.status = 'approved';
  db.schools.approved[rq.name] = { by, ts: Date.now() };
}

const STUDYING_TTL = 2.5 * 60 * 1000; // 2.5분 동안 소식 없으면 '공부 중'에서 빠짐

function realUsers(date, now) {
  const day = db.days[date] || {};
  return Object.entries(day)
    .filter(([id]) => db.users[id] && db.users[id].ranking !== false && schoolStatus(db.users[id].school) === 'ok')
    .map(([id, d]) => {
      const u = db.users[id];
      const counts = now - (u.createdAt || 0) >= MIN_ACCOUNT_AGE; // false면 순위 목록에는 보이지만 학교 총점에는 안 들어감
      return { id, school: u.school, dept: u.dept, nickname: u.nickname, focusSec: d.focusSec, score: userScore(d.focusSec, d.combos), studying: d.studying && now - d.lastSeen < STUDYING_TTL, counts };
    });
}

function pushEvent(date, school, text) {
  (db.events[date] ||= []).unshift({ t: Date.now(), school, text });
  db.events[date].length = Math.min(db.events[date].length, 50);
}

function league(date, q = {}) {
  const now = Date.now();
  const u = own(db.users, q.userId) ? db.users[q.userId] : null;
  const school = u ? u.school : q.school && canonicalSchool(q.school);
  const status = school ? schoolStatus(school) : null;
  const lg = buildLeague({ date, now, demo: DEMO, real: realUsers(date, now), school: status === 'ok' ? school : undefined, dept: u ? u.dept : q.dept, userId: q.userId, events: db.events[date] || [] });
  return { ...lg, me: school ? { school, schoolStatus: status } : null };
}

/** 순위가 오른 학교가 있으면 '부쉈다' 소식 */
function checkOvertakes(date) {
  const r = ranked(league(date).schools);
  const prev = db.ranks[date] || {};
  const realSchools = new Set(realUsers(date, Date.now()).map((u) => u.school));
  for (const s of r) {
    const before = prev[s.name];
    if (before && s.rank < before && realSchools.has(s.name)) {
      const beaten = r[s.rank]; // 바로 아래로 밀린 학교
      pushEvent(date, s.name, `${beaten ? beaten.name + ' 벽을 부수고 ' : ''}${s.rank}위로 올라섰어요`);
    }
  }
  db.ranks = { [date]: Object.fromEntries(r.map((s) => [s.name, s.rank])) };
}

// ---------- HTTP ----------
function sendJSON(res, code, obj) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
}
function auth(b) {
  if (!own(db.users, b.userId) || typeof b.token !== 'string') return null;
  const u = db.users[b.userId];
  const a = Buffer.from(String(u.token)), t = Buffer.from(b.token);
  return a.length === t.length && crypto.timingSafeEqual(a, t) ? u : null;
}

// ---------- 가입 횟수 제한 (계정을 잔뜩 만들어 학교 점수를 올리는 것 방지) ----------
const joins = new Map(); // ip → [가입 시각…]
function joinAllowed(ip, now = Date.now()) {
  const recent = (joins.get(ip) || []).filter((t) => now - t < 3600 * 1000);
  if (recent.length >= REGISTER_LIMIT) {
    joins.set(ip, recent);
    return false;
  }
  recent.push(now);
  joins.set(ip, recent);
  return true;
}
// 1시간 넘게 가입이 없는 IP는 지워서 목록이 끝없이 커지지 않게 함
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of joins) if (!ts.some((t) => now - t < 3600 * 1000)) joins.delete(ip);
}, 10 * 60 * 1000).unref();
function clientIp(req) {
  // x-forwarded-for의 앞쪽 값은 접속한 사람이 마음대로 적을 수 있음. 믿을 수 있는 건 프록시(Render)가 붙인 맨 마지막 값뿐
  const xff = TRUST_PROXY && req.headers['x-forwarded-for'];
  if (xff) {
    const last = String(xff).split(',').map((s) => s.trim()).filter(Boolean).at(-1);
    if (last) return last;
  }
  return req.socket.remoteAddress || '?';
}

// ---------- 기록 상한 ----------
// 늘어난 측정 시간은 '그 출처의 지난 보고 이후 실제로 흐른 시간'까지만 인정. 통신 지연을 감안한 여유(GRACE)는
// 요청마다 새로 생기지 않고 잔고처럼 쓰면 줄고, 흐른 시간의 10%씩만 다시 찬다.
// (예전에는 요청마다 +90초가 붙어서 1초에 한 번 보내면 1초에 91초씩 늘릴 수 있었음)
const GRACE = 90;

const routes = {
  'GET /api/health': () => ({ ok: true, demo: DEMO, users: Object.keys(db.users).length }),
  'GET /api/schools': () => ({ schools: SCHOOLS, depts: DEPTS }),

  'POST /api/register': (b, _q, req) => {
    if (!joinAllowed(clientIp(req))) return [429, { error: '가입 요청이 너무 많아요. 잠시 뒤에 다시 해 주세요' }];
    const school = canonicalSchool(b.school), dept = clean(b.dept), nickname = clean(b.nickname, 12);
    if (!school || !nickname) return [400, { error: '학교와 닉네임이 필요해요' }];
    const userId = crypto.randomUUID();
    const token = crypto.randomBytes(18).toString('hex');
    db.users[userId] = { token, school, dept, nickname, ranking: true, createdAt: Date.now() };
    requestSchool(school, userId);
    save();
    return { userId, token, school, schoolStatus: schoolStatus(school) };
  },

  'POST /api/profile': (b) => {
    const u = auth(b);
    if (!u) return [401, { error: 'auth' }];
    if (b.school) u.school = canonicalSchool(b.school);
    requestSchool(u.school, b.userId);
    if ('dept' in b) u.dept = clean(b.dept);
    u.nickname = clean(b.nickname, 12) || u.nickname;
    if ('ranking' in b) u.ranking = !!b.ranking;
    save();
    return { ok: true, school: u.school, schoolStatus: schoolStatus(u.school) };
  },

  'POST /api/delete': (b) => {
    if (!auth(b)) return [401, { error: 'auth' }];
    delete db.users[b.userId];
    for (const d of Object.values(db.days)) delete d[b.userId];
    save();
    return { ok: true };
  },

  'POST /api/heartbeat': (b) => {
    const u = auth(b);
    if (!u) return [401, { error: 'auth' }];
    const now = Date.now();
    const date = dateKey(now);
    if (b.date !== date) return { ok: true, ignored: 'date' }; // 지난 날짜는 받지 않음
    const day = (db.days[date] ||= dict());
    // 오늘 첫 보고면 (한국 시간) 자정 이후 흐른 시간까지 인정 (서버가 꺼져 있던 동안의 공부도 반영)
    // 단, 가입하기 전 시간은 인정하지 않음
    const start = Math.max(kstMidnight(now), u.createdAt || 0);
    const old = day[b.userId];
    const prev = old || { focusSec: 0, awaySec: 0, combos: 0, distractions: 0, lastSeen: start, studying: false };
    const num = (x) => Math.max(0, Number(x) || 0);
    const via = b.via === 'ext' ? 'ext' : 'web';
    // 기록은 측정한 곳(확장 프로그램 / 사이트)별로 따로 둠. 예전 형식(출처 구분 없음)은 그때의 출처 하나로 옮김.
    // 출처마다: 측정한 총시간(gross) = 순공 + 자리 비움으로 뺀 시간(away). 둘 다 줄어들지 않는 값이라 상한을 걸 수 있고,
    // 순공 = 총시간 − 뺀 시간 이라서 자리 비움을 나중에 알아채고 뺀 시간도 서버 기록에서 빠짐.
    const src = old?.src
      ? { ...old.src }
      : old ? { [old.via || 'web']: { gross: old.focusSec + (old.awaySec || 0), away: old.awaySec || 0, lastSeen: old.lastSeen, grace: old.grace ?? GRACE } } : {};
    const s0 = src[via] || { gross: 0, away: 0, lastSeen: start, grace: GRACE };
    const elapsed = Math.max(0, now - s0.lastSeen) / 1000;
    const want = Math.min(num(b.focusSec), DAY_CAP) + num(b.awaySec) - s0.gross;
    const inc = Math.max(0, Math.min(want, elapsed + s0.grace));
    const grace = Math.min(GRACE, s0.grace - Math.max(0, inc - elapsed) + elapsed * 0.1);
    const gross = s0.gross + inc;
    src[via] = { gross, away: Math.min(gross, Math.max(s0.away, num(b.awaySec))), lastSeen: now, grace };
    // 오늘 순공 = 출처 중 순공이 가장 큰 쪽. 두 곳이 같은 시간을 재도 더하지 않고, 한쪽에서 뺀 시간이 다른 쪽 기록을 깎지도 않음
    let best = null;
    for (const x of Object.values(src)) {
      const net = Math.min(DAY_CAP, x.gross - x.away);
      if (!best || net > best.net) best = { net, away: x.away };
    }
    const focusSec = best.net, awaySec = best.away;
    // 콤보는 순공으로 가능한 개수까지만 (자리 비움으로 순공이 줄면 그 시간에 쌓인 콤보도 빠짐)
    const combos = Math.min(Math.floor(focusSec / 1500), Math.max(prev.combos, num(b.combos)));
    // 소식은 오늘 최고 콤보 수를 넘을 때만 (자리 비움으로 줄었다가 다시 채운 콤보는 다시 알리지 않음)
    const topCombos = Math.max(prev.topCombos ?? prev.combos, combos);
    if (combos > (prev.topCombos ?? prev.combos)) pushEvent(date, u.school, `${u.nickname}님이 25분 집중 콤보 달성 · +${(combos - (prev.topCombos ?? prev.combos)) * 5}점`);
    if (b.studying && !prev.studying) pushEvent(date, u.school, `${u.nickname}님이 공부 모드를 켰어요`);
    // 시간대별 순공 (0~23시, 초). 합이 순공보다 크면 비율로 줄임
    let hours = Array.isArray(b.hours) && b.hours.length === 24 ? b.hours.map((x) => Math.max(0, Number(x) || 0)) : prev.hours;
    if (hours) {
      const sum = hours.reduce((a, x) => a + x, 0);
      if (sum > focusSec + 60) hours = hours.map((x) => (x * focusSec) / sum);
      hours = hours.map((x) => Math.round(x));
    }
    day[b.userId] = { focusSec, awaySec, combos, topCombos, distractions: Math.max(0, Math.min(999, Number(b.distractions) || 0)), studying: !!b.studying, lastSeen: now, hours, via, src };
    checkOvertakes(date);
    save();
    return { ok: true, score: userScore(focusSec, combos) };
  },

  // ----- 내 계정 (사이트 '내 기록'용) -----
  'POST /api/me': (b) => {
    const u = auth(b);
    if (!u) return [401, { error: 'auth' }];
    const days = {};
    for (const [date, d] of Object.entries(db.days)) {
      const x = d[b.userId];
      if (x) days[date] = { focusSec: x.focusSec, awaySec: x.awaySec || 0, distractions: x.distractions || 0, combos: x.combos || 0, hours: x.hours || new Array(24).fill(0), via: x.via };
    }
    return { profile: { userId: b.userId, school: u.school, dept: u.dept, nickname: u.nickname, ranking: u.ranking !== false, schoolStatus: schoolStatus(u.school) }, days };
  },

  // ----- 학교 등록 요청 관리 (이 PC에서만) -----
  'GET /api/admin/requests': () => ({
    requests: Object.entries(db.schools.requests).map(([key, r]) => ({ key, name: r.name, count: r.users.length, status: r.status, into: r.into, ts: r.ts })).sort((a, b) => b.ts - a.ts),
    approved: Object.keys(db.schools.approved),
  }),
  'POST /api/admin/approve': (b) => { approveSchool(b.key, '관리자'); save(); return { ok: true }; },
  'POST /api/admin/reject': (b) => { const r = db.schools.requests[b.key]; if (r) r.status = 'rejected'; save(); return { ok: true }; },
  'POST /api/admin/merge': (b) => {
    const r = db.schools.requests[b.key];
    const into = resolveSchool(b.into) || (db.schools.approved[b.into] ? b.into : null);
    if (!r || !into) return [400, { error: '합칠 학교를 목록에서 찾지 못했어요' }];
    for (const id of r.users) if (db.users[id]) db.users[id].school = into;
    r.status = 'merged';
    r.into = into;
    save();
    return { ok: true, into };
  },

  'GET /api/league': (_, q) => {
    const d = q.get('date');
    const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : dateKey();
    return league(date, { school: q.get('school') || undefined, dept: q.get('dept') || undefined, userId: q.get('userId') || undefined });
  },
};

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return sendJSON(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return sendJSON(res, 204, {});
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
  const admin = local || (ADMIN_KEY && (url.searchParams.get('key') === ADMIN_KEY || req.headers['x-admin-key'] === ADMIN_KEY));
  if (url.pathname.startsWith('/api/admin') && !admin) return sendJSON(res, 403, { error: '관리 권한이 없어요' });
  const fn = routes[`${req.method} ${url.pathname}`];
  if (fn) {
    try {
      const b = req.method === 'POST' ? await body(req) : {};
      const out = fn(b, url.searchParams, req);
      return Array.isArray(out) ? sendJSON(res, out[0], out[1]) : sendJSON(res, 200, out);
    } catch (e) {
      console.error(e);
      return sendJSON(res, 500, { error: String(e) });
    }
  }
  if (req.method === 'GET' && url.pathname === '/admin') {
    if (!admin) return sendJSON(res, 403, { error: '관리 권한이 없어요' });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(DIR, 'public', 'admin.html')));
  }
  // 실시간 전광판 (발표 화면용)
  if (req.method === 'GET' && url.pathname === '/board') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(DIR, 'public', 'board.html')));
  }
  // 사이트
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    return res.end(fs.readFileSync(path.join(DIR, 'public', 'index.html')));
  }
  if (req.method === 'GET' && url.pathname === '/theme.js') return serveFile(res, path.join(ROOT, 'extension', 'theme.js'));
  if (req.method === 'GET') {
    for (const [prefix, dir] of STATIC) {
      if (!url.pathname.startsWith(prefix)) continue;
      const file = path.normalize(path.join(dir, decodeURIComponent(url.pathname.slice(prefix.length))));
      if (!file.startsWith(dir + path.sep)) break; // 폴더 밖 접근 차단
      return serveFile(res, file);
    }
  }
  sendJSON(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  BUILD 대학교 사이트       http://localhost:${PORT}`);
  console.log(`  실시간 전광판           http://localhost:${PORT}/board`);
  console.log(`  학교 등록 요청 관리      http://localhost:${PORT}/admin`);
  console.log(`  데모 학교 시뮬레이션     ${DEMO ? '켜짐 (끄려면 DEMO=0)' : '꺼짐'}\n`);
});
