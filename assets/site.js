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

  /* ---- 언어 전환 (EN / KO) ----
     data-ko 를 가진 요소만 전환 대상이다. 최초 1회 영문 원본을 data-en 에
     옮겨 담고, 이후에는 두 속성 사이를 오간다. 속성값에 HTML 조각이 들어갈
     수 있어(링크·줄바꿈) textContent 가 아니라 innerHTML 로 교체한다.
     값은 전부 이 저장소가 작성한 것이므로 외부 입력이 섞이지 않는다.

     선택은 localStorage 에 남는다. 저장소를 못 쓰는 환경(사생활 보호 모드
     등)에서는 조용히 기본값인 영어로 동작한다.                            */
  var LANG_KEY = "hs-lang";

  function readLang() {
    try { return localStorage.getItem(LANG_KEY) === "ko" ? "ko" : "en"; }
    catch (e) { return "en"; }
  }
  function writeLang(v) {
    try { localStorage.setItem(LANG_KEY, v); } catch (e) { /* 무시 */ }
  }

  function setLang(lang) {
    var nodes = document.querySelectorAll("[data-ko]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.dataset.en === undefined) el.dataset.en = el.innerHTML;
      var next = lang === "ko" ? el.dataset.ko : el.dataset.en;
      if (el.innerHTML !== next) el.innerHTML = next;
    }

    document.documentElement.setAttribute("lang", lang === "ko" ? "ko" : "en");
    document.documentElement.setAttribute("data-lang", lang);

    var title = document.querySelector("title");
    if (title) {
      if (title.dataset.en === undefined) title.dataset.en = title.textContent;
      if (title.dataset.ko) {
        title.textContent = lang === "ko" ? title.dataset.ko : title.dataset.en;
      }
    }

    var btns = document.querySelectorAll("[data-lang-set]");
    for (var j = 0; j < btns.length; j++) {
      btns[j].setAttribute("aria-pressed",
        String(btns[j].getAttribute("data-lang-set") === lang));
    }
  }

  var langButtons = document.querySelectorAll("[data-lang-set]");
  if (langButtons.length) {
    for (var k = 0; k < langButtons.length; k++) {
      langButtons[k].addEventListener("click", function () {
        var v = this.getAttribute("data-lang-set");
        writeLang(v);
        setLang(v);
      });
    }
  }
  setLang(readLang());

})();
