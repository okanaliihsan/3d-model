import { Viewer } from "./viewer.js";
import { Tour } from "./tour.js";
import { UI } from "./ui.js";

const META = "/3d-model/apartment-meta.json";

const meta = await fetch(META).then((r) => {
  if (!r.ok) throw new Error(`Meta veri okunamadi (${r.status})`);
  return r.json();
});

const canvas = document.getElementById("stage");
const viewer = new Viewer(canvas, meta);
const tour = new Tour(meta);

const ui = new UI(meta, tour, {
  goToStop(i) {
    tour.goTo(i);
    ui.focus(null);
    viewer.select(null);
    resetLook();
  },
  focusItem(h) {
    tour.focusOn(h);
    ui.focus(h);
    viewer.select(h);
    resetLook();
  },
  clearFocus,
});

function clearFocus() {
  tour.focus = null;
  ui.focus(null);
  viewer.select(null);
}

// ------------------------------------------------------------- bakis acisi
let yaw = 0;
let pitch = 0;

function resetLook() {
  yaw = 0;
  pitch = 0;
  viewer.setLook(0, 0);
}

let dragging = false;
let moved = 0;
let lastX = 0;
let lastY = 0;

canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  moved = 0;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.classList.add("dragging");
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (dragging) {
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    yaw -= dx * 0.0032;
    pitch -= dy * 0.0026;
    yaw = Math.max(Math.min(yaw, 1.25), -1.25);
    viewer.setLook(yaw, pitch);
    return;
  }
  const hit = viewer.pick(
    (e.clientX / innerWidth) * 2 - 1,
    -(e.clientY / innerHeight) * 2 + 1,
  );
  canvas.classList.toggle("hovering", !!hit);
});

canvas.addEventListener("pointerup", (e) => {
  canvas.classList.remove("dragging");
  if (!dragging) return;
  dragging = false;
  if (moved > 8) return; // surukleme, tiklama degil

  const hit = viewer.pick(
    (e.clientX / innerWidth) * 2 - 1,
    -(e.clientY / innerHeight) * 2 + 1,
  );
  if (hit) {
    tour.focusOn(hit);
    ui.focus(hit);
    viewer.select(hit);
    resetLook();
  } else if (tour.focus) {
    clearFocus();
  }
});

canvas.addEventListener("pointercancel", () => {
  dragging = false;
  canvas.classList.remove("dragging");
});

// --------------------------------------------------------------- kaydirma
// Sayfa kaydirilmadigi icin tekerlek/dokunma hareketini turun ilerlemesine
// ceviriyoruz. Satir ve sayfa modundaki delta birimleri normalize edilir.
const UNIT = { 0: 1, 1: 16, 2: innerHeight };

addEventListener(
  "wheel",
  (e) => {
    if (e.target.closest(".panel, .focus")) return;
    e.preventDefault();
    const px = e.deltaY * (UNIT[e.deltaMode] ?? 1);
    if (tour.advance(px / 700)) {
      if (!tour.focus) {
        ui.focus(null);
        viewer.select(null);
      }
    }
  },
  { passive: false },
);

let touchY = null;
addEventListener(
  "touchstart",
  (e) => {
    touchY = e.touches[0]?.clientY ?? null;
  },
  { passive: true },
);

addEventListener(
  "touchmove",
  (e) => {
    if (touchY === null) return;
    const y = e.touches[0].clientY;
    tour.advance((touchY - y) / 320);
    touchY = y;
  },
  { passive: true },
);

addEventListener("keydown", (e) => {
  const step = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }[e.key];
  if (step) {
    e.preventDefault();
    tour.goTo(Math.round(tour.p) + step);
    ui.focus(null);
    viewer.select(null);
    resetLook();
  } else if (e.key === "Escape") {
    clearFocus();
  }
});

// ------------------------------------------------------------------ dongu
let shownStop = -1;

function frame() {
  const f = tour.frame();
  viewer.setGoal(f.pos, f.look);
  viewer.setClip(f.clip);
  viewer.setFov(f.fov);
  viewer.render();

  const index = Math.round(tour.p);
  if (index !== shownStop) {
    shownStop = index;
    ui.stop(index, tour.stops[index]);
  }

  const stop = tour.stops[index];
  ui.placeTags(
    (p) => viewer.project(p),
    stop.id,
    !tour.focus && f.transit < 0.45 && index > 0,
  );
  ui.camera(viewer.camera.position, viewer.curLook);

  requestAnimationFrame(frame);
}

// Gelistirme sirasinda kamera/durak degerlerini konsoldan incelemek icin.
if (import.meta.env.DEV) window.__app = { viewer, tour, ui, meta };

await viewer.load((v) => ui.progress(v));
ui.progress(1);
ui.ready();
frame();
