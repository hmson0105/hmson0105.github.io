/* Shared behaviour for every page. Plain JS, no dependencies. */
(function () {
  "use strict";

  /* ---- mobile menu ---- */
  var btn = document.querySelector(".menu-btn");
  var menu = document.getElementById("menu");
  if (btn && menu) {
    btn.addEventListener("click", function () {
      var open = menu.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(open));
      btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    menu.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        menu.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---- current year in the footer ---- */
  var y = document.querySelector("[data-year]");
  if (y) y.textContent = String(new Date().getFullYear());

  /* ---- landing video ----
     The poster image is painted underneath the <video> and is what the
     visitor sees until playback actually starts. We only fade the video in
     once it is genuinely playing, so a blocked autoplay (common on mobile
     with Low Power Mode) or a missing file simply leaves the still frame
     in place instead of flashing a black rectangle.                       */
  var vid = document.querySelector(".stage-video");
  if (vid) {
    var reduce = window.matchMedia &&
                 window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      vid.removeAttribute("autoplay");
      vid.pause();
    } else {
      var reveal = function () { vid.classList.add("ready"); };
      vid.addEventListener("playing", reveal, { once: true });
      vid.addEventListener("error", function () { vid.classList.remove("ready"); });

      var p = vid.play();
      if (p && typeof p.catch === "function") {
        p.catch(function () { /* autoplay refused — keep the poster */ });
      }
    }
  }
})();
