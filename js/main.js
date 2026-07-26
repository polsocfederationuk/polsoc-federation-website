/* Shared behaviour: sticky header, mobile nav, scroll-reveal, stat counters */

// Header shadow on scroll
const header = document.querySelector(".site-header");
const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 10);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Mobile nav toggle
const toggle = document.querySelector(".nav-toggle");
if (toggle) {
  toggle.addEventListener("click", () => {
    document.body.classList.toggle("nav-open");
    toggle.setAttribute(
      "aria-expanded",
      document.body.classList.contains("nav-open")
    );
  });
  document.querySelectorAll(".nav-links a").forEach((a) =>
    a.addEventListener("click", () => document.body.classList.remove("nav-open"))
  );
}

// Scroll-reveal: add class .reveal to any element to animate it in
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
);
document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

// Animated counters: <span class="stat-number" data-count="300" data-suffix="+">
const counterObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      counterObserver.unobserve(el);
      const target = parseInt(el.dataset.count, 10);
      const suffix = el.dataset.suffix || "";
      // data-plain: no thousands separator (e.g. years like 2013)
      const fmt = (n) => (el.dataset.plain !== undefined ? String(n) : n.toLocaleString()) + suffix;
      const duration = 1600;
      const start = performance.now();
      let done = false;
      const step = (now) => {
        if (done) return;
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(step);
        else done = true;
      };
      requestAnimationFrame(step);
      // Guarantee the final value even if rAF is throttled (background tab etc.)
      setTimeout(() => { done = true; el.textContent = fmt(target); }, duration + 250);
    });
  },
  { threshold: 0.5 }
);
document
  .querySelectorAll(".stat-number[data-count]")
  .forEach((el) => counterObserver.observe(el));

/* ===== V2 interactive layer ===== */

// Scroll progress bar
const progressBar = document.createElement("div");
progressBar.className = "scroll-progress";
document.body.appendChild(progressBar);

// Back-to-top button
const toTop = document.createElement("button");
toTop.className = "to-top";
toTop.setAttribute("aria-label", "Back to top");
toTop.textContent = "↑";
toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
document.body.appendChild(toTop);

/* Landing-page timeline: the rail fills as you scroll through it.
   Elements and dot offsets are measured once rather than on every scroll tick,
   and the progress is published as a single custom property that CSS turns into
   a scaleY() — so a scroll costs one layout read and no reflow. */
const timeline = document.querySelector(".timeline");
const tlItems = timeline ? Array.from(timeline.querySelectorAll(".tl-item")) : [];
let tlDotOffsets = [];

const measureTimeline = () => {
  // offsetTop is relative to .timeline (it is position: relative), and is
  // unaffected by the reveal animations' transforms
  tlDotOffsets = tlItems.map((el) => el.offsetTop + 12);
};

const drawTimeline = () => {
  if (!timeline) return;
  const rect = timeline.getBoundingClientRect();
  const anchor = window.innerHeight * 0.62;
  const p = Math.min(Math.max((anchor - rect.top) / rect.height, 0), 1);
  timeline.style.setProperty("--p", p.toFixed(4));
  const filled = rect.height * p;
  tlItems.forEach((el, i) => el.classList.toggle("reached", filled >= tlDotOffsets[i]));
};

if (timeline) {
  measureTimeline();
  drawTimeline();
  window.addEventListener("resize", () => { measureTimeline(); drawTimeline(); });
  window.addEventListener("load", () => { measureTimeline(); drawTimeline(); });
}

window.addEventListener(
  "scroll",
  () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
    toTop.classList.toggle("show", window.scrollY > 600);
    drawTimeline();   // scroll events are already frame-aligned; one rect read, no reflow
  },
  { passive: true }
);

const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Magnetic buttons — they lean toward the cursor
if (finePointer && !reducedMotion) {
  document.querySelectorAll(".btn").forEach((b) => {
    b.addEventListener("mousemove", (e) => {
      const r = b.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * 0.18;
      const y = (e.clientY - r.top - r.height / 2) * 0.3;
      b.style.transform = `translate(${x}px, ${y}px)`;
    });
    b.addEventListener("mouseleave", () => (b.style.transform = ""));
  });
}

// 3D tilt on cards (also callable for dynamically added elements)
function applyTilt(els) {
  if (!finePointer || reducedMotion) return;
  els.forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      const rx = ((e.clientY - r.top) / r.height - 0.5) * -7;
      const ry = ((e.clientX - r.left) / r.width - 0.5) * 7;
      el.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-6px)`;
    });
    el.addEventListener("mouseleave", () => (el.style.transform = ""));
  });
}
window.applyTilt = applyTilt;
applyTilt(document.querySelectorAll(".card, .member, .stat, .contact-card, .ann-card"));

// Hero: shield follows the mouse slightly (parallax)
const heroEl = document.querySelector(".hero");
const shieldEl = document.querySelector(".hero-shield");
if (heroEl && shieldEl && finePointer && !reducedMotion) {
  heroEl.addEventListener("mousemove", (e) => {
    const r = heroEl.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width - 0.5) * 22;
    const y = ((e.clientY - r.top) / r.height - 0.5) * 16;
    shieldEl.style.translate = `${x}px ${y}px`;
  });
  heroEl.addEventListener("mouseleave", () => (shieldEl.style.translate = ""));
}

// Copy-to-clipboard buttons (any element with data-copy) + toast
const toast = document.createElement("div");
toast.className = "toast";
document.body.appendChild(toast);
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}
window.showToast = showToast;
document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", () => {
    navigator.clipboard
      .writeText(btn.dataset.copy)
      .then(() => showToast("Copied: " + btn.dataset.copy))
      .catch(() => showToast("Could not copy — please select it manually"));
  });
});

/* ===== V3 interactive layer ===== */

// Cursor spotlight on dark sections (.spotlight) — gold glow follows the mouse
if (finePointer) {
  document.querySelectorAll(".spotlight").forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", e.clientX - r.left + "px");
      el.style.setProperty("--my", e.clientY - r.top + "px");
    });
  });
}

// Quote carousel (landing) — auto-advances, arrows + dots, pauses on hover
const quotesEl = document.querySelector(".quotes");
if (quotesEl) {
  const slides = quotesEl.querySelectorAll(".quote-slide");
  const dotsWrap = quotesEl.querySelector(".quote-dots");
  let qi = 0;
  let qTimer;

  slides.forEach((_, i) => {
    const d = document.createElement("button");
    d.className = "quote-dot" + (i === 0 ? " active" : "");
    d.setAttribute("aria-label", "Quote " + (i + 1));
    d.addEventListener("click", () => goQuote(i));
    dotsWrap.appendChild(d);
  });
  const dots = dotsWrap.querySelectorAll(".quote-dot");

  function goQuote(i) {
    qi = (i + slides.length) % slides.length;
    slides.forEach((s, j) => s.classList.toggle("active", j === qi));
    dots.forEach((d, j) => d.classList.toggle("active", j === qi));
    restartQuoteTimer();
  }
  function restartQuoteTimer() {
    clearInterval(qTimer);
    qTimer = setInterval(() => goQuote(qi + 1), 6000);
  }
  quotesEl.querySelector(".quote-prev").addEventListener("click", () => goQuote(qi - 1));
  quotesEl.querySelector(".quote-next").addEventListener("click", () => goQuote(qi + 1));
  quotesEl.addEventListener("mouseenter", () => clearInterval(qTimer));
  quotesEl.addEventListener("mouseleave", restartQuoteTimer);
  restartQuoteTimer();
}

/* ===== Logo carousels (shared: home partners strip + PBF sponsors/media) =====
   JS-driven position with a float accumulator — writing fractional deltas
   straight into scrollLeft stalls because the browser snaps to whole pixels.
   Auto-scrolls with a seamless loop (tile sets duplicated in the HTML),
   pauses while hovered, arrows slide a page in either direction. */
document.querySelectorAll(".pbf-carousel-wrap").forEach((wrapEl) => {
  const car = wrapEl.querySelector(".pbf-carousel");
  if (!car) return;
  let pos = 0, carHovered = false, sliding = null;

  const half = () => car.scrollWidth / 2;
  const applyPos = () => {
    const h = half();
    if (h > 0) pos = ((pos % h) + h) % h; // keep within the first tile set
    car.scrollLeft = pos;
  };

  wrapEl.addEventListener("mouseenter", () => (carHovered = true));
  wrapEl.addEventListener("mouseleave", () => (carHovered = false));

  const slide = (dir) => {
    if (sliding) return;
    const dist = 456, dur = 420, t0 = performance.now(), from = pos;
    sliding = setInterval(() => {
      const p = Math.min((performance.now() - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      pos = from + dir * dist * e;
      applyPos();
      if (p >= 1) { clearInterval(sliding); sliding = null; }
    }, 16);
  };
  wrapEl.querySelector(".car-prev")?.addEventListener("click", () => slide(-1));
  wrapEl.querySelector(".car-next")?.addEventListener("click", () => slide(1));

  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setInterval(() => {
      if (carHovered || sliding) return;
      pos += 0.7;
      applyPos();
    }, 16);
  }
});
