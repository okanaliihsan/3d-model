import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const MODEL = "/3d-model/apartment/scene.gltf";

/**
 * Sahneyi, modeli ve kamerayi yonetir.
 *
 * Kamera iki durumdan tureyen tek bir hedefe dogru her karede yumusatilir:
 *   goalPos / goalLook  -> tur veya odak tarafindan belirlenir
 *   yaw / pitch         -> kullanicinin surukleyerek verdigi bakis sapmasi
 * Boylece tur ilerlemesi ile serbest bakis birbirini bozmadan birlesir.
 */
export class Viewer {
  constructor(canvas, meta) {
    this.meta = meta;
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.localClippingEnabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x15161a);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);

    // Tavani kesip "maket" gorunumu veren yatay duzlem. Normal -Y oldugu
    // icin duzlemin altinda kalan (y <= constant) her sey cizilir.
    this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.45);
    this.renderer.clippingPlanes = [this.clip];

    this.curPos = new THREE.Vector3(0, 8, 9);
    this.curLook = new THREE.Vector3(0, 0.9, 0);
    this.goalPos = this.curPos.clone();
    this.goalLook = this.curLook.clone();
    this.yaw = 0;
    this.pitch = 0;
    this.goalYaw = 0;
    this.goalPitch = 0;
    this.goalFov = 46;
    this.ease = 0.075;

    this.proxies = [];
    this.raycaster = new THREE.Raycaster();
    this.highlight = null;
    this.onHotspotClick = null;
    this.hovered = null;

    this.#lights();
    this.#selection();
    addEventListener("resize", () => this.resize());
    this.resize();
  }

  // ------------------------------------------------------------- kurulum
  #lights() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0xdfe7f2, 0x55504a, 0.55));

    const sun = new THREE.DirectionalLight(0xfff0d8, 1.5);
    sun.position.set(-9, 7, 5);
    this.scene.add(sun);

    // Tavan gun isigini kestigi icin her odaya birer ic aydinlatma.
    for (const room of this.meta.rooms) {
      const light = new THREE.PointLight(0xffe9c4, 7, 7, 2);
      light.position.set(room.center[0], 2.2, room.center[2]);
      this.scene.add(light);
    }
  }

  #selection() {
    const box = new THREE.Box3(
      new THREE.Vector3(-0.5, -0.5, -0.5),
      new THREE.Vector3(0.5, 0.5, 0.5),
    );
    this.highlight = new THREE.Box3Helper(box, new THREE.Color(0xd8a657));
    this.highlight.material.depthTest = false;
    this.highlight.material.transparent = true;
    this.highlight.material.opacity = 0.9;
    this.highlight.renderOrder = 10;
    this.highlight.visible = false;
    this.scene.add(this.highlight);
  }

  /** Modeli yukler; ilerleme 0..1 araliginda bildirilir. */
  load(onProgress) {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(
        MODEL,
        (gltf) => {
          const root = gltf.scene;
          const [ox, oy, oz] = this.meta.offset;
          root.scale.setScalar(this.meta.scale);
          root.position.set(ox, oy, oz);
          root.traverse((o) => {
            if (!o.isMesh) return;
            o.frustumCulled = false;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              m.clippingPlanes = [this.clip];
              m.side = THREE.DoubleSide;
            }
          });
          this.scene.add(root);
          this.model = root;
          this.#buildProxies();
          resolve(root);
        },
        (e) => {
          if (e.lengthComputable) onProgress?.(e.loaded / e.total);
        },
        reject,
      );
    });
  }

  /**
   * Her esya icin gorunmez bir sinir kutusu: isin izleme bunlara carpar.
   * Model mesh'leri malzemeye gore gruplandigi icin dogrudan tiklanamaz --
   * tek bir mesh dairenin yarisini kapsiyor. Kutular ise esya bazli.
   */
  #buildProxies() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    for (const h of this.meta.hotspots) {
      const size = [0, 1, 2].map((k) => Math.max(h.max[k] - h.min[k], 0.08));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.set(size[0], size[1], size[2]);
      mesh.position.set(...h.center);
      mesh.userData.hotspot = h;
      this.scene.add(mesh);
      this.proxies.push(mesh);
    }
  }

  // ------------------------------------------------------------- kamera
  setGoal(pos, look) {
    this.goalPos.set(pos[0], pos[1], pos[2]);
    this.goalLook.set(look[0], look[1], look[2]);
  }

  setClip(y) {
    this.clip.constant = y;
  }

  setFov(deg) {
    this.goalFov = deg;
  }

  setLook(yaw, pitch) {
    this.goalYaw = yaw;
    this.goalPitch = THREE.MathUtils.clamp(pitch, -0.55, 0.5);
  }

  select(hotspot) {
    if (!hotspot) {
      this.highlight.visible = false;
      return;
    }
    this.highlight.box.set(
      new THREE.Vector3(...hotspot.min),
      new THREE.Vector3(...hotspot.max),
    );
    this.highlight.visible = true;
  }

  /** Imlec altindaki esyayi dondurur (yoksa null). */
  pick(nx, ny) {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hit = this.raycaster.intersectObjects(this.proxies, false)[0];
    return hit ? hit.object.userData.hotspot : null;
  }

  /** Dunya noktasini ekran koordinatina cevirir; kameranin arkasi null. */
  project(point) {
    const v = new THREE.Vector3(...point).project(this.camera);
    if (v.z > 1) return null;
    return {
      x: (v.x * 0.5 + 0.5) * innerWidth,
      y: (-v.y * 0.5 + 0.5) * innerHeight,
    };
  }

  /**
   * Sol paneli hesaba katar: goruntuyu, panelin genisligi kadar genis bir
   * cerceveden kirparak sahneyi panelin sagina kaydirir. Boylece daire,
   * panelin altinda kalmak yerine bos alanda ortalanir.
   */
  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    const pad = w > 900 ? 354 : 0;
    this.camera.aspect = w / h;
    if (pad) this.camera.setViewOffset(w + pad, h, 0, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.curPos.lerp(this.goalPos, this.ease);
    this.curLook.lerp(this.goalLook, this.ease);
    if (Math.abs(this.camera.fov - this.goalFov) > 0.01) {
      this.camera.fov += (this.goalFov - this.camera.fov) * 0.08;
      this.camera.updateProjectionMatrix();
    }
    this.yaw += (this.goalYaw - this.yaw) * 0.12;
    this.pitch += (this.goalPitch - this.pitch) * 0.12;

    const dir = this.curLook.clone().sub(this.curPos);
    const len = Math.max(dir.length(), 0.001);
    const sph = new THREE.Spherical().setFromVector3(dir);
    sph.theta += this.yaw;
    sph.phi = THREE.MathUtils.clamp(sph.phi + this.pitch, 0.2, Math.PI - 0.2);
    sph.radius = len;

    this.camera.position.copy(this.curPos);
    this.camera.lookAt(this.curPos.clone().add(new THREE.Vector3().setFromSpherical(sph)));
    this.renderer.render(this.scene, this.camera);
  }
}
