// Runs before the page paints, so there's no flash of the wrong theme.
// The Theme capability (app/capabilities/Theme.tyx) owns changes later.
(function () {
  try {
    var saved = localStorage.getItem("aos-theme") || "system";
    var dark = saved === "dark" || (saved === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {
    document.documentElement.classList.add("dark");
  }
})();
