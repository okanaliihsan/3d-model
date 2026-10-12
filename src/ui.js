/** Panel, kat plani, 3D uzerindeki etiketler ve odak karti. */

const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";

export class UI {
  constructor(meta, tour, handlers) {
    this.meta = meta;
    this.tour = tour;
    this.on = handlers;
    this.tags = new Map();
    this.activeRoom = null;
    this.activeItem = null;

    this.el = {
      stats: $("stats"),
      stopIndex: $("stop-index"),
      stopTotal: $("stop-total"),
      roomName: $("room-name"),
      roomDesc: $("room-desc"),
      itemList: $("item-list"),
      roomList: $("room-list"),
      plan: $("plan"),
      focus: $("focus"),
      focusRoom: $("focus-room"),
      focusLabel: $("focus-label"),
      focusNote: $("focus-note"),
      focusDims: $("focus-dims"),
      focusClose: $("focus-close"),
      hint: $("hint"),
      progress: $("progress-fill"),
      loader: $("loader"),
      loaderFill: $("loader-fill"),
      loaderPct: $("loader-pct"),
    };

    this.#stats();
    this.#roomList();
    this.#plan();
    this.#tags();

    this.el.stopTotal.textContent = String(tour.stops.length);
    this.el.focusClose.addEventListener("click", () => this.on.clearFocus());
  }

  // -------------------------------------------------------------- yukleme
  progress(v) {
    const pct = Math.round(v * 100);
    this.el.loaderFill.style.width = `${pct}%`;
    this.el.loaderPct.textContent = String(pct);
  }

  ready() {
    this.el.loader.dataset.done = "1";
    setTimeout(() => this.el.hint.setAttribute("data-faded", "1"), 9000);
  }

  // ----------------------------------------------------------- ust seritte
  #stats() {
    const area = this.meta.rooms.reduce((a, r) => a + r.area, 0);
    const rows = [
      [`${this.meta.rooms.length}`, "Bolum"],
      [`${this.meta.hotspots.length}`, "Esya"],
      [`${Math.round(area)} m²`, "Net alan"],
    ];
    for (const [value, label] of rows) {
      const div = document.createElement("div");
      div.innerHTML = `<b>${value}</b><span>${label}</span>`;
      this.el.stats.append(div);
    }
  }

  #roomList() {
    for (const room of this.meta.rooms) {
      const i = this.tour.indexOfRoom(room.id);
      if (i < 0) continue;
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.room = room.id;
      btn.innerHTML = `<span>${room.name}</span><em>${room.area.toFixed(1)} m²</em>`;
      btn.addEventListener("click", () => this.on.goToStop(i));
      li.append(btn);
      this.el.roomList.append(li);
    }
  }

  // ------------------------------------------------------------ kat plani
  #plan() {
    const b = this.meta.bounds;
    const pad = 0.25;
    const w = b.max[0] - b.min[0] + pad * 2;
    const h = b.max[2] - b.min[2] + pad * 2;

    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `${b.min[0] - pad} ${b.min[2] - pad} ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    for (const room of this.meta.rooms) {
      const rect = document.createElementNS(SVG, "rect");
      rect.setAttribute("class", "room-shape");
      rect.setAttribute("x", room.min[0]);
      rect.setAttribute("y", room.min[2]);
      rect.setAttribute("width", room.max[0] - room.min[0]);
      rect.setAttribute("height", room.max[2] - room.min[2]);
      rect.setAttribute("rx", "0.06");
      rect.dataset.room = room.id;
      const i = this.tour.indexOfRoom(room.id);
      if (i >= 0) {
        rect.addEventListener("click", () => this.on.goToStop(i));
        const title = document.createElementNS(SVG, "title");
        title.textContent = room.name;
        rect.append(title);
      }
      svg.append(rect);
    }

    for (const h2 of this.meta.hotspots) {
      const dot = document.createElementNS(SVG, "circle");
      dot.setAttribute("class", "item-dot");
      dot.setAttribute("cx", h2.center[0]);
      dot.setAttribute("cy", h2.center[2]);
      dot.setAttribute("r", "0.1");
      dot.dataset.item = h2.id;
      svg.append(dot);
    }

    this.planDir = document.createElementNS(SVG, "line");
    this.planDir.setAttribute("class", "cam-dir");
    svg.append(this.planDir);

    this.planCam = document.createElementNS(SVG, "circle");
    this.planCam.setAttribute("class", "cam");
    this.planCam.setAttribute("r", "0.16");
    svg.append(this.planCam);

    this.el.plan.append(svg);
  }

  /** Kat planindaki kamera isaretcisi. */
  camera(pos, look) {
    this.planCam.setAttribute("cx", pos.x.toFixed(3));
    this.planCam.setAttribute("cy", pos.z.toFixed(3));
    const dx = look.x - pos.x;
    const dz = look.z - pos.z;
    const n = Math.hypot(dx, dz) || 1;
    this.planDir.setAttribute("x1", pos.x.toFixed(3));
    this.planDir.setAttribute("y1", pos.z.toFixed(3));
    this.planDir.setAttribute("x2", (pos.x + (dx / n) * 0.55).toFixed(3));
    this.planDir.setAttribute("y2", (pos.z + (dz / n) * 0.55).toFixed(3));
  }

  // -------------------------------------------------------------- etiketler
  #tags() {
    for (const h of this.meta.hotspots) {
      const tag = document.createElement("div");
      tag.className = "tag";
      tag.textContent = h.label;
      tag.addEventListener("click", () => this.on.focusItem(h));
      document.body.append(tag);
      this.tags.set(h.id, tag);
    }
  }

  /** Etiketleri her karede yeniden konumlandirir. */
  placeTags(project, roomId, visible) {
    for (const [id, tag] of this.tags) {
      const h = this.meta.hotspots.find((x) => x.id === id);
      const show = visible && h.room === roomId;
      if (!show) {
        tag.dataset.on = "0";
        continue;
      }
      const p = project(h.center);
      if (!p) {
        tag.dataset.on = "0";
        continue;
      }
      tag.dataset.on = "1";
      tag.style.left = `${p.x}px`;
      tag.style.top = `${p.y}px`;
    }
  }

  // ----------------------------------------------------------------- panel
  stop(index, stop) {
    this.el.stopIndex.textContent = String(index + 1);
    this.el.roomName.textContent = stop.name;
    this.el.roomDesc.textContent = stop.desc;
    this.el.progress.style.width = `${(index / Math.max(this.tour.last, 1)) * 100}%`;

    if (this.activeRoom === stop.id) return;
    this.activeRoom = stop.id;

    for (const btn of this.el.roomList.querySelectorAll("button")) {
      btn.setAttribute("aria-current", String(btn.dataset.room === stop.id));
    }
    for (const rect of this.el.plan.querySelectorAll(".room-shape")) {
      rect.classList.toggle("is-active", rect.dataset.room === stop.id);
    }

    this.el.itemList.replaceChildren();
    const items = this.meta.hotspots.filter((h) => h.room === stop.id);
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = stop.room
        ? "Bu bolumde isaretlenmis esya yok."
        : "Bir odaya girmek icin kaydirin veya plandan secin.";
      this.el.itemList.append(li);
      return;
    }
    for (const h of items) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.item = h.id;
      const long = Math.max(h.size[0], h.size[2]);
      btn.innerHTML = `<span>${h.label}</span><em>${long.toFixed(2)} m</em>`;
      btn.addEventListener("click", () => this.on.focusItem(h));
      li.append(btn);
      this.el.itemList.append(li);
    }
  }

  // ------------------------------------------------------------ odak karti
  focus(h) {
    this.activeItem = h ? h.id : null;
    for (const btn of this.el.itemList.querySelectorAll("button")) {
      btn.setAttribute("aria-current", String(!!h && btn.dataset.item === h.id));
    }
    for (const dot of this.el.plan.querySelectorAll(".item-dot")) {
      dot.classList.toggle("is-active", !!h && dot.dataset.item === h.id);
    }
    for (const [id, tag] of this.tags) {
      tag.classList.toggle("is-active", !!h && id === h.id);
    }

    if (!h) {
      this.el.focus.hidden = true;
      return;
    }
    const room = this.meta.rooms.find((r) => r.id === h.room);
    this.el.focusRoom.textContent = room ? room.name : "Daire";
    this.el.focusLabel.textContent = h.label;
    this.el.focusNote.textContent = h.note;
    this.el.focusDims.replaceChildren();
    const dims = [
      ["Genislik", `${h.size[0].toFixed(2)} m`],
      ["Yukseklik", `${h.size[1].toFixed(2)} m`],
      ["Derinlik", `${h.size[2].toFixed(2)} m`],
    ];
    for (const [k, v] of dims) {
      const wrap = document.createElement("div");
      wrap.innerHTML = `<dt>${k}</dt><dd>${v}</dd>`;
      this.el.focusDims.append(wrap);
    }
    this.el.focus.hidden = false;
  }
}
