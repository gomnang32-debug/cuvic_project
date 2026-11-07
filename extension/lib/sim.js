// 학교 대항전 리그 계산 — 서버와 확장(오프라인 모드)이 같은 코드를 씀.
// demo=true 면 다른 학교 학생들의 공부를 시간대별 곡선으로 시뮬레이션해서 섞어요(발표·혼자 테스트용).
import { hash, rng, parseKey } from './util.js';

export const SCHOOLS = [
  '충북대학교', '충남대학교', '서울대학교', '연세대학교', '고려대학교', 'KAIST', '포항공과대학교', '성균관대학교',
  '한양대학교', '중앙대학교', '경희대학교', '서강대학교', '이화여자대학교', '한국외국어대학교', '건국대학교',
  '동국대학교', '홍익대학교', '숙명여자대학교', '국민대학교', '숭실대학교', '세종대학교', '광운대학교', '아주대학교',
  '인하대학교', '단국대학교', '부산대학교', '경북대학교', '전남대학교', '전북대학교', '강원대학교', '제주대학교',
  '울산대학교', '영남대학교', '계명대학교', '한밭대학교', '청주대학교', '서원대학교', '한국교원대학교',
  '한국기술교육대학교', '서울시립대학교', '인천대학교', '가천대학교', '한림대학교', '순천향대학교', '조선대학교',
];

export const DEPTS = [
  '소프트웨어학부', '컴퓨터공학과', '전자공학과', '정보통신공학과', '기계공학과', '화학공학과', '산업공학과',
  '건축학과', '수학과', '물리학과', '화학과', '생명과학과', '경영학과', '경제학과', '행정학과', '심리학과',
  '국어국문학과', '영어영문학과', '교육학과', '간호학과', '의예과', '약학과', '디자인학과', '기타',
];

const NICKS = [
  '밤샘코더', '도서관지박령', '과제요정', '학점사냥꾼', '열공중독', '커피수혈중', '새벽세시', '중간고사생존자',
  '시험기계', '코딩하는감자', '공대생', '열람실붙박이', 'A+수집가', '포인터헌터', '재수강은없다', '노트필기장인',
  '스터디장', '복습왕', '기출광', '타자의신', '조용한공부벌레', '마감요정', '논문읽는밤', '수학은사랑',
];

// 시간대별 공부 활동 비중 (0시~23시)
const CURVE = [0.35, 0.2, 0.1, 0.05, 0.03, 0.04, 0.12, 0.3, 0.6, 1.0, 1.3, 1.35, 0.9, 1.1, 1.45, 1.6, 1.5, 1.15, 0.9, 1.25, 1.7, 1.85, 1.6, 0.9];
const CSUM = CURVE.reduce((a, b) => a + b, 0);

function todHours(date, now) {
  return Math.min(24, Math.max(0, (now - parseKey(date).getTime()) / 3600000));
}
/** 0시부터 t시까지 누적 비율 (0~1) */
function cumFrac(t) {
  const h = Math.floor(t);
  let s = 0;
  for (let i = 0; i < Math.min(h, 24); i++) s += CURVE[i];
  if (h < 24) s += CURVE[h] * (t - h);
  return s / CSUM;
}

export function simSchool(name, date, now) {
  const seed = hash(name);
  const r = rng(hash(name + '|' + date));
  const members = 60 + (seed % 820);
  const avgMin = 105 + ((seed >>> 10) % 70) + (r() * 50 - 25); // 하루 1인 평균 순공(분)
  const t = todHours(date, now);
  const f = cumFrac(t);
  const score = Math.round(members * avgMin * f);
  const minute = Math.floor(now / 60000);
  const jitter = 0.8 + rng(hash(name + '|' + minute))() * 0.4;
  const h = Math.min(23, Math.floor(t));
  // 점수가 분당 '공부 중 인원'만큼 오르도록 맞춤 (1인 1분 = 1점)
  const studying = t >= 24 ? 0 : Math.round(((members * avgMin * CURVE[h]) / (CSUM * 60)) * jitter);
  return { name, members, score, studying, demo: true };
}

function simDepts(school, date, now) {
  const r = rng(hash('dept|' + school));
  const picked = [...DEPTS.slice(0, -1)].sort(() => r() - 0.5).slice(0, 7);
  const f = cumFrac(todHours(date, now));
  return picked.map((name) => {
    const rr = rng(hash(school + '|' + name + '|' + date));
    return { name, members: 8 + Math.floor(rr() * 90), avgMin: (90 + rr() * 140) * f, demo: true };
  });
}

function simUsers(school, date, now, n = 6) {
  const f = cumFrac(todHours(date, now));
  const r = rng(hash('users|' + school + '|' + date));
  return Array.from({ length: n }, (_, i) => ({
    nickname: NICKS[Math.floor(r() * NICKS.length)],
    dept: DEPTS[Math.floor(r() * (DEPTS.length - 1))],
    score: Math.round((380 - i * 40 + r() * 60) * f),
    demo: true,
  }));
}

function simEvents(date, now, names) {
  const out = [];
  const curMin = Math.floor(now / 60000);
  const day0 = parseKey(date).getTime();
  for (let m = curMin; m > curMin - 40 && out.length < 14; m--) {
    const r = rng(hash(date + '|ev|' + m));
    const count = r() < 0.55 ? 1 : r() < 0.3 ? 2 : 0;
    for (let i = 0; i < count; i++) {
      const t = m * 60000 + Math.floor(r() * 60000);
      if (t > now || t < day0) continue;
      const school = names[Math.floor(r() * names.length)];
      const nick = NICKS[Math.floor(r() * NICKS.length)];
      const kind = r();
      const text = kind < 0.55 ? `${nick}님이 25분 집중 콤보 달성 · +5점`
        : kind < 0.8 ? `${nick}님이 오늘 목표 시간을 채웠어요`
          : `${nick}님이 공부 모드를 켰어요`;
      out.push({ t, school, text, demo: true });
    }
  }
  return out.sort((a, b) => b.t - a.t);
}

/** 사용자 1명의 오늘 점수: 순공 1분 = 1점, 25분 연속 집중 콤보마다 +5점 */
export const userScore = (focusSec, combos) => Math.floor(focusSec / 60) + (combos || 0) * 5;

/**
 * @param {{date:string, now:number, demo?:boolean, real?:Array, school?:string, dept?:string, userId?:string, events?:Array}} o
 */
export function buildLeague({ date, now, demo = true, real = [], school, dept, userId, events = [] }) {
  const map = new Map();
  if (demo) for (const n of SCHOOLS) map.set(n, simSchool(n, date, now));
  for (const u of real) {
    if (u.counts === false) continue; // 학교 총점에 아직 반영하지 않는 계정 (서버 MIN_ACCOUNT_AGE_HOURS)
    let s = map.get(u.school);
    if (!s) map.set(u.school, (s = { name: u.school, members: 0, score: 0, studying: 0, demo: false }));
    s.members += 1;
    s.score += u.score;
    if (u.studying) s.studying += 1;
  }
  if (school && !map.has(school)) map.set(school, { name: school, members: 0, score: 0, studying: 0 });
  const schools = [...map.values()].map((s) => ({ ...s, avg: s.members ? s.score / s.members : 0, me: s.name === school }));

  let depts = [], users = [];
  if (school) {
    const dm = new Map();
    if (demo && SCHOOLS.includes(school)) for (const d of simDepts(school, date, now)) dm.set(d.name, { ...d, total: d.avgMin * d.members });
    for (const u of real.filter((x) => x.school === school && x.dept)) {
      let d = dm.get(u.dept);
      if (!d) dm.set(u.dept, (d = { name: u.dept, members: 0, total: 0 }));
      d.members += 1;
      d.total += u.focusSec / 60;
    }
    depts = [...dm.values()].map((d) => ({ name: d.name, members: d.members, avgMin: d.members ? d.total / d.members : 0, me: !!dept && d.name === dept }))
      .sort((a, b) => b.avgMin - a.avgMin);
    users = [
      ...(demo && SCHOOLS.includes(school) ? simUsers(school, date, now) : []),
      ...real.filter((x) => x.school === school).map((u) => ({ nickname: u.nickname, dept: u.dept || '', score: u.score, me: u.id === userId, studying: !!u.studying })),
    ].sort((a, b) => b.score - a.score).slice(0, 10);
  }

  const evs = [...events, ...(demo ? simEvents(date, now, [...map.keys()]) : [])].sort((a, b) => b.t - a.t).slice(0, 20);
  return { date, serverTime: now, demo, schools, depts, users, events: evs };
}

/** 정렬 + 순위 */
export function ranked(schools, by = 'score') {
  return [...schools].sort((a, b) => b[by] - a[by] || a.name.localeCompare(b.name)).map((s, i) => ({ ...s, rank: i + 1 }));
}
