// 학점 계산: 시간 점수 80 + 집중도 점수 20 = 100점
import { weekStart, addDays, dateKey, parseKey, clamp } from './util.js';

export const TARGET_HOURS = 25; // 주 25시간이면 시간 점수 만점
export const GRADES = [
  ['A+', 95, 4.5], ['A0', 90, 4.0], ['B+', 85, 3.5], ['B0', 80, 3.0], ['C+', 75, 2.5],
  ['C0', 70, 2.0], ['D+', 65, 1.5], ['D0', 60, 1.0], ['F', 0, 0],
];
export function gradeOf(score) {
  for (const [g, min, p] of GRADES) if (score >= min) return { grade: g, point: p };
  return { grade: 'F', point: 0 };
}
export const pointOf = (g) => (GRADES.find((x) => x[0] === g) || GRADES[8])[2];

export function timeScore(hours) {
  return clamp(Math.round((hours / TARGET_HOURS) * 80), 0, 80);
}
/** 공부 1시간당 딴짓 이탈 횟수가 적을수록 높음 */
export function focusScore(hours, distractions) {
  if (hours <= 0) return 0;
  const rate = distractions / hours;
  return clamp(Math.round(20 - rate * 3.6), 0, 20);
}

export function sumWeek(days, start) {
  let focusSec = 0, distractions = 0, combos = 0;
  const perDay = [], heat = new Array(24).fill(0);
  for (let i = 0; i < 7; i++) {
    const k = dateKey(addDays(start, i));
    const d = days[k];
    perDay.push(d ? d.focusSec : 0);
    if (d) {
      focusSec += d.focusSec;
      distractions += d.distractions || 0;
      combos += d.combos || 0;
      (d.hours || []).forEach((v, h) => (heat[h] += v));
    }
  }
  return { focusSec, distractions, combos, perDay, heat };
}

export function weekReport(days, now = new Date()) {
  const start = weekStart(now);
  const w = sumWeek(days, start);
  const hours = w.focusSec / 3600;
  const elapsedDays = clamp((now - start) / 86400000, 1, 7);
  const projectedHours = (hours / elapsedDays) * 7;
  const ts = timeScore(projectedHours);
  const fs = focusScore(hours, w.distractions);
  const total = ts + fs;
  const g = gradeOf(total);
  // A+까지 남은 순공 (이탈은 지금 페이스 유지 가정)
  const needTs = Math.max(0, 95 - fs);
  const needHoursProjected = (needTs / 80) * TARGET_HOURS;
  const needToAPlus = Math.max(0, (needHoursProjected / 7) * elapsedDays - hours);
  return { start, ...w, hours, projectedHours, timeScore: ts, focusScore: fs, total, ...g, needToAPlus };
}

/** 지난주까지 확정된 주 (순공 0분인 주는 빠짐) */
export function finalizedWeeks(days, now = new Date()) {
  const cur = weekStart(now);
  const keys = Object.keys(days).filter((k) => days[k].focusSec > 0).sort();
  if (!keys.length) return [];
  let s = weekStart(parseKey(keys[0]));
  const out = [];
  while (s < cur) {
    const w = sumWeek(days, s);
    if (w.focusSec > 0) {
      const hours = w.focusSec / 3600;
      const total = timeScore(hours) + focusScore(hours, w.distractions);
      out.push({ start: new Date(s), hours, total, ...gradeOf(total) });
    }
    s = addDays(s, 7);
  }
  return out;
}

export function gpa(weeks) {
  if (!weeks.length) return null;
  return weeks.reduce((a, w) => a + w.point, 0) / weeks.length;
}

/** 개강일 기준 n주차 */
export function semesterWeek(semStartKey, now = new Date()) {
  const s = weekStart(parseKey(semStartKey));
  return Math.floor((weekStart(now) - s) / (7 * 86400000)) + 1;
}
export function defaultSemesterStart(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (m >= 8) return `${y}-09-01`;
  if (m >= 2) return `${y}-03-02`;
  return `${y - 1}-09-01`;
}
