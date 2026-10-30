// Appearance and language are applied before the first paint, so a dark-mode or English visitor never sees a flash of
// the wrong colours or language (the app keeps them in sync afterwards: src/client/theme.ts, src/client/i18n.ts).
(function () {
  var stored = function (key) { try { return localStorage.getItem(key); } catch { return null; } };
  var theme = stored('campusdrop:theme');
  var dark = theme === 'dark' || (theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (stored('campusdrop:lang') === 'en') { document.documentElement.lang = 'en'; document.documentElement.setAttribute('data-lang', 'en'); }
})();
