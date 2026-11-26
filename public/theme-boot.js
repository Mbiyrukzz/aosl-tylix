// Runs before the page paints, so there's no flash of the wrong theme.
// The Theme capability (app/capabilities/Theme.tyx) owns changes later.
// Tylix injects its own small theme script that reads localStorage
// "theme", so the resolved mode is mirrored there too; otherwise a visitor
// who chose Light on a dark-mode device would briefly get dark.
(function () {
  var dark = true;
  try {
    var saved = localStorage.getItem("aos-theme") || "system";
    dark = saved === "dark" || (saved === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch (e) {}
  document.documentElement.classList.toggle("dark", dark);
})();
