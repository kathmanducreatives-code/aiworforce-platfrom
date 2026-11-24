// Boot watchdog (moved out of index.html so the Content-Security-Policy can
// forbid inline scripts). If React hasn't replaced the fallback in 10 s, or a
// load error fires, show the Reload / Sign out recovery actions.
(function () {
  function show(text) {
    var el = document.getElementById('boot-fallback');
    if (!el) return;
    var msg = document.getElementById('boot-fallback-msg');
    var actions = document.getElementById('boot-fallback-actions');
    if (msg) msg.textContent = text;
    if (actions) actions.style.display = 'flex';
  }
  setTimeout(function () { show('Agentory is taking longer than expected to load.'); }, 10000);
  window.addEventListener('error', function () { show('Agentory hit an error while loading. Please reload or sign out.'); });
  function wire() {
    var reload = document.getElementById('boot-reload');
    var signout = document.getElementById('boot-signout');
    if (reload) reload.addEventListener('click', function () { location.reload(); });
    if (signout) signout.addEventListener('click', function () {
      try { Object.keys(localStorage).filter(function (k) { return k.indexOf('sb-') === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* storage blocked */ }
      location.assign('/auth');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
