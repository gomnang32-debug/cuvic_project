// 하루 기록을 다른 곳(서버·다른 측정원)의 기록과 맞추는 규칙 — 확장 프로그램과 사이트가 함께 씀
//
// 하루 기록에는 순공(focusSec)과 '자리 비움으로 뺀 시간'(awaySec)이 따로 있다.
// 순공은 자리 비움을 나중에 알아채면 줄어들 수 있지만, 측정한 총시간(gross = 순공 + 뺀 시간)은 줄지 않는다.
// 그래서 어느 쪽 기록이 더 최신인지는 순공이 아니라 총시간으로 비교한다.
// (순공으로 비교하면 방금 자리 비움으로 뺀 시간을 서버의 예전 값으로 되살려 버림)

export const gross = (d) => (d?.focusSec || 0) + (d?.awaySec || 0);

/** 다른 쪽(src) 총시간이 더 크면 그 값부터 이어서 재도록 local을 바꿈. 바뀌었으면 true */
export function mergeToday(local, src) {
  if (!src) return false;
  let changed = false;
  if (gross(src) > gross(local)) {
    local.focusSec = src.focusSec || 0;
    local.awaySec = src.awaySec || 0;
    if (Array.isArray(src.hours) && src.hours.length === 24) {
      let hrs = local.hours.map((x, i) => Math.max(x, Number(src.hours[i]) || 0));
      const sum = hrs.reduce((a, x) => a + x, 0);
      if (sum > local.focusSec) hrs = hrs.map((x) => (sum ? (x * local.focusSec) / sum : 0));
      local.hours = hrs;
    }
    changed = true;
  }
  for (const k of ['combos', 'distractions']) {
    const v = Math.max(local[k] || 0, src[k] || 0);
    if (v !== local[k]) { local[k] = v; changed = true; }
  }
  return changed;
}

/** 자리 비움으로 sec초를 뺌: 순공·그 시간대에서 빼고, 뺀 시간에 더함 */
export function deduct(d, sec, hour) {
  const part = Math.min(sec, d.focusSec);
  if (part <= 0) return 0;
  d.focusSec -= part;
  d.hours[hour] = Math.max(0, d.hours[hour] - part);
  d.awaySec = (d.awaySec || 0) + part;
  d.combos = Math.min(d.combos || 0, Math.floor(d.focusSec / 1500)); // 빠진 시간으로 채운 콤보도 되돌림
  return part;
}
