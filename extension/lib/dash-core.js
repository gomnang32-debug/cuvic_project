// 대시보드 화면 (내 기록 · 대항전 · 캠퍼스) — 확장 프로그램과 사이트가 같이 씀
import { dateKey, addDays, pad, dur, fmtNum, hms, clock, weekdayOf, kstMidnight } from './util.js';
import { weekReport, finalizedWeeks, gpa, semesterWeek, TARGET_HOURS } from './grade.js';
import { ranked, userScore } from './sim.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const DOW = ['월', '화', '수', '목', '금', '토', '일'];
const RAMP = ['var(--soft)', 'var(--h1)', 'var(--h2)', 'var(--h3)', 'var(--h4)'];
export const VIEW_TITLES = { me: '내 기록', battle: '학교 대항전', campus: '내 캠퍼스' };

/**
 * @param {{ root: HTMLElement, smashEl: HTMLElement, settingsHref: string, startLabel: string, comboHint: string, onStart: () => any }} opts
 * 데이터: ST = { profile, settings: { goalMin, semesterStart, ranking }, days }, S = { state, comboSec }, LG = 리그
 */
export function createDash(opts) {
  let ST = null, S = null, LG = null;
  let rankBy = 'score';
  let prevRival = null;
  let prevMyRank = null;
  let view = 'me';

  function liveScore(s) {
    if (!LG) return s.score;
    const mins = (Date.now() - LG.fetchedAt) / 60000;
    return s.score + s.studying * mins;
  }
  function league(by = 'score') {
    if (!LG) return [];
    const arr = LG.schools.map((s) => ({ ...s, live: liveScore(s), liveAvg: s.members ? liveScore(s) / s.members : 0 }));
    return ranked(arr, by === 'score' ? 'live' : 'liveAvg');
  }
  function onlineBadge() {
    if (!LG) return '';
    return LG.online
      ? `<span class="badge"><span class="dot live" style="width:8px;height:8px;background:var(--live);color:var(--live)"></span>서버 연결됨${LG.demo ? ' · 데모 학교 포함' : ''}</span>`
      : `<span class="badge off">오프라인 리그${LG.demo ? ' · 데모 학교 포함' : ''}</span>`;
  }

  // ---------- 캠퍼스 SVG (첨부 디자인의 아이소메트릭 블록) ----------
  function campusSVG(weeks, ghost, size = 26) {
    const n = weeks.length;
    const plots = n > 24 ? 9 : 4;
    const side = plots === 9 ? 3 : 2;
    const s = size, hw = s * 0.866, q = s * 0.5;
    const iso = (x, y, z) => [(x - y) * hw, (x + y) * q - z * s];
    const P = (a) => a.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const W = side * 2;
    const order = [];
    for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) order.push({ i: i * 2, j: j * 2, h: [] });
    // 층을 건물마다 돌아가며 쌓되, 높이가 다르게 보이도록 살짝 섞기
    const seq = [0, 3, 1, 0, 2, 3, 1, 0, 3, 2, 1, 3, 0, 2, 1, 3, 0, 1, 2, 3].map((x) => x % order.length);
    weeks.forEach((w, k) => order[plots === 4 ? seq[k % seq.length] : k % plots].h.push(w));
    const ghostPlot = order.reduce((m, b) => (b.h.length < m.h.length ? b : m), order[0]);
    const cubes = [];
    order.forEach((b) => {
      b.h.forEach((w, k) => cubes.push({ i: b.i, j: b.j, k, g: w.grade }));
      if (ghost && b === ghostPlot) cubes.push({ i: b.i, j: b.j, k: b.h.length, ghost: true });
    });
    cubes.sort((a, c) => a.i + a.j - (c.i + c.j) || a.k - c.k);
    const col = (g) => (g[0] === 'A' ? ['#1D4ED8', '#1E3A8A', '#C7D5F8'] : g[0] === 'B' ? ['#4F78E3', '#2C4FB0', '#DCE5FB'] : g[0] === 'F' ? ['#9AA1AC', '#5B6270', '#E3E6EB'] : ['#8EA9F0', '#5D7BC9', '#E8EEFD']);
    let faces = `<polygon points="${P([iso(-0.5, -0.5, 0), iso(W - 0.5, -0.5, 0), iso(W - 0.5, W - 0.5, 0), iso(-0.5, W - 0.5, 0)])}" style="fill:var(--line)"/>`;
    for (const c of cubes) {
      const { i, j, k } = c;
      const top = P([iso(i, j, k + 1), iso(i + 1, j, k + 1), iso(i + 1, j + 1, k + 1), iso(i, j + 1, k + 1)]);
      const left = P([iso(i, j + 1, k + 1), iso(i + 1, j + 1, k + 1), iso(i + 1, j + 1, k), iso(i, j + 1, k)]);
      const right = P([iso(i + 1, j, k + 1), iso(i + 1, j + 1, k + 1), iso(i + 1, j + 1, k), iso(i + 1, j, k)]);
      if (c.ghost) {
        faces += `<g stroke="#0E1116" stroke-dasharray="3 2"><polygon points="${left}" fill="#FDE68A"/><polygon points="${right}" fill="#FACC15"/><polygon points="${top}" fill="#FEF3C7"/></g>`;
      } else {
        const [l, r, t] = col(c.g);
        faces += `<g style="stroke:var(--card)"><polygon points="${left}" fill="${l}"/><polygon points="${right}" fill="${r}"/><polygon points="${top}" fill="${t}"/></g>`;
      }
    }
    const maxH = Math.max(1, ...order.map((b) => b.h.length + (b === ghostPlot && ghost ? 1 : 0)));
    const minX = -W * hw - 4, maxX = W * hw + 4, minY = -maxH * s - 6, maxY = W * s + 6;
    return `<svg viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" width="100%" style="max-height:360px" role="img" aria-label="확정된 주 ${n}개로 지은 캠퍼스">${faces}</svg>`;
  }

  // ---------- 내 기록 ----------
  function viewMe() {
    const now = new Date();
    const w = weekReport(ST.days, now);
    const weeks = finalizedWeeks(ST.days, now);
    const g = gpa(weeks);
    const today = ST.days[dateKey()] || { focusSec: 0, distractions: 0, combos: 0 };
    const goal = ST.settings.goalMin * 60;
    const left = goal - today.focusSec;
    const end = addDays(w.start, 6);
    const sw = semesterWeek(ST.settings.semesterStart, now);
    const todayIdx = (weekdayOf(now) + 6) % 7;
    const maxH = Math.max(8, ...w.perDay.map((x) => x / 3600), ST.settings.goalMin / 60 + 1);
    const H = 200;
    const bars = w.perDay.map((sec, i) => {
      const h = sec / 3600;
      const fut = i > todayIdx;
      const isT = i === todayIdx;
      return `<div class="c">${fut ? '' : `<span class="v" style="color:${isT ? 'var(--blue)' : ''}">${h.toFixed(1)}</span>`}<div class="bar" style="height:${fut ? 6 : Math.max(2, Math.round((h / maxH) * H))}px;background:${fut ? 'transparent' : isT ? 'var(--blue)' : 'var(--blue-mid)'};${fut ? 'border:1px dashed var(--line2)' : ''}"></div></div>`;
    }).join('');
    const goalY = Math.round(((ST.settings.goalMin / 60) / maxH) * H);
    const hm = Math.max(...w.heat, 1);
    const heat = w.heat.map((v, i) => `<i title="${i}시 · ${dur(v)}" style="background:${RAMP[v <= 0 ? 0 : Math.min(4, 1 + Math.floor((v / hm) * 3.99))]}"></i>`).join('');
    const rate = today.focusSec > 0 ? today.distractions / (today.focusSec / 3600) : 0;
    const lg = league(rankBy);
    const me = lg.find((s) => s.me);
    const top = lg.slice(0, 5);
    if (me && me.rank > 5) top.push(me);
    const depts = (LG?.depts || []).slice(0, 6);
    const dmax = Math.max(1, ...depts.map((d) => d.avgMin));

    return `
    <div class="h1row">
      <div><div class="sub">${now.getMonth() + 1 === end.getMonth() + 1 ? '' : ''}${w.start.getMonth() + 1}월 ${w.start.getDate()}일 – ${end.getMonth() + 1}월 ${end.getDate()}일 · ${sw > 0 ? sw + '주차' : '개강 전'}</div><div class="h1">이번 주 공사 현황</div></div>
      <div class="sub">학점은 월요일 0시에 확정돼요</div>
    </div>
    <div class="grid3">
      <div class="panel dark col">
        <div class="lbl">이번 주 예상 학점</div>
        <div style="display:flex;align-items:baseline;gap:14px"><span class="kpi" style="color:var(--yellow);font-size:64px">${w.grade}</span><span style="font-size:16px">${w.total}점 · 평점 ${w.point.toFixed(1)}</span></div>
        <div class="meter"><div class="t"><span>시간 점수</span><span class="mono">${w.timeScore} / 80</span></div><div class="b"><i style="width:${(w.timeScore / 80) * 100}%"></i></div></div>
        <div class="meter"><div class="t"><span>집중도 점수</span><span class="mono">${w.focusScore} / 20</span></div><div class="b"><i style="width:${(w.focusScore / 20) * 100}%"></i></div></div>
        <div class="lbl" style="margin-top:8px">${w.grade === 'A+' ? '지금 페이스면 A+예요. 그대로만!' : `A+까지 이번 주 순공 ${(w.needToAPlus).toFixed(1)}시간, 이탈은 지금처럼`}</div>
      </div>
      <div class="panel col">
        <div class="lbl">통산 GPA</div>
        <div style="display:flex;align-items:baseline;gap:8px"><span class="kpi">${g == null ? '–' : g.toFixed(2)}</span><span class="sub" style="font-size:15px">/ 4.5</span></div>
        <div style="font-size:14px;color:var(--ink2)">${weeks.length ? `확정된 ${weeks.length}주 평균 · 순공 0분인 주는 빼요` : '첫 학점은 다음 주 월요일에 확정돼요'}</div>
        <div class="chips" style="margin-top:20px">${weeks.slice(-8).map((x) => `<span class="chip" title="${x.start.getMonth() + 1}/${x.start.getDate()} 주 · ${x.hours.toFixed(1)}시간" style="background:${x.grade[0] === 'A' ? 'var(--inv)' : 'var(--soft)'};color:${x.grade[0] === 'A' ? 'var(--yellow)' : 'var(--ink)'};border:1px solid ${x.grade[0] === 'A' ? 'var(--inv-line)' : 'transparent'}">${x.grade}</span>`).join('')}</div>
      </div>
      <div class="panel col">
        <div class="lbl">오늘 순공</div>
        <div class="kpi" id="todayKpi">${clock(today.focusSec).replace(/^0/, '')}</div>
        <div style="font-size:14px;color:var(--ink2)">딴짓 이탈 ${today.distractions}회 · 공부 1시간당 ${rate.toFixed(1)}회 · 콤보 ${today.combos}회</div>
        <div style="margin-top:auto;padding-top:16px"><span class="pill">${left > 0 ? `목표 ${dur(goal)}까지 ${dur(left)}` : `목표 ${dur(goal)} 달성`}</span></div>
      </div>
    </div>
    <div class="grid2">
      <div class="panel">
        <div class="ph"><h2>요일별 순공</h2><span class="sub">이번 주 ${w.hours.toFixed(1)}시간 · ${TARGET_HOURS}시간이면 시간 점수 만점</span></div>
        <div class="bars">${bars}<div class="goal-line" style="bottom:${goalY}px"><span>목표 ${ST.settings.goalMin / 60}h</span></div></div>
        <div class="days">${DOW.map((d, i) => `<span style="font-weight:${i === todayIdx ? 700 : 400}">${d}${i === todayIdx ? ' (오늘)' : ''}</span>`).join('')}</div>
        <div style="margin-top:28px;font-size:14px;font-weight:700">시간대별 · 이번 주 합계</div>
        <div class="heat">${heat}</div>
        <div class="heatx"><span>0시</span><span>6시</span><span>12시</span><span>18시</span><span>24시</span></div>
      </div>
      <div class="panel">
        <div class="ph"><h2>내 캠퍼스</h2><span class="sub">${weeks.length}층 완공 · 1층 공사 중</span></div>
        <div class="campus">${campusSVG(weeks, true)}</div>
        <div class="legend"><div><span style="background:#1D4ED8"></span>확정된 주의 학점마다 한 층씩 올라가요</div><div><span style="background:#FACC15;border:1px dashed var(--ink)"></span>이번 주 층은 월요일에 완공돼요</div></div>
      </div>
    </div>
    <div class="grid2">
      <div class="panel">
        <div class="ph"><h2>오늘 학교 랭킹</h2><div class="seg"><button data-by="score" class="${rankBy === 'score' ? 'on' : ''}">총합</button><button data-by="avg" class="${rankBy === 'avg' ? 'on' : ''}">1인 평균</button></div></div>
        ${top.map((s) => `<div class="rk ${s.me ? 'me' : ''}"><span class="n">${s.rank}</span><span>${esc(s.name)}</span><span class="p">${fmtNum(s.members)}명</span><span class="v" data-live="${esc(s.name)}" data-by="${rankBy}">${rankBy === 'score' ? fmtNum(s.live) + '점' : fmtNum(s.liveAvg) + '점'}</span></div>`).join('')}
        <div class="foot">매일 0시에 새로 시작해요. 큰 학교가 유리하지 않도록 1인 평균도 함께 봐요. <a href="#battle">대항전 전체 보기 →</a></div>
      </div>
      <div class="panel">
        <div class="ph"><h2>${esc(ST.profile.school)} 학과 랭킹</h2><span class="sub">1인 평균 순공</span></div>
        ${ST.profile.dept ? '' : '<div class="pill" style="margin-bottom:14px">학과를 넣으면 우리 학과도 함께 겨뤄요 · <a href="${opts.settingsHref}" style="margin-left:4px">설정</a></div>'}
        ${depts.length ? depts.map((d, i) => `<div class="dept"><div class="t"><span style="font-weight:${d.me ? 700 : 400}">${i + 1}. ${esc(d.name)}</span><b>${d.avgMin < 60 ? Math.round(d.avgMin) + '분' : (d.avgMin / 60).toFixed(1) + 'h'}</b></div><div class="b"><i style="width:${(d.avgMin / dmax) * 100}%;background:${d.me ? 'var(--blue)' : 'var(--blue-mid)'}"></i></div></div>`).join('') : '<div class="empty">아직 오늘 기록이 없어요.</div>'}
      </div>
    </div>`;
  }

  // ---------- 대항전 ----------
  function untilMidnight() {
    // 대항전은 한국 시간 0시에 초기화
    const n = Date.now();
    return (kstMidnight(n) + 86400000 - n) / 1000;
  }

  function viewBattle() {
    const lg = league(rankBy);
    const byScore = rankBy === 'score' ? lg : league('score');
    const me = byScore.find((s) => s.me);
    const avgRank = league('avg').find((s) => s.me)?.rank;
    const rival = me && me.rank > 1 ? byScore[me.rank - 2] : null;
    const chaser = me ? byScore[me.rank] : null;
    const today = ST.days[dateKey()] || { focusSec: 0, combos: 0 };
    const myPts = userScore(today.focusSec, today.combos);
    const share = me && me.live > 0 ? (myPts / me.live) * 100 : 0;
    const comboPct = Math.min(100, ((S.comboSec || 0) / 1500) * 100);

    // 벽돌: 격차를 24칸으로 나눔. 상대가 바뀌면 다시 쌓음.
    let wall = '', gapTxt = '', eta = '';
    if (rival) {
      const gap = Math.max(0, rival.live - me.live);
      if (!prevRival || prevRival.name !== rival.name || gap > prevRival.unit * 24) prevRival = { name: rival.name, unit: Math.max(0.1, gap / 24), bricks: 24 };
      const left = Math.min(24, Math.ceil(gap / prevRival.unit));
      const falling = prevRival.bricks > left ? prevRival.bricks - left : 0;
      wall = Array.from({ length: 24 }, (_, i) => {
        const idx = 23 - i; // 위에서부터 무너짐
        if (idx >= left + falling) return '<i class="brick gone"></i>';
        if (idx >= left) return '<i class="brick fall"></i>';
        return '<i class="brick"></i>';
      }).join('');
      prevRival.bricks = left;
      gapTxt = `<div class="gap">남은 벽 <b>${fmtNum(gap)}</b>점 · 벽돌 1장 ≈ ${prevRival.unit < 10 ? prevRival.unit.toFixed(1) : fmtNum(prevRival.unit)}점</div>`;
      const close = me.studying - rival.studying; // 분당 점수 차
      if (close > 0) eta = `<span class="pill">지금 속도면 약 ${dur((gap / close) * 60)} 뒤 추월</span>`;
      else eta = `<span class="pill warn">지금은 벌어지는 중 · 공부 중인 사람이 ${-close + 1}명 더 필요해요</span>`;
    } else if (me) {
      wall = Array.from({ length: 24 }, () => '<i class="brick gone"></i>').join('');
      gapTxt = `<div class="gap"><b>1위</b> · 위에 부술 벽이 없어요. 자리를 지키세요!</div>`;
    }
    if (chaser) {
      const lead = me.live - chaser.live;
      eta += `<span class="pill gray">아래 ${esc(chaser.name)}와 ${fmtNum(lead)}점 차</span>`;
    }

    const shown = lg.slice(0, 15);
    const meRow = lg.find((s) => s.me);
    const maxScore = Math.max(1, ...lg.map((s) => (rankBy === 'score' ? s.live : s.liveAvg)));
    const row = (s) => {
      const v = rankBy === 'score' ? s.live : s.liveAvg;
      return `<div class="rk ${s.me ? 'me' : ''}" data-row="${esc(s.name)}"><span class="n ${s.rank <= 3 ? 'top' : ''}">${s.rank}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}</span><span class="st">${s.studying ? `<span class="dot live"></span>${fmtNum(s.studying)}명` : '<span style="color:var(--faint)">–</span>'}</span><span class="bw"><i style="width:${(v / maxScore) * 100}%"></i></span><span class="v" data-live="${esc(s.name)}" data-by="${rankBy}">${fmtNum(v)}점</span></div>`;
    };
    const boardRows = shown.map(row).join('') + (meRow && meRow.rank > 15 ? `<div class="sep">• • •</div>${row(meRow)}` : '');
    const users = LG?.users || [];
    const events = LG?.events || [];

    return `
    <div class="hero" id="hero">
      <div style="position:relative;z-index:1">
        <span class="tagl"><span class="dot live" style="background:#F97316;color:#F97316;width:8px;height:8px"></span>LIVE · 오늘의 학교 대항전</span>
        <h1>공부한 만큼, <em>학교 점수가 올라요</em></h1>
        <div class="sub">순공 1분이 우리 학교 1점. 매일 0시에 새 판이 열려요.</div>
        ${!me && ST.profile.schoolStatus && ST.profile.schoolStatus !== 'ok' ? `<div class="box" style="margin-top:18px"><div class="lbl">${ST.profile.schoolStatus === 'rejected' ? '등록이 거절된 학교' : '학교 등록 대기 중'}</div><div style="font-size:22px;font-weight:700;margin:4px 0">${esc(ST.profile.school)}</div><div class="lbl">${ST.profile.schoolStatus === 'rejected' ? '설정 › 랭킹·계정에서 목록에 있는 학교를 다시 골라 주세요.' : '목록에 없는 학교라 승인되면 대항전 점수에 더해져요. 같은 학교 학생 3명이 가입하면 자동 승인돼요. 그동안 공부 기록과 학점은 그대로 쌓여요.'}</div></div>` : ''}
        ${me ? `<div class="rankbig"><span class="r">${me.rank}위</span><div><div class="s" data-live="${esc(me.name)}" data-by="score">${fmtNum(me.live)}점</div><div class="u">${esc(me.name)} · ${fmtNum(byScore.length)}개 학교 중 · 1인 평균 ${avgRank}위</div></div></div>
        <div class="meta"><span><span class="dot live green" style="width:8px;height:8px;background:#4ADE80;color:#4ADE80"></span> 지금 공부 중 <b>${fmtNum(me.studying)}</b>명</span><span>참여 <b>${fmtNum(me.members)}</b>명</span><span>분당 <b>+${fmtNum(me.studying)}</b>점</span></div>` : ''}
      </div>
      <div class="right">
        <div class="box"><div class="lbl">오늘 판 마감까지</div><div class="cd" id="cd">--:--:--</div></div>
        <div class="box">
          <div class="lbl">내 기여 · ${esc(ST.profile.nickname)}</div>
          <div style="display:flex;align-items:baseline;gap:10px;margin-top:4px"><span class="cd" style="color:var(--yellow)" id="myPts">${fmtNum(myPts)}점</span><span class="lbl">${me ? `우리 학교 점수의 ${share.toFixed(2)}%` : '학교 승인 후 더해져요'}</span></div>
          <div class="lbl" style="margin-top:8px">다음 콤보(+5점)까지 ${S.state === 'study' ? `${25 - Math.floor((S.comboSec || 0) / 60)}분` : opts.comboHint}</div>
          <div class="bar"><i style="width:${comboPct}%"></i></div>
          ${S.state === 'study' ? '' : `<button class="btn" id="startNow" style="margin-top:12px;background:var(--yellow);color:var(--on-yellow);width:100%">${opts.startLabel}</button>`}
          ${ST.settings.ranking ? '' : '<div class="lbl" style="margin-top:8px;color:#FDBA74">랭킹 참여가 꺼져 있어 내 점수가 학교에 더해지지 않아요.</div>'}
        </div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:16px">
      <div class="ph"><h2>${rival ? '다음에 부술 벽' : me ? '정상 방어전' : '학교 대항전'}</h2>${onlineBadge()}</div>
      ${me ? `<div class="vs" id="vs">
        <div class="side"><span class="lbl">우리 학교 · ${me.rank}위</span><span class="nm">${esc(me.name)}</span><span class="sc" data-live="${esc(me.name)}" data-by="score">${fmtNum(me.live)}</span><span class="lbl">공부 중 ${fmtNum(me.studying)}명</span></div>
        <div><div class="wall" id="wall">${wall}</div>${gapTxt}</div>
        <div class="side r">${rival ? `<span class="lbl">${rival.rank}위</span><span class="nm">${esc(rival.name)}</span><span class="sc" data-live="${esc(rival.name)}" data-by="score">${fmtNum(rival.live)}</span><span class="lbl">공부 중 ${fmtNum(rival.studying)}명</span>` : '<span class="nm">1위</span><span class="lbl">지금은 우리가 맨 위</span>'}</div>
      </div>
      <div class="eta">${eta}</div>` : `<div class="empty">${ST.profile.schoolStatus && ST.profile.schoolStatus !== 'ok' ? '학교가 승인되면 여기서 바로 위 학교와 겨뤄요.' : '소속을 설정하면 대항전에 참여해요.'}</div>`}
    </div>

    <div class="grid2">
      <div class="panel board">
        <div class="ph"><h2>전체 학교 순위</h2><div class="seg"><button data-by="score" class="${rankBy === 'score' ? 'on' : ''}">총점</button><button data-by="avg" class="${rankBy === 'avg' ? 'on' : ''}">1인 평균</button></div></div>
        <div id="board">${boardRows}</div>
        <div class="foot">${rankBy === 'score' ? '총점은 참여 인원이 많을수록 유리해요. 1인 평균에서는 작은 학교도 1위를 할 수 있어요.' : '1인 평균 = 학교 총점 ÷ 참여 인원.'} 숫자는 공부 중인 인원만큼 실시간으로 올라가요.</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
        <div class="panel">
          <div class="ph"><h2>${esc(ST.profile.school)} 기여 TOP</h2><span class="sub">오늘 점수</span></div>
          <div class="users">${users.length ? users.slice(0, 6).map((u, i) => `<div class="u ${u.me ? 'me' : ''}"><span class="n">${i + 1}</span><span>${esc(u.nickname)} <span class="sub">${esc(u.dept)}</span>${u.me ? ' <span class="tag">나</span>' : ''}</span><span class="v">${fmtNum(u.score)}</span></div>`).join('') : '<div class="empty">아직 기여한 사람이 없어요. 첫 점수를 올려 보세요.</div>'}</div>
        </div>
        <div class="panel">
          <div class="ph"><h2>실시간 소식</h2></div>
          <div class="feed">${events.length ? events.map((e) => { const d = new Date(e.t); return `<div class="e"><span class="t">${pad(d.getHours())}:${pad(d.getMinutes())}</span><span><b>${esc(e.school)}</b> ${esc(e.text)}</span></div>`; }).join('') : '<div class="empty">조용하네요. 먼저 치고 나가 볼까요?</div>'}</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="ph"><h2>점수 규칙</h2></div>
      <div class="rules">
        <div><b>1분 = 1점</b>공부 탭에 머문 순공 1분이 우리 학교 1점이 돼요.</div>
        <div><b>+5 콤보</b>딴짓 없이 25분 연속 공부할 때마다 보너스 5점.</div>
        <div><b>0점</b>딴짓·자리 비움·브라우저 밖 시간은 점수가 없어요.</div>
        <div><b>0시 리셋</b>매일 새 판. 총점과 1인 평균 순위를 함께 봐요.</div>
      </div>
    </div>`;
  }

  // ---------- 캠퍼스 ----------
  function viewCampus() {
    const weeks = finalizedWeeks(ST.days);
    const w = weekReport(ST.days);
    const counts = {};
    weeks.forEach((x) => (counts[x.grade[0]] = (counts[x.grade[0]] || 0) + 1));
    return `
    <div class="h1row"><div><div class="sub">확정된 주마다 한 층</div><div class="h1">내 캠퍼스</div></div><div class="sub">A 학점 층은 진한 파랑, B는 중간, C·D는 연한 파랑, F는 회색</div></div>
    <div class="grid2">
      <div class="panel"><div class="campus" style="min-height:420px">${campusSVG(weeks, true, 34)}</div>
        <div class="legend"><div><span style="background:#1D4ED8"></span>A 학점 ${counts.A || 0}층 · <span style="background:#4F78E3;margin-left:8px"></span>B 학점 ${counts.B || 0}층 · <span style="background:#8EA9F0;margin-left:8px"></span>C·D ${(counts.C || 0) + (counts.D || 0)}층</div><div><span style="background:#FACC15;border:1px dashed var(--ink)"></span>이번 주 층(예상 ${w.grade})은 월요일 0시에 완공돼요</div></div>
      </div>
      <div class="panel">
        <div class="ph"><h2>층별 기록</h2><span class="sub">${weeks.length}층</span></div>
        <div class="wk" style="color:var(--muted);font-size:12px"><span>주</span><span>순공</span><span>점수</span><span>학점</span></div>
        <div class="wk" style="background:var(--yellow-soft);border-radius:8px;padding-left:8px"><span>이번 주 (공사 중)</span><span>${w.hours.toFixed(1)}시간</span><span class="mono">${w.total}</span><span class="mono">${w.grade}</span></div>
        ${weeks.slice().reverse().map((x) => `<div class="wk"><span>${x.start.getMonth() + 1}/${x.start.getDate()} 주</span><span>${x.hours.toFixed(1)}시간</span><span class="mono">${x.total}</span><span class="mono">${x.grade}</span></div>`).join('') || '<div class="empty">아직 확정된 주가 없어요. 이번 주를 마치면 첫 층이 올라가요.</div>'}
      </div>
    </div>`;
  }
  function tick() {
    $$('[data-live]').forEach((el) => {
      const s = LG?.schools.find((x) => x.name === el.dataset.live);
      if (!s) return;
      const v = el.dataset.by === 'avg' ? (s.members ? liveScore(s) / s.members : 0) : liveScore(s);
      const suffix = el.classList.contains('sc') ? '' : '점';
      el.textContent = fmtNum(v) + suffix;
    });
    if ($('#cd')) {
      const t = hms(untilMidnight());
      $('#cd').textContent = `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`;
    }
  }

  function checkSmash() {
    const me = league('score').find((s) => s.me);
    if (!me) return;
    if (prevMyRank && me.rank < prevMyRank) {
      const beaten = league('score')[me.rank]; // 바로 아래로 내려간 학교
      opts.smashEl.innerHTML = `<div class="card"><div class="big">SMASH!</div><p>${esc(beaten?.name || '')} 벽을 부쉈어요 · 이제 ${me.rank}위</p></div>`;
      $('#hero')?.classList.add('shake');
      setTimeout(() => (opts.smashEl.innerHTML = ''), 2700);
    }
    prevMyRank = me.rank;
  }

  function render(v = view) {
    view = v;
    if (!ST) return;
    const html = view === 'battle' ? viewBattle() : view === 'campus' ? viewCampus() : viewMe();
    opts.root.innerHTML = html;
    $$('.seg button', opts.root).forEach((b) => (b.onclick = () => { rankBy = b.dataset.by; render(); }));
    const start = $('#startNow', opts.root);
    if (start) start.onclick = () => opts.onStart();
    tick();
  }

  return {
    setData(d) { ST = d.ST; S = d.S; if (d.LG) LG = d.LG; },
    render,
    tick,
    checkSmash,
    get view() { return view; },
  };
}
