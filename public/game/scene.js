import * as THREE from "/vendor/three.module.js";
import { DestructionWorld, FIXED_DT, AMMO } from "./physics.js";
import { loadModels, createCannonVisual } from "./models.js";
import { Characters, CHARACTER } from "./characters.js";
import { loadCharacter } from "./models.js";
import { SoundMixer } from "./audio.js";
import { Effects } from "./effects.js";
const $ = (id) => document.getElementById(id);
export class CannonScene {
  constructor(canvasA, canvasB, input) {
    this.input = input;
    this.disposed = false;
    this.combatEnabled = false;
    this.aim = [
      { yaw: 0.1, up: 0.24 },
      { yaw: 0.1, up: 0.24 },
    ];
    this.aimVelocity = [
      { yaw: 0, up: 0 },
      { yaw: 0, up: 0 },
    ];
    this.ammo = ["heavy", "heavy"];
    this.lastShot = [-100, -100];
    this.counts = [0, 0];
    this.recoil = [0, 0];
    this.shake = [0, 0];
    this.projectileMeshes = new Map();
    this.lastMuzzles = [null, null];
    this.modelState = "Laddar cannon.glb";
    this.modelError = null;
    this.renderers = [canvasA, canvasB].map((canvas) => {
      const r = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        powerPreference: "high-performance",
      });
      r.setPixelRatio(1);
      r.setSize(640, 480, false);
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.setClearColor(0x8daab9);
      return r;
    });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8daab9);
    this.scene.fog = new THREE.Fog(0x8daab9, 65, 125);
    this.scene.add(new THREE.HemisphereLight(0xd7eaff, 0x5b513b, 2.4));
    const sun = new THREE.DirectionalLight(0xffe2b3, 2.3);
    sun.position.set(-12, 22, 14);
    this.scene.add(sun);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 110),
      this.material(0x496747),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    this.scene.add(ground);
    this.effects = new Effects(this.scene);
    this.audio = new SoundMixer();
    this.physics = new DestructionWorld({ onEvent: (e) => this.event(e) });
    this.physics.beforeStep = () => {
      this.characters.beforeStep(FIXED_DT, this.input());
      this.updateCannons(FIXED_DT);
    };
    this.cannons = [0, 1].map((p) => this.fallbackCannon(p));
    this.wood = [];
    this.buildCastle(0);
    this.buildCastle(1);
    this.physics.connect();
    this.buildInstances();
    this.characters = new Characters(this.physics, {
      onDamage: (id) => {
        this.shake[id] = 0.12;
      },
    });
    this.physics.characters = this.characters;
    for (const sign of [-1, 1]) {
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.75, 1.6),
        this.material(0x6b5135),
      );
      deck.position.set(sign * 21.1, 0.375, 0);
      this.scene.add(deck);
    }
    this.characterModels = [0, 1].map((id) => {
      const root = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.3, 1.1, 4, 8),
        this.material(id === 0 ? 0x426ab3 : 0xb36a42),
      );
      root.userData.fallbackCharacter = true;
      this.scene.add(root);
      return root;
    });
    this.characterState = "Laddar Mr Trebuchet";
    this.characterReady = loadCharacter()
      .then((asset) => {
        if (this.disposed) return;
        this.characterModels.forEach((old, id) => {
          this.disposeObject(old);
          const root = asset.root.clone(true);
          this.scene.add(root);
          this.characterModels[id] = root;
        });
        this.characterState = asset.url;
      })
      .catch((e) => {
        if (!this.disposed) {
          this.characterState = "Kapselreserv: " + e.message;
          console.warn("Karaktär:", e.message);
        }
      });
    this.cameras = [0, 1].map((p) => {
      const camera = new THREE.PerspectiveCamera(68, 4 / 3, 0.1, 150);
      camera.position.set(p === 0 ? -22 : 22, 3.6, 3.5);
      return camera;
    });
    this.ready = loadModels()
      .then((assets) => {
        if (this.disposed) return;
        this.assets = assets;
        this.cannons.forEach((old, p) => {
          this.disposeObject(old.root);
          const c = createCannonVisual(assets);
          c.root.position.set(p === 0 ? -18 : 18, 0.12, 0);
          this.cannons[p] = c;
          this.scene.add(c.root);
        });
        this.modelState = "2 × cannon.glb · " + assets.ballStatus;
        this.updateCannons(0);
      })
      .catch((error) => {
        if (!this.disposed) {
          this.modelState = "Reservkanoner";
          this.modelError = error.message;
          console.warn("Kanonmodell:", error.message);
        }
      });
    this.temp = new THREE.Object3D();
    this.frames = 0;
    this.since = performance.now();
    this.fps = 0;
    this.renderMs = 0;
    this.renderSamples = [];
    this.physicsSamples = [];
    this.render();
  }
  material(color) {
    return new THREE.MeshLambertMaterial({ color, flatShading: true });
  }
  fallbackCannon(p) {
    const root = new THREE.Group(),
      elevation = new THREE.Group(),
      recoil = new THREE.Group(),
      muzzle = new THREE.Object3D();
    root.position.set(p === 0 ? -18 : 18, 0.12, 0);
    elevation.position.set(0, 1.7, 0);
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.3, 1.6),
      this.material(0x544639),
    );
    base.position.y = 0.65;
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.4, 3.8, 9),
      this.material(0x33383e),
    );
    barrel.rotation.z = -Math.PI / 2;
    barrel.position.x = 0.4;
    muzzle.position.x = 2.3;
    recoil.add(barrel, muzzle);
    elevation.add(recoil);
    root.add(base, elevation);
    this.scene.add(root);
    return { root, elevation, recoil, muzzle, model: "fallback", parts: 2 };
  }
  buildCastle(owner) {
    const sign = owner === 0 ? -1 : 1;
    const add = (x, y, z) => this.physics.addBlock({ x, y, z, owner });
    for (let z = -6; z <= 6; z++)
      for (let row = 0; row < 8; row++) {
        // Firing embrasure: the real muzzle can fire through its own castle.
        if (Math.abs(z) <= 1 && row <= 5) continue;
        add(sign * 11.9, 0.36 + row * 0.75, z * 0.98);
      }
    for (let j = 0; j < 7; j++)
      for (let row = 0; row < 6; row++) {
        add(sign * (13 + j * 1.06), 0.36 + row * 0.75, -6.8);
        add(sign * (13 + j * 1.06), 0.36 + row * 0.75, 6.8);
      }
    for (let z = -6; z <= 6; z += 2) add(sign * 11.9, 6.36, z * 0.98);
    const crateBlock = this.physics.addBlock({
      x: sign * 16,
      y: 0.5,
      z: -3,
      sx: 1,
      sy: 1,
      sz: 1,
      owner: owner + 2,
      density: 450,
      strength: 600,
    });
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      this.material(0x715033),
    );
    crate.userData.flammable = true;
    crate.position.copy(crateBlock.body.position);
    crateBlock.visual = crate;
    this.wood.push({ object: crate, block: crateBlock });
    this.scene.add(crate);
  }
  buildInstances() {
    this.stoneMeshes = [0, 1].map((owner) => {
      const blocks = this.physics.blocks.filter((b) => b.owner === owner);
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1.06, 0.72, 0.94),
        this.material(owner === 0 ? 0x8d958f : 0xa68f7c),
        blocks.length,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      const t = new THREE.Object3D();
      blocks.forEach((block, index) => {
        block.instance = index;
        block.mesh = mesh;
        t.position.copy(block.body.position);
        t.updateMatrix();
        mesh.setMatrixAt(index, t.matrix);
      });
      this.scene.add(mesh);
      return mesh;
    });
  }
  updateCannons(dt) {
    const keys = this.input();
    for (let p = 0; p < 2; p++) {
      const k = (key) => keys[(p ? "g:" : "") + key];
      const aim = this.aim[p],
        v = this.aimVelocity[p];
      const operator = this.characters.players[p];
      const yaw =
        (Number(!!(k("d") || k("arrowright"))) -
          Number(!!(k("a") || k("arrowleft")))) *
        0.55;
      const up =
        (Number(!!(k("w") || k("arrowup"))) -
          Number(!!(k("s") || k("arrowdown")))) *
        0.35;
      const blend = 1 - Math.exp(-dt * 10);
      const axis = operator.axes;
      v.yaw +=
        ((operator.mounted
          ? Math.max(-0.55, Math.min(0.55, yaw + axis.x * 0.55))
          : 0) -
          v.yaw) *
        blend;
      v.up +=
        ((operator.mounted
          ? Math.max(-0.35, Math.min(0.35, up + axis.z * 0.35))
          : 0) -
          v.up) *
        blend;
      aim.yaw = THREE.MathUtils.clamp(aim.yaw + v.yaw * dt, -0.58, 0.58);
      aim.up = THREE.MathUtils.clamp(aim.up + v.up * dt, -0.08, 0.58);
      if (operator.mounted) {
        operator.yaw = p === 0 ? aim.yaw : Math.PI - aim.yaw;
        operator.pitch = aim.up;
      }
      this.recoil[p] *= Math.exp(-dt * 9);
      this.shake[p] *= Math.exp(-dt * 12);
      const c = this.cannons[p];
      c.root.rotation.y = p === 0 ? -aim.yaw : Math.PI + aim.yaw;
      c.elevation.rotation.z = aim.up;
      c.recoil.position.x = -this.recoil[p];
      c.root.updateMatrixWorld(true);
    }
  }
  muzzle(p) {
    const c = this.cannons[p];
    c.root.updateMatrixWorld(true);
    return {
      position: c.muzzle.getWorldPosition(new THREE.Vector3()),
      direction: new THREE.Vector3(1, 0, 0).transformDirection(
        c.muzzle.matrixWorld,
      ),
    };
  }
  fire(p) {
    if (
      !this.combatEnabled ||
      !this.characters.players[p].mounted ||
      this.characters.damage.ended
    )
      return false;
    const now = performance.now() / 1000,
      spec = AMMO[this.ammo[p]];
    if (now - this.lastShot[p] < spec.reload) return;
    this.lastShot[p] = now;
    const { position, direction } = this.muzzle(p);
    this.lastMuzzles[p] = {
      position: position.toArray(),
      direction: direction.toArray(),
      model: this.cannons[p].model,
    };
    this.physics.shoot({ position, direction, owner: p, ammo: this.ammo[p] });
    this.effects.muzzle(position, direction);
    this.audio.event("shot", position);
    this.recoil[p] = this.ammo[p] === "heavy" ? 0.32 : 0.14;
    this.shake[p] = 0.045;
  }
  look(p, x, y) {
    if (this.characters.damage.ended) return;
    if (this.characters.players[p].mounted) {
      this.aim[p].yaw = THREE.MathUtils.clamp(
        this.aim[p].yaw + (p === 0 ? x : -x),
        -0.58,
        0.58,
      );
      this.aim[p].up = THREE.MathUtils.clamp(this.aim[p].up + y, -0.08, 0.58);
    } else this.characters.look(p, x, y);
  }
  motion(p, x, z) {
    this.characters.motion(p, x, z);
  }
  interact(p) {
    return this.characters.interact(p, this.aim[p]);
  }
  unlockAudio() {
    return this.audio.unlock();
  }
  getGuestAudioTrack() {
    return this.audio.track;
  }
  event(e) {
    if (this.disposed) return;
    if (e.type === "detach") {
      if (e.block.owner < 2) this.counts[e.block.owner]++;
    } else if (e.type === "impact") {
      this.audio?.event("impact", e.point, e.energy);
      this.effects.impact(e.point, e.energy);
      if (e.energy > 10000)
        for (const wood of this.wood)
          if (
            wood.object.position.distanceTo(new THREE.Vector3().copy(e.point)) <
            2
          )
            this.effects.ignite(wood.object);
    } else if (e.type === "collapse") {
      this.effects.collapse(e.point, e.count);
      this.audio?.event("collapse", e.point, e.count * 3000);
    } else if (e.type === "rubble-impact") {
      if (e.energy > 2000) this.audio?.event("rubble", e.point, e.energy);
      this.effects.emit(
        "dust",
        e.point,
        Math.min(16, Math.round(e.energy / 1500)),
        1,
      );
    }
  }
  stress() {
    this.effects.stress();
  }
  ignite() {
    for (const wood of this.wood) this.effects.ignite(wood.object);
  }
  visuals() {
    for (const b of this.physics.blocks) {
      if (b.visual) {
        b.visual.position.copy(b.body.position);
        b.visual.quaternion.copy(b.body.quaternion);
        continue;
      }
      if (b.state === "supported") continue;
      this.temp.position.copy(b.body.position);
      this.temp.quaternion.copy(b.body.quaternion);
      this.temp.scale.setScalar(1);
      this.temp.updateMatrix();
      b.mesh.setMatrixAt(b.instance, this.temp.matrix);
    }
    for (const mesh of this.stoneMeshes) mesh.instanceMatrix.needsUpdate = true;
    for (const [shot, mesh] of this.projectileMeshes)
      if (!this.physics.projectiles.includes(shot)) {
        this.disposeObject(mesh);
        this.projectileMeshes.delete(shot);
      }
    for (const shot of this.physics.projectiles) {
      if (!this.projectileMeshes.has(shot)) {
        let mesh;
        if (this.assets?.ball) {
          mesh = this.assets.ball.clone(true);
          mesh.scale.multiplyScalar(shot.radius);
        } else
          mesh = new THREE.Mesh(
            new THREE.SphereGeometry(shot.radius, 10, 8),
            this.material(shot.ammo === "light" ? 0xe2c78b : 0x242a2d),
          );
        this.scene.add(mesh);
        this.projectileMeshes.set(shot, mesh);
      }
      const mesh = this.projectileMeshes.get(shot);
      mesh.position.copy(shot.body.position);
      mesh.quaternion.copy(shot.body.quaternion);
    }
  }
  render() {
    if (this.disposed) return;
    const now = performance.now(),
      dt = this.previous ? Math.max(0, (now - this.previous) / 1000) : 0;
    this.previous = now;
    if (!this.characters.damage.ended) this.physics.advance(dt);
    else
      this.shake = this.shake.map((s) => s * Math.exp(-Math.min(dt, 0.1) * 12));
    this.visuals();
    this.effects.update(Math.min(dt, 0.1));
    const state = this.characters.snapshot();
    for (let p = 0; p < 2; p++) {
      const player = state.players[p],
        camera = this.cameras[p],
        root = this.characterModels[p];
      root.position.copy(player.position);
      if (!root.userData.fallbackCharacter)
        root.position.y -= CHARACTER.height / 2;
      root.rotation.y = -player.yaw;
      camera.position.copy(player.eye);
      camera.position.y += Math.sin(now * 0.08) * this.shake[p];
      camera.lookAt(
        camera.position
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos(player.yaw) * Math.cos(player.pitch),
              Math.sin(player.pitch),
              Math.sin(player.yaw) * Math.cos(player.pitch),
            ),
          ),
      );
    }
    this.audio.setListeners(
      state.players.map((p) => ({ position: p.eye, yaw: p.yaw })),
    );
    if (!this.lastState || now - this.lastState > 100) {
      this.lastState = now;
      this.onState?.(state);
    }
    const before = performance.now();
    this.characterModels[0].visible = false;
    this.renderers[0].render(this.scene, this.cameras[0]);
    this.characterModels[0].visible = true;
    this.characterModels[1].visible = false;
    this.renderers[1].render(this.scene, this.cameras[1]);
    this.characterModels[1].visible = true;
    this.renderMs = performance.now() - before;
    this.renderSamples.push(this.renderMs);
    this.physicsSamples.push(this.physics.lastStepMs);
    if (this.renderSamples.length > 180) {
      this.renderSamples.shift();
      this.physicsSamples.shift();
    }
    this.frames++;
    if (now - this.since > 1000) {
      this.fps = (this.frames * 1000) / (now - this.since);
      this.frames = 0;
      this.since = now;
      const s = this.physics.stats();
      $("fps").textContent = this.fps.toFixed(0) + " fps";
      $("stats").textContent =
        `${this.modelState}${this.modelError ? " · " + this.modelError : ""}\nRendering: 2 × 640×480 · ${this.renderMs.toFixed(1)} ms · ${this.fps.toFixed(0)} fps\nFysik: Cannon-es · 60 Hz · ${s.physicsMs.toFixed(2)} ms/steg\nRigidbodies: ${s.active} aktiva · ${s.sleeping} sovande · ${s.supported} burna · ${s.projectiles} kulor\nKaraktärer: 2 kapslar · HP ${this.characters.damage.players.map((p) => Math.ceil(p.hp)).join(" / ")}\nStrukturförbindelser: ${s.brokenBonds}/${s.totalBonds} brutna\nKosmetiska fragment: ${this.effects.activeFragments}/20000 · partiklar: ${this.effects.active}/2400\nAmmo: ${this.ammo[0]} (host), ${this.ammo[1]} (gäst)\nWebRTC: ${window.KanonLobby?.connectionState || "ej ansluten"} · ${window.KanonLobby?.bitrateKbps?.toFixed(0) || "–"} kbit/s\nTidsbudget: ${s.droppedTime.toFixed(2)} s förkastad vid långa bildrutor`;
    }
    this.raf = requestAnimationFrame(() => this.render());
  }
  snapshot() {
    return {
      characters: this.characters.snapshot(),
      characterModel: this.characterState,
      audio: this.audio.snapshot(),
      cameras: this.cameras.map((c) => ({
        position: c.position.toArray(),
        direction: c.getWorldDirection(new THREE.Vector3()).toArray(),
      })),
      aim: this.aim.map((a) => ({ ...a })),
      ammo: [...this.ammo],
      shots: [...this.lastShot],
      destroyed: [...this.counts],
      fragments: this.effects.activeFragments,
      projectiles: this.physics.projectiles.length,
      physics: {
        ...this.physics.stats(),
        movedBlocks: this.physics.blocks.filter(
          (b) =>
            b.state !== "supported" &&
            b.body.position.distanceTo(b.initial) > 0.3,
        ).length,
        fallenBlocks: this.physics.blocks.filter(
          (b) =>
            b.state !== "supported" && b.body.position.y < b.initial.y - 0.3,
        ).length,
      },
      models: this.cannons.map((c) => ({ model: c.model, parts: c.parts })),
      modelState: this.modelState,
      modelError: this.modelError,
      muzzles: this.lastMuzzles.map((m) =>
        m
          ? {
              position: [...m.position],
              direction: [...m.direction],
              model: m.model,
            }
          : null,
      ),
      recoil: [...this.recoil],
      effects: {
        shots: this.effects.shots,
        hits: this.effects.hits,
        active: this.effects.active,
        fires: this.effects.fires.size,
      },
      lastImpact: this.physics.lastImpact
        ? structuredClone(this.physics.lastImpact)
        : null,
      fps: this.fps,
      renderMs: this.renderMs,
      renderSamples: [...this.renderSamples],
      physicsSamples: [...this.physicsSamples],
    };
  }
  disposeObject(object) {
    this.scene.remove(object);
    const geo = new Set(),
      materials = new Set();
    object.traverse((o) => {
      if (o.userData.sharedAsset) return;
      if (o.geometry) geo.add(o.geometry);
      if (o.material)
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          materials.add(m);
    });
    geo.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.characters.dispose();
    this.audio.dispose();
    this.physics.dispose();
    this.effects.dispose();
    for (const child of [...this.scene.children]) this.disposeObject(child);
    this.renderers.forEach((r) => r.dispose());
    this.projectileMeshes.clear();
    this.scene.clear();
  }
}
