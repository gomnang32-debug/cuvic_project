// BUILD 사이트 ↔ 확장 프로그램 다리 (사이트 페이지에서만 실행되는 content script)
// - 사이트 계정과 확장 프로그램 계정을 하나로 연결
// - 확장 프로그램의 측정 상태를 2초마다 사이트에 알려줌
(() => {
  if (window.__buildBridge) return;
  window.__buildBridge = true;
  document.documentElement.dataset.buildExt = '1';
  const post = (type, data = {}) => window.postMessage({ source: 'build-ext', type, ...data }, location.origin);
  const send = (m) => new Promise((res) => {
    try {
      chrome.runtime.sendMessage(m, (r) => { void chrome.runtime.lastError; res(r); });
    } catch {
      res(null); // 확장 프로그램이 새로고침되면 연결이 끊김
    }
  });
  async function status() {
    const s = await send({ type: 'status' });
    if (s && !s.error) post('status', { data: s });
  }
  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.source !== 'build-site') return;
    const m = e.data;
    if (m.type === 'hello' || m.type === 'link') {
      const r = await send({ type: m.type === 'link' ? 'siteLink' : 'siteHello', account: m.account || null, origin: location.origin });
      if (r?.account) post('account', { account: r.account });
      if (r?.linked) post('linked');
      status();
    } else if (m.type === 'toggle') {
      await send({ type: 'toggle', on: m.on });
      status();
    }
  });
  status();
  setInterval(status, 2000);
})();
