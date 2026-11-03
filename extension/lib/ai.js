// AI 판별: 애매한 탭의 "도메인 + 제목"만 보내서 공부인지 묻는다. (페이지 본문·주소 경로는 보내지 않음)
export async function aiClassify({ apiKey, model, domain, title }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-5-5',
        max_tokens: 5,
        system:
          '너는 대학생 공부 시간 측정기의 판별기다. 브라우저 탭의 도메인과 제목만 보고, 그 탭이 대학생의 공부(강의, 과제, 개념 학습, 문제 풀이, 자료 조사, 시험 대비)인지 판단한다. 오락·잡담·쇼핑·SNS·게임·연예면 딴짓이다. 반드시 STUDY 또는 DISTRACT 한 단어로만 답한다.',
        messages: [{ role: 'user', content: `도메인: ${domain}\n제목: ${title || '(제목 없음)'}` }],
      }),
    });
    if (!res.ok) throw new Error('AI ' + res.status);
    const data = await res.json();
    const text = (data.content?.[0]?.text || '').toUpperCase();
    return text.includes('STUDY') ? 'study' : 'distract';
  } finally {
    clearTimeout(timer);
  }
}
