// Fades in elements marked .reveal as they scroll into view. Loaded by
// app/index.html. The page remembers the furthest point the visitor has
// scrolled to, and anything above it is always shown, even if the
// framework re-renders the element (which drops the .is-in class).
(function () {
  if (!("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("js-reveal");
  var furthest = 0;
  function mark() { furthest = Math.max(furthest, window.scrollY + window.innerHeight * 0.95); }
  function sweep() {
    mark();
    document.querySelectorAll(".reveal:not(.is-in)").forEach(function (el) {
      if (el.getBoundingClientRect().top + window.scrollY < furthest) el.classList.add("is-in");
    });
  }
  var queued = false;
  function soon() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; sweep(); }); }
  new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  window.addEventListener("scroll", soon, { passive: true });
  window.addEventListener("resize", soon);
  document.addEventListener("DOMContentLoaded", sweep);
  window.__reveal = { sweep: sweep, furthest: function () { return furthest; } };
  sweep();
})();
