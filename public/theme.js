// Runs before first paint (blocking, in <head>) so a forced theme never flashes the other one. Mirrors src/app/theme.ts.
(function () {
  try {
    var t = localStorage.getItem('horaire.theme');
    if (t !== 'clair' && t !== 'sombre') return;
    document.documentElement.setAttribute('data-theme', t);
    var c = t === 'sombre' ? '#121316' : '#F5F4F0';
    var ms = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < ms.length; i++) ms[i].setAttribute('content', c);
  } catch (e) { /* storage blocked: follow the iPhone */ }
})();
