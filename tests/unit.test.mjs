// 1) 핵심 규칙 테스트 — 브라우저 없이 바로 실행 (탭 판별, 학점, 학교 이름, 점수)
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, titleVerdict } from '../extension/lib/rules.js';
import { timeScore, focusScore, gradeOf, finalizedWeeks, gpa } from '../extension/lib/grade.js';
import { resolveSchool } from '../extension/lib/schools.js';
import { userScore } from '../extension/lib/sim.js';
import { dateKey, addDays, weekStart } from '../extension/lib/util.js';

/** classify가 읽는 상태의 최소 모양 */
const st = (over = {}) => ({
  settings: { serverUrl: 'http://localhost:8787', aiKey: '' },
  lists: { study: [], distract: [] },
  overrides: {},
  aiCache: {},
  ...over,
});

test('FR2 판별: 기본 규칙 목록의 공부 사이트·LMS는 공부', () => {
  assert.equal(classify('https://www.acmicpc.net/problem/1000', '1000번: A+B', st()).kind, 'study');
  assert.equal(classify('https://lms.chungbuk.ac.kr/course', '자료구조', st()).kind, 'study');
});

test('FR2 판별: 기본 규칙 목록의 딴짓 사이트는 딴짓', () => {
  const c = classify('https://comic.naver.com/webtoon', '네이버 웹툰', st());
  assert.equal(c.kind, 'distract');
  assert.equal(c.source, '기본 규칙 목록');
});

test('FR2 판별: 애매한 사이트(유튜브)는 제목 키워드로 공부/딴짓을 나눔', () => {
  assert.equal(classify('https://www.youtube.com/watch?v=a', '[자료구조] 7강 힙 정렬 강의 - YouTube', st()).kind, 'study');
  assert.equal(classify('https://www.youtube.com/watch?v=b', '예능 하이라이트 모음 - YouTube', st()).kind, 'distract');
  assert.equal(titleVerdict('그냥 영상'), null);
});

test('FR2 판별 순서: 내 목록 → 정정 기록 → 기본 규칙', () => {
  // 기본 규칙으로는 딴짓인 사이트도 '내 목록'에 공부로 넣으면 공부
  const mine = st({ lists: { study: ['comic.naver.com'], distract: [] } });
  assert.deepEqual([classify('https://comic.naver.com/x', '웹툰', mine).kind, classify('https://comic.naver.com/x', '웹툰', mine).source], ['study', '내 목록']);
  // 정정 기록은 기본 규칙보다 먼저 적용
  const fixed = st({ overrides: { 'acmicpc.net': 'distract' } });
  assert.equal(classify('https://www.acmicpc.net/', '백준', fixed).source, '정정 기억');
  assert.equal(classify('https://www.acmicpc.net/', '백준', fixed).kind, 'distract');
});

test('FR2 판별: BUILD 사이트 자체는 공부도 딴짓도 아님', () => {
  assert.equal(classify('http://localhost:8787/#battle', 'BUILD 대학교', st()).kind, 'neutral');
});

test('FR2 판별: API 키가 있으면 애매한 탭은 AI 판별 대기', () => {
  const c = classify('https://www.youtube.com/watch?v=c', '아무 제목', st({ settings: { serverUrl: 'http://localhost:8787', aiKey: 'sk-test' } }));
  assert.equal(c.kind, 'pending');
  assert.equal(c.needsAI, true);
});

test('FR5 학점: 시간 80점(주 25시간 만점) + 집중도 20점', () => {
  assert.equal(timeScore(25), 80);
  assert.equal(timeScore(50), 80); // 상한
  assert.equal(focusScore(10, 0), 20); // 이탈 없음 → 만점
  assert.ok(focusScore(10, 30) < focusScore(10, 5)); // 이탈이 많을수록 낮음
  assert.equal(gradeOf(95).grade, 'A+');
  assert.equal(gradeOf(90).grade, 'A0');
  assert.equal(gradeOf(59).grade, 'F');
});

test('FR5 학점: 주 5시간 미만이면 집중도와 상관없이 F', () => {
  assert.equal(gradeOf(timeScore(4.9) + 20).grade, 'F');
});

test('FR5 통산 GPA: 지난주까지 확정된 주만 평균', () => {
  const now = new Date();
  const lastWeek = addDays(weekStart(now), -7);
  const days = { [dateKey(lastWeek)]: { focusSec: 25 * 3600, distractions: 0, combos: 0, hours: [] } };
  const weeks = finalizedWeeks(days, now);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].grade, 'A+');
  assert.equal(gpa(weeks), 4.5);
});

test('FR1 학교 이름: 줄임말·영문 약자도 같은 학교로 인식', () => {
  for (const name of ['충북대', '충북대학교', 'CBNU', 'cbnu']) assert.equal(resolveSchool(name), '충북대학교', name);
  assert.equal(resolveSchool('없는학교'), null);
});

test('FR6 점수: 순공 1분 = 1점, 25분 콤보마다 +5점', () => {
  assert.equal(userScore(60 * 60, 0), 60);
  assert.equal(userScore(60 * 60, 2), 70);
});

test('KST 기준 날짜: 기기·서버 시간대와 상관없이 한국 시간으로 날짜·요일·시를 셈', async () => {
  const { hourOf, kstMidnight } = await import('../extension/lib/util.js');
  // 2026-11-06 15:30 UTC = 2026-11-07(토) 00:30 KST
  const t = Date.UTC(2026, 10, 6, 15, 30);
  assert.equal(dateKey(t), '2026-11-07');
  assert.equal(hourOf(t), 0);
  assert.equal(kstMidnight(t), Date.UTC(2026, 10, 6, 15, 0));
  // 그 주의 월요일 0시(KST) = 2026-11-02 00:00 KST = 11-01 15:00 UTC
  assert.equal(weekStart(t).getTime(), Date.UTC(2026, 10, 1, 15, 0));
  assert.equal(dateKey(weekStart(t)), '2026-11-02');
  // 월요일 0시 직전은 지난주
  assert.equal(dateKey(weekStart(Date.UTC(2026, 10, 1, 14, 59))), '2026-10-26');
});

test('AI 판별: 애매한 사이트만 보내고, 검색 결과·처음 보는 사이트는 보내지 않음', () => {
  const s = st({ settings: { serverUrl: 'http://localhost:8787', aiKey: 'sk-test' } });
  assert.equal(classify('https://www.youtube.com/results?search_query=비밀검색어', '비밀검색어 - YouTube', s).needsAI, undefined);
  assert.equal(classify('https://www.google.com/search?q=비밀검색어', '비밀검색어 - Google 검색', s).needsAI, undefined);
  assert.equal(classify('https://unknown-blog.example/post/1', '아무 제목', s).needsAI, undefined);
  assert.equal(classify('https://www.youtube.com/watch?v=c', '아무 제목', s).needsAI, true);
});

test('기록 이어받기: 자리 비움으로 뺀 시간을 서버의 예전 값으로 되살리지 않음', async () => {
  const { mergeToday, deduct } = await import('../extension/lib/daysync.js');
  const blank = () => ({ focusSec: 0, awaySec: 0, hours: new Array(24).fill(0), distractions: 0, combos: 0 });
  // 확장: 600초 재고 서버에도 600초 보고됨 → 그 뒤 자리 비움으로 300초를 뺌
  const local = { ...blank(), focusSec: 600, combos: 0 };
  local.hours[10] = 600;
  const server = { ...blank(), focusSec: 600 };
  assert.equal(deduct(local, 300, 10), 300);
  assert.deepEqual([local.focusSec, local.awaySec, local.hours[10]], [300, 300, 300]);
  // 공부 모드를 다시 켜서 서버 기록과 맞춰도 600초로 돌아가지 않음 (총시간이 같으므로)
  assert.equal(mergeToday(local, server), false);
  assert.equal(local.focusSec, 300);
  // 다른 기기에서 더 많이 잰 경우(총시간이 더 큼)에는 그 값부터 이어서 잼
  const other = { ...blank(), focusSec: 1200, awaySec: 60 };
  assert.equal(mergeToday(local, other), true);
  assert.deepEqual([local.focusSec, local.awaySec], [1200, 60]);
});
