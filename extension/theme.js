// 라이트/다크 테마 — 화면이 그려지기 전에 바로 적용 (깜빡임 방지)
(function () {
  var K = 'build-theme';
  var root = document.documentElement;
  function apply(t) {
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
  }
  function get() {
    try { return localStorage.getItem(K) || 'system'; } catch (e) { return 'system'; }
  }
  apply(get());
  window.BuildTheme = {
    get: get,
    set: function (v) {
      try { if (v === 'system') localStorage.removeItem(K); else localStorage.setItem(K, v); } catch (e) {}
      apply(v);
      document.dispatchEvent(new Event('themechange'));
    },
    current: function () {
      var a = root.getAttribute('data-theme');
      if (a) return a;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    },
  };
  // 다른 창(팝업·설정)에서 바꾸면 같이 바뀜
  window.addEventListener('storage', function (e) { if (e.key === K) apply(e.newValue); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!b) return;
    window.BuildTheme.set(window.BuildTheme.current() === 'dark' ? 'light' : 'dark');
  });
})();
