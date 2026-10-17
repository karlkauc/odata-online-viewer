// Runs before first paint (external file because the CSP is script-src 'self').
(function () {
  var stored = null;
  try {
    stored = localStorage.getItem("odv-theme");
  } catch (e) {
    /* storage blocked */
  }
  var preferred = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.classList.toggle("dark", (stored || preferred) === "dark");
})();
