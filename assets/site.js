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
     The poster image sits underneath the <video> and is what the visitor
     sees until playback genuinely starts. The video only fades in once it
     is actually playing, so a refused autoplay, a hidden tab, or a missing
     file simply leaves the still frame in place.

     Autoplay is refused more often than people expect: a backgrounded tab,
     iOS Low Power Mode, and some data-saver modes all block it. So rather
     than calling play() once and giving up, we retry at each point where
     the browser might newly allow it.                                      */
  var vid = document.querySelector(".stage-video");
  if (vid) {
    var reduce = window.matchMedia &&
                 window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      vid.removeAttribute("autoplay");
      vid.pause();
    } else {
      vid.addEventListener("playing", function () {
        vid.classList.add("ready");
      });
      vid.addEventListener("error", function () {
        vid.classList.remove("ready");
      });

      var tryPlay = function () {
        if (!vid.paused) return;
        var p = vid.play();
        if (p && typeof p.catch === "function") {
          p.catch(function () { /* still refused — the poster stays */ });
        }
      };

      tryPlay();
      vid.addEventListener("loadeddata", tryPlay);
      vid.addEventListener("canplay", tryPlay);
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) tryPlay();
      });
      window.addEventListener("focus", tryPlay);

      /* Last resort: the first touch or click on the page counts as the
         user gesture that unblocks playback. */
      var once = { once: true, passive: true };
      document.addEventListener("pointerdown", tryPlay, once);
      document.addEventListener("touchstart", tryPlay, once);
    }
  }
})();
