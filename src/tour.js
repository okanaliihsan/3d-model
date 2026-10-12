/**
 * Kaydirma hareketini kamera durusuna cevirir.
 *
 * Tur, "durak" listesinden olusur: ilk durak daireye yukaridan bakan maket
 * gorunumu, sonrakiler odalar. Kaydirma ilerlemesi (p) 0..n-1 arasinda
 * KESIRLI bir degerdir; iki durak arasinda duraksiz suzulerek gecilir.
 *
 * Duraklarin kamera noktalari elle yazilmadi: her oda icin o odanin
 * esyalarinin agirlik merkezi hedef alinir ve kamera, oda icinde o hedefe en
 * uzak kose/kenar noktasina yerlesir. Boylece her odada esyalar cercevelenir.
 */

const ORDER = [
  "yemek",
  "salon",
  "mutfak",
  "koridor",
  "yatak1",
  "banyo1",
  "yatak2",
  "banyo2",
  "camasirlik",
];

const EYE = 1.5;       // kamera goz yuksekligi (m)
const AIM = 1.05;      // bakilan nokta yuksekligi (m)
const INSET = 0.5;     // duvardan geri cekilme (m)

const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export class Tour {
  constructor(meta) {
    this.meta = meta;
    this.rooms = new Map(meta.rooms.map((r) => [r.id, r]));
    this.hotspots = new Map(meta.hotspots.map((h) => [h.id, h]));
    this.grid = meta.walkable;
    this.stops = this.#buildStops();
    this.p = 0;
    this.focus = null;
  }

  // ------------------------------------------------- gezilebilir alan
  /** Nokta, kameranin durabilecegi bos zeminde mi? */
  free(x, z) {
    const g = this.grid;
    const i = Math.floor((x - g.origin[0]) / g.cell);
    const j = Math.floor((z - g.origin[1]) / g.cell);
    if (i < 0 || j < 0 || i >= g.width || j >= g.height) return false;
    return g.rows[j][i] === "1";
  }

  /**
   * Kameradan hedefe bakis acik mi? Hedefin kendisi (esya) dolu oldugu icin
   * son 60 cm sinanmaz; aradaki duvarlar boylece yakalanir.
   */
  #visible(from, to) {
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    const len = Math.hypot(dx, dz);
    if (len < 0.4) return true;
    const steps = Math.ceil(len / (this.grid.cell * 0.6));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if ((1 - t) * len < 0.6) break;
      if (!this.free(from[0] + dx * t, from[2] + dz * t)) return false;
    }
    return true;
  }

  /** Verilen noktaya en yakin bos hucre (yoksa noktanin kendisi). */
  nearestFree(x, z, radius = 1.6) {
    if (this.free(x, z)) return [x, z];
    const step = this.grid.cell;
    for (let r = step; r <= radius; r += step) {
      const ring = Math.ceil((r / step) * 6);
      for (let k = 0; k < ring; k++) {
        const a = (k / ring) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (this.free(px, pz)) return [px, pz];
      }
    }
    return [x, z];
  }

  // -------------------------------------------------------------- duraklar
  #buildStops() {
    const b = this.meta.bounds;
    const span = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
    const stops = [
      {
        id: "genel",
        room: null,
        name: "Genel Bakis",
        desc: `${this.meta.rooms.length} bolumden olusan dairenin tavani kaldirilmis maket gorunumu. Ilerlemek icin kaydirin.`,
        pos: [(b.min[0] + b.max[0]) / 2 + span * 0.1, span * 0.78, b.max[2] + span * 0.42],
        look: [(b.min[0] + b.max[0]) / 2, 0.4, (b.min[2] + b.max[2]) / 2],
        fov: 46,
      },
    ];

    for (const id of ORDER) {
      const room = this.rooms.get(id);
      if (!room) continue;
      const aim = this.#aimOf(room);
      const view = this.#viewpoint(room, aim);
      stops.push({
        id: room.id,
        room,
        name: room.name,
        desc: room.description,
        pos: view.pos,
        look: aim,
        // Dar hacimlerde geri cekilecek yer yok; bunun yerine aciyi aciyoruz.
        fov: clamp(46 + (2.6 - view.dist) * 13, 46, 82),
      });
    }
    return stops;
  }

  /**
   * Odanin bakis hedefi: esyalarin taban alanina gore AGIRLIKLI merkezi.
   * Pencere ve kapilar disarida birakilir, yoksa hedef duvara kayiyor ve
   * oda, mobilyasi yerine bos duvari gosteriyordu.
   */
  #aimOf(room) {
    const items = room.hotspots
      .map((id) => this.hotspots.get(id))
      .filter((h) => h && h.kind === "esya");
    if (!items.length) return [room.center[0], AIM, room.center[2]];

    let wx = 0;
    let wz = 0;
    let wy = 0;
    let total = 0;
    for (const h of items) {
      const w = Math.max(h.size[0] * h.size[2], 0.05);
      wx += h.center[0] * w;
      wz += h.center[2] * w;
      wy += (h.center[1] + h.size[1] * 0.25) * w;
      total += w;
    }
    return [wx / total, clamp(wy / total, 0.75, 1.55), wz / total];
  }

  /**
   * Odanin icinde, hedefi GOREBILEN bos zemin noktalarindan hedefe en uzak
   * olani. Aday noktalar gezinme maskesinden gelir; maske gercek geometriden
   * cikarildigi icin kamera ne duvarin icinde kalir ne de dolaba gomulur.
   */
  #viewpoint(room, aim) {
    const g = this.grid;
    const pad = 0.35;        // oda disina tasma payi (kucuk hacimler icin)
    const inRoom = (x, z, p) =>
      x >= room.min[0] - p && x <= room.max[0] + p &&
      z >= room.min[2] - p && z <= room.max[2] + p;

    let best = null;
    let bestScore = -1;
    let fallback = null;
    let fallbackScore = -1;

    for (let j = 0; j < g.height; j++) {
      const row = g.rows[j];
      for (let i = 0; i < g.width; i++) {
        if (row[i] !== "1") continue;
        const x = g.origin[0] + (i + 0.5) * g.cell;
        const z = g.origin[1] + (j + 0.5) * g.cell;
        if (!inRoom(x, z, pad)) continue;
        const d = Math.hypot(x - aim[0], z - aim[2]);
        // Cok uzaktan bakmak odayi kucultur; 4.5 m ustu puan kazanmaz.
        const score = Math.min(d, 4.5) - (inRoom(x, z, 0) ? 0 : 0.8);
        if (score > fallbackScore) {
          fallbackScore = score;
          fallback = [x, EYE, z];
        }
        if (score > bestScore && this.#visible([x, EYE, z], aim)) {
          bestScore = score;
          best = [x, EYE, z];
        }
      }
    }

    const pos = best || fallback || [room.center[0], EYE, room.center[2]];
    return { pos, dist: Math.hypot(pos[0] - aim[0], pos[2] - aim[2]) };
  }

  // ------------------------------------------------------------ ilerleme
  get last() {
    return this.stops.length - 1;
  }

  /** Kaydirma girdisi; odak modundaysa once onu birakir. */
  advance(delta) {
    if (this.focus) {
      this.focus = null;
      return true;
    }
    const before = this.p;
    this.p = Math.min(Math.max(this.p + delta, 0), this.last);
    return this.p !== before;
  }

  goTo(stopIndex) {
    this.focus = null;
    this.p = Math.min(Math.max(stopIndex, 0), this.last);
  }

  indexOfRoom(roomId) {
    return this.stops.findIndex((s) => s.id === roomId);
  }

  /** Su an (en yakin) durak. */
  get stop() {
    return this.stops[Math.round(this.p)];
  }

  focusOn(hotspot) {
    this.focus = hotspot;
    const room = this.rooms.get(hotspot.room);
    const idx = this.indexOfRoom(hotspot.room);
    if (idx > 0) this.p = idx;
    this.focusView = this.#focusView(hotspot, room);
  }

  /**
   * Esyaya odak: kamera, esyanin uzun kenarina dik yonde, boyutuyla oranli
   * bir mesafeden bakar. Yon, odanin merkezinden esyaya dogru secilir --
   * boylece kamera duvarin icine girmez.
   */
  #focusView(h, room) {
    const reach = Math.max(h.size[0], h.size[1], h.size[2]);
    // Esyanin kendi yaricapi kadar disindan baslayip istenen mesafeye kadar
    // acilmaya calisiyoruz; boylece kamera esyanin icinde kalmiyor.
    const half = Math.hypot(h.size[0], h.size[2]) / 2;
    const want = clamp(reach * 1.5 + 0.75, 1.1, 4.0);
    const start = half + 0.3;

    // Tercih edilen yon: odanin merkezinden esyaya dogru (yani odanin icinden).
    let px = h.center[0] - (room ? room.center[0] : 0);
    let pz = h.center[2] - (room ? room.center[2] : 0);
    const pn = Math.hypot(px, pz) || 1;
    const prefer = Math.atan2(pz / pn, px / pn);

    let best = null;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      if (!this.free(h.center[0] + dx * start, h.center[2] + dz * start)) continue;

      let d = start;
      while (d + this.grid.cell <= want &&
             this.free(h.center[0] + dx * (d + this.grid.cell),
                       h.center[2] + dz * (d + this.grid.cell))) {
        d += this.grid.cell;
      }
      // Istenen mesafeye yakin olan ve tercih edilen yona yakin duran kazanir.
      let turn = Math.abs(a - prefer) % (Math.PI * 2);
      if (turn > Math.PI) turn = Math.PI * 2 - turn;
      const score = d - (want - d) * 0.5 - turn * 0.35;
      if (!best || score > best.score) best = { score, d, dx, dz };
    }

    if (!best) {
      const [fx, fz] = this.nearestFree(
        h.center[0] + (px / pn) * want,
        h.center[2] + (pz / pn) * want,
        2.5,
      );
      best = {
        d: Math.hypot(fx - h.center[0], fz - h.center[2]),
        dx: (fx - h.center[0]) / (Math.hypot(fx - h.center[0], fz - h.center[2]) || 1),
        dz: (fz - h.center[2]) / (Math.hypot(fx - h.center[0], fz - h.center[2]) || 1),
      };
    }

    const eye = clamp(h.center[1] + h.size[1] * 0.25 + 0.2, 0.7, 2.1);
    return {
      pos: [
        h.center[0] + best.dx * best.d,
        eye,
        h.center[2] + best.dz * best.d,
      ],
      look: [h.center[0], h.center[1], h.center[2]],
      // Yakindan bakmak zorunda kalindiysa aciyi acarak esyayi cerceveye sigdir.
      fov: clamp(38 + (reach / Math.max(best.d, 0.4)) * 16, 38, 76),
    };
  }

  /**
   * O karede kameranin gitmesi gereken durus ve tavan kesme yuksekligi.
   * Gecis sirasinda kamera hafifce yukaridan bir yay cizer, boylece duvarin
   * icinden duz gecmek yerine mekanin uzerinden suzulur.
   */
  frame() {
    if (this.focus) {
      return { ...this.focusView, clip: 3.4, transit: 0 };
    }
    const i = Math.floor(this.p);
    const a = this.stops[i];
    const b = this.stops[Math.min(i + 1, this.last)];
    const t = smooth(this.p - i);

    const pos = mix(a.pos, b.pos, t);
    const look = mix(a.look, b.look, t);
    const transit = Math.sin((this.p - i) * Math.PI);
    if (i > 0) pos[1] += transit * 0.42;

    // Maket gorunumunden ic mekana gecerken tavan geri gelir.
    const clip = lerp(1.45, 3.4, smooth(Math.min(this.p, 1)));
    const fov = lerp(a.fov, b.fov, t);
    return { pos, look, clip, transit, fov };
  }
}
