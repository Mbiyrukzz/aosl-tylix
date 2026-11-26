// Removes the Ashmif start-up screen (#aos-boot, in app/index.html) as soon
// as the page has rendered into #app. Same rules as Tylix's own screen: it
// only shows after 150ms (CSS), so fast pages never flash it, and it
// always leaves after 15 seconds even if a page never renders.
(function () {
  var s = document.getElementById("aos-boot");
  if (!s) return;
  var done = false;
  function hide() {
    if (done) return;
    done = true;
    s.classList.add("aos-boot-done");
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 420);
  }
  window.__aosHideBoot = hide;
  function ready() { var r = document.getElementById("app"); return !!(r && r.firstElementChild); }
  var mo = new MutationObserver(function () { if (ready()) { mo.disconnect(); hide(); } });
  function watch() { if (ready()) return hide(); mo.observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
  addEventListener("error", function (e) { if (e && e.error) hide(); });
  setTimeout(hide, 15000);
})();
