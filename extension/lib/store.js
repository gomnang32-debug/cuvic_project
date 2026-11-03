// chrome.storage.local 에 저장하는 전체 상태
import { defaultSemesterStart } from './grade.js';

export function defaults() {
  return {
    profile: null, // { school, dept, nickname, userId, token }
    settings: {
      studyMode: false,
      goalMin: 240,
      idleMin: 5,
      ranking: true,
      notify: { distract: true, goal: true, rank: true },
      serverUrl: 'http://localhost:8787',
      demoLeague: true,
      aiKey: '',
      aiModel: 'claude-haiku-5-5',
      semesterStart: defaultSemesterStart(),
    },
    lists: { study: [], distract: [] }, // [{ domain, how, ts }]
    overrides: {}, // key(도메인|제목) 또는 도메인 → 'study' | 'distract'
    corrections: {}, // 도메인 → { study, distract }
    dismissed: {}, // 제안 '나중에' 누른 도메인
    aiCache: {}, // key → { v, by, ts }
    days: {}, // 'YYYY-MM-DD' → { focusSec, hours[24], distractions, distractSec, combos, firstRank, goalNotified }
    rt: {},
    league: null,
  };
}

function merge(base, over) {
  if (over === undefined) return base;
  if (base && typeof base === 'object' && !Array.isArray(base) && over && typeof over === 'object' && !Array.isArray(over)) {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
    return out;
  }
  return over;
}

export async function load() {
  const raw = await chrome.storage.local.get(null);
  return merge(defaults(), raw);
}
export async function save(st) {
  await chrome.storage.local.set(st);
}

export function emptyDay() {
  return { focusSec: 0, hours: new Array(24).fill(0), distractions: 0, distractSec: 0, combos: 0, firstRank: null, goalNotified: false };
}
