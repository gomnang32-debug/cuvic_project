// 탭 판별 규칙: 내 목록 → 정정 기억 → 기본 규칙 목록 → (애매하면) AI/제목 판별
import { domainOf } from './util.js';

export const DEFAULT_STUDY = [
  'acmicpc.net', 'solved.ac', 'programmers.co.kr', 'leetcode.com', 'codeforces.com', 'atcoder.jp',
  'github.com', 'gitlab.com', 'stackoverflow.com', 'stackexchange.com', 'developer.mozilla.org',
  'docs.python.org', 'cppreference.com', 'docs.oracle.com', 'learn.microsoft.com', 'w3schools.com',
  'geeksforgeeks.org', 'notion.so', 'notion.site', 'overleaf.com', 'docs.google.com', 'classroom.google.com',
  'khanacademy.org', 'coursera.org', 'edx.org', 'kocw.net', 'kmooc.kr', 'inflearn.com', 'fastcampus.co.kr',
  'udemy.com', 'nomadcoders.co', 'scholar.google.com', 'dbpia.co.kr', 'riss.kr', 'arxiv.org',
  'sciencedirect.com', 'ieeexplore.ieee.org', 'dl.acm.org', 'wikipedia.org', 'wolframalpha.com',
  'desmos.com', 'quizlet.com', 'papago.naver.com', 'dict.naver.com', 'translate.google.com',
  'regexr.com', 'visualgo.net', 'replit.com', 'colab.research.google.com', 'kaggle.com', 'velog.io',
];

export const DEFAULT_DISTRACT = [
  'comic.naver.com', 'webtoon.kakao.com', 'webtoons.com', 'page.kakao.com', 'instagram.com', 'facebook.com',
  'x.com', 'twitter.com', 'threads.net', 'tiktok.com', 'netflix.com', 'tving.com', 'wavve.com',
  'coupangplay.com', 'disneyplus.com', 'watcha.com', 'laftel.net', 'chzzk.naver.com', 'twitch.tv',
  'afreecatv.com', 'sooplive.co.kr', 'dcinside.com', 'fmkorea.com', 'ruliweb.com', 'theqoo.net',
  'inven.co.kr', 'op.gg', 'arca.live', 'reddit.com', '9gag.com', 'coupang.com', '11st.co.kr',
  'gmarket.co.kr', 'musinsa.com', 'everytime.kr', 'sports.news.naver.com', 'store.steampowered.com',
];

/** 공부일 수도, 딴짓일 수도 있는 곳 → 탭 단위로 판별 */
export const AMBIGUOUS = [
  'youtube.com', 'm.youtube.com', 'youtu.be', 'blog.naver.com', 'tistory.com', 'brunch.co.kr', 'medium.com',
  'namu.wiki', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'google.com', 'search.naver.com',
  'naver.com', 'daum.net', 'bilibili.com', 'pinterest.com',
];

const STUDY_WORDS = [
  '강의', '강좌', '수업', '공부', '정리', '풀이', '문제', '알고리즘', '자료구조', '시험', '기출', '중간고사', '기말',
  '과제', '레포트', '리포트', '논문', '개념', '튜토리얼', '이론', '증명', '수학', '미적분', '미분', '적분', '선형대수',
  '확률', '통계', '물리', '화학', '생물', '프로그래밍', '코딩', '파이썬', '자바', '운영체제', '컴퓨터구조',
  '네트워크', '데이터베이스', '컴파일러', '시스템 프로그래밍', '토익', '토플', '영단어', '문법', '회계', '경제학',
  '해설', '원리', '공식', '기초', '입문', '백준', '프로그래머스', '주차', '복습', '예습', '모의고사', '자격증',
  'tutorial', 'lecture', 'course', 'lesson', 'explained', 'how to', 'python', 'java', 'c++', 'javascript',
  'react', 'algorithm', 'leetcode', 'proof', 'calculus', 'linear algebra', 'opengl', 'study with me',
];
const DISTRACT_WORDS = [
  '뮤비', '예능', '브이로그', '먹방', '게임', '플레이', '하이라이트', '리액션', '쇼츠', '웃긴', '레전드', '드라마',
  '영화', '예고편', '직캠', '아이돌', '몰카', '언박싱', '쇼핑', '웹툰', '롤 ', '배그', '발로란트', '축구', '야구',
  '연애', '썰', '밈', 'shorts', 'vlog', ' mv', 'm/v', 'trailer', 'gameplay', 'highlights', 'reaction', 'funny', 'meme',
];

const endsWith = (domain, rule) => domain === rule || domain.endsWith('.' + rule);
const inList = (domain, list) => list.some((r) => endsWith(domain, typeof r === 'string' ? r : r.domain));

function isLms(domain) {
  return /(^|\.)(lms|ecampus|eclass|ecl|cyber|elearning|learn|canvas|blackboard|moodle)\./.test(domain + '.') ||
    domain.endsWith('.ac.kr');
}

export function labelOf(domain) {
  if (!domain) return '브라우저';
  if (isLms(domain)) return 'LMS 강의실';
  if (/webtoon|comic\.naver/.test(domain)) return '웹툰';
  return domain;
}

/** 제목만 보고 판별 (API 키가 없을 때 쓰는 가벼운 판별기) */
export function titleVerdict(title = '') {
  const t = ' ' + title.toLowerCase() + ' ';
  let s = 0, d = 0;
  for (const w of STUDY_WORDS) if (t.includes(w)) s++;
  for (const w of DISTRACT_WORDS) if (t.includes(w)) d++;
  if (s > d) return 'study';
  if (d > s) return 'distract';
  return null;
}

/** 검색 결과 페이지: 제목에 검색어가 그대로 들어 있어서 밖(AI)으로 보내지 않음 */
const SEARCH_URL = /[?&#](q|query|search_query|wd|keyword)=|\/search\b|\/results\b/i;
export const isSearchPage = (url = '') => SEARCH_URL.test(url);

export const tabKey = (domain, title) => `${domain}|${(title || '').trim().slice(0, 120)}`;

/**
 * @returns {{kind:'study'|'distract'|'pending'|'neutral', source:string, domain:string|null, label:string, key:string|null, needsAI?:boolean}}
 */
export function classify(url, title, st) {
  const domain = domainOf(url || '');
  if (!domain) return { kind: 'neutral', source: '브라우저 화면', domain: null, label: '브라우저', key: null };
  const label = labelOf(domain);
  const key = tabKey(domain, title);
  const base = { domain, label, key };

  // BUILD 사이트 자체(대시보드·대항전)는 공부도 딴짓도 아님
  if (domain === domainOf(st.settings.serverUrl || '')) return { ...base, label: 'BUILD 사이트', kind: 'neutral', source: 'BUILD 사이트' };

  if (inList(domain, st.lists.study)) return { ...base, kind: 'study', source: '내 목록' };
  if (inList(domain, st.lists.distract)) return { ...base, kind: 'distract', source: '내 목록' };

  const ov = st.overrides[key] || st.overrides[domain];
  if (ov) return { ...base, kind: ov, source: '정정 기억' };

  if (isLms(domain) || inList(domain, DEFAULT_STUDY)) return { ...base, kind: 'study', source: '기본 규칙 목록' };
  if (inList(domain, DEFAULT_DISTRACT)) return { ...base, kind: 'distract', source: '기본 규칙 목록' };

  const cached = st.aiCache[key];
  if (cached) return { ...base, kind: cached.v, source: cached.by };

  const ambiguous = inList(domain, AMBIGUOUS);
  // AI에는 애매한 사이트(유튜브 등)의 영상·글 제목만 보냄. 처음 보는 사이트 전부나 검색 결과는 보내지 않음
  if (st.settings.aiKey && ambiguous && !isSearchPage(url)) return { ...base, kind: 'pending', source: 'AI 판별 중', needsAI: true };

  const v = titleVerdict(title);
  if (v) return { ...base, kind: v, source: '제목 판별' };
  // 처음 보는 사이트는 측정만 멈추고(딴짓 아님) 정정 버튼으로 공부 처리 가능
  return { ...base, kind: ambiguous ? 'pending' : 'neutral', source: ambiguous ? '판별 보류' : '처음 보는 사이트' };
}

export const isAmbiguous = (domain) => !!domain && inList(domain, AMBIGUOUS);
