import * as C from "../vendor/cannon-es.js";
import { DamageSystem, sweepCapsule } from "./damage.js";
export const CHARACTER = Object.freeze({
  radius: 0.3,
  halfSegment: 0.55,
  height: 1.7,
  eye: 1.55,
  speed: 4,
  acceleration: 12,
  braking: 16,
  interactionRadius: 3.2,
  pitchLimit: (75 * Math.PI) / 180,
});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (v) => Math.atan2(Math.sin(v), Math.cos(v));
export class Characters {
  constructor(
    physics,
    { onDamage = () => {}, onInteraction = () => {}, damageConfig = {} } = {},
  ) {
    this.physics = physics;
    this.world = physics.world;
    this.pending = [];
    this.onInteraction = onInteraction;
    this.damage = new DamageSystem({
      clock: () => physics.time,
      cover: (a, b) => this.cover(a, b),
      onDamage,
      config: damageConfig,
    });
    const material = new C.Material({ friction: 0, restitution: 0 });
    this.world.addContactMaterial(
      new C.ContactMaterial(material, this.world.defaultMaterial, {
        friction: 0,
        restitution: 0,
      }),
    );
    this.players = [0, 1].map((id) => {
      const sign = id === 0 ? -1 : 1;
      const body = new C.Body({
        mass: 80,
        fixedRotation: true,
        position: new C.Vec3(sign * 20.2, 0.86, 1.8),
        material,
        linearDamping: 0,
        collisionFilterGroup: 2,
        collisionFilterMask: 1,
        allowSleep: false,
      });
      body.addShape(
        new C.Sphere(CHARACTER.radius),
        new C.Vec3(0, CHARACTER.halfSegment, 0),
      );
      body.addShape(
        new C.Cylinder(
          CHARACTER.radius,
          CHARACTER.radius,
          CHARACTER.halfSegment * 2,
          8,
        ),
      );
      body.addShape(
        new C.Sphere(CHARACTER.radius),
        new C.Vec3(0, -CHARACTER.halfSegment, 0),
      );
      this.world.addBody(body);
      const p = {
        id,
        body,
        yaw: id === 0 ? 0.1 : Math.PI - 0.1,
        pitch: 0,
        mounted: false,
        grounded: false,
        axes: { x: 0, z: 0 },
        lastInput: physics.time,
      };
      body.addEventListener("collide", (e) => {
        const block = e.body.block;
        if (
          !block ||
          block.state === "supported" ||
          e.body.sleepState === C.Body.SLEEPING
        )
          return;
        const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
        if (speed > 1.8)
          this.pending.push({ id, block: block.id, mass: block.mass, speed });
      });
      return p;
    });
    this.obstacles = [];
    for (let id = 0; id < 2; id++) {
      const sign = id === 0 ? -1 : 1;
      // Simple carriage proxy; barrel articulation remains a visual layer.
      this.obstacle(sign * 18, 1.05, 0, 2.2, 1.05, 1.0);
      this.obstacle(sign * 21.1, 0.375, 0, 0.7, 0.375, 0.8);
      // Private courts, including invisible outer boundaries. Projectiles use
      // their own swept tests and are not blocked by these gameplay boundaries.
      this.obstacle(sign * 24.3, 4, 0, 0.3, 4, 7);
      this.obstacle(sign * 10.2, 4, 0, 0.3, 4, 7);
      for (const z of [-6.5, 6.5]) this.obstacle(sign * 17, 4, z, 7, 4, 0.3);
    }
  }
  obstacle(x, y, z, hx, hy, hz) {
    const b = new C.Body({
      mass: 0,
      position: new C.Vec3(x, y, z),
      shape: new C.Box(new C.Vec3(hx, hy, hz)),
    });
    this.world.addBody(b);
    this.obstacles.push(b);
  }
  look(id, x, y) {
    if (this.damage.ended) return;
    const p = this.players[id];
    p.yaw = wrap(p.yaw + x);
    p.pitch = clamp(p.pitch + y, -CHARACTER.pitchLimit, CHARACTER.pitchLimit);
  }
  motion(id, x, z) {
    const p = this.players[id];
    p.axes = { x: clamp(x, -1, 1), z: clamp(z, -1, 1) };
    p.lastInput = this.physics.time;
  }
  interact(id, aim) {
    if (this.damage.ended || !this.damage.players[id].alive) return false;
    const p = this.players[id],
      sign = id === 0 ? -1 : 1;
    if (
      !p.mounted &&
      Math.hypot(p.body.position.x - sign * 18, p.body.position.z) >
        CHARACTER.interactionRadius
    )
      return false;
    p.mounted = !p.mounted;
    p.axes = { x: 0, z: 0 };
    if (p.mounted) {
      p.body.position.set(sign * 21.1, 1.6, 0);
      p.yaw = id === 0 ? aim.yaw : Math.PI - aim.yaw;
      p.pitch = aim.up;
      p.body.type = C.Body.KINEMATIC;
      p.body.mass = 0;
    } else {
      p.body.type = C.Body.DYNAMIC;
      p.body.mass = 80;
    }
    p.body.velocity.setZero();
    p.body.updateMassProperties();
    p.body.aabbNeedsUpdate = true;
    p.body.wakeUp();
    this.world.broadphase.dirty = true;
    this.onInteraction(id, p.mounted);
    return true;
  }
  beforeStep(dt, keys) {
    for (const p of this.players) {
      const alive = this.damage.players[p.id].alive;
      if (this.damage.ended || !alive) {
        p.body.velocity.setZero();
        continue;
      }
      if (p.id === 1 && this.physics.time - p.lastInput > 0.65) {
        p.axes = { x: 0, z: 0 };
        for (const key of Object.keys(keys))
          if (key.startsWith("g:")) keys[key] = false;
      }
      if (p.mounted) {
        p.body.velocity.setZero();
        continue;
      }
      const k = (key) => keys[(p.id ? "g:" : "") + key];
      // Guest motion is authoritative input (never a supplied position).
      const x =
        p.id === 0
          ? Number(!!(k("d") || k("arrowright"))) -
            Number(!!(k("a") || k("arrowleft"))) +
            p.axes.x
          : p.axes.x;
      const z =
        p.id === 0
          ? Number(!!(k("w") || k("arrowup"))) -
            Number(!!(k("s") || k("arrowdown"))) +
            p.axes.z
          : p.axes.z;
      const timeout = p.id === 1 && this.physics.time - p.lastInput > 0.65;
      const norm = Math.max(1, Math.hypot(x, z)),
        speed = CHARACTER.speed;
      const vx = timeout
        ? 0
        : ((Math.cos(p.yaw) * z - Math.sin(p.yaw) * x) / norm) * speed;
      const vz = timeout
        ? 0
        : ((Math.sin(p.yaw) * z + Math.cos(p.yaw) * x) / norm) * speed;
      const blend =
        1 -
        Math.exp(-dt * (x || z ? CHARACTER.acceleration : CHARACTER.braking));
      p.body.velocity.x += (vx - p.body.velocity.x) * blend;
      p.body.velocity.z += (vz - p.body.velocity.z) * blend;
    }
  }
  afterStep() {
    for (const p of this.players) {
      const ray = new C.RaycastResult();
      const from = p.body.position.clone(),
        to = from.clone();
      to.y -= 0.98;
      this.world.raycastClosest(from, to, { collisionFilterMask: 1 }, ray);
      p.grounded = ray.hasHit;
      // A safety clamp complements the physical court walls after large impulses.
      const sign = p.id === 0 ? -1 : 1;
      p.body.position.x = sign * clamp(sign * p.body.position.x, 10.8, 23.7);
      p.body.position.z = clamp(p.body.position.z, -5.9, 5.9);
      p.body.aabbNeedsUpdate = true;
      if (p.body.position.y < 0.7) {
        p.body.position.y = 0.85;
        p.body.velocity.y = Math.max(0, p.body.velocity.y);
      }
    }
    for (const h of this.pending.splice(0, 16))
      this.damage.stone(h.id, h.block, h.mass, h.speed);
    this.pending.length = 0;
  }
  cover(from, to) {
    // Only actual masonry is blast cover; invisible court boundaries are not.
    let factor = 1;
    const a = new C.Vec3(from.x, from.y, from.z),
      b = new C.Vec3(to.x, to.y, to.z);
    for (const block of this.physics.blocks) {
      const inv = block.body.quaternion.inverse(),
        x = inv.vmult(a.vsub(block.body.position)),
        y = inv.vmult(b.vsub(block.body.position));
      let lo = 0,
        hi = 1;
      for (const k of ["x", "y", "z"]) {
        const d = y[k] - x[k],
          h = block.half[k];
        if (Math.abs(d) < 1e-8) {
          if (Math.abs(x[k]) > h) {
            lo = 2;
            break;
          }
          continue;
        }
        let p = (-h - x[k]) / d,
          q = (h - x[k]) / d;
        if (p > q) [p, q] = [q, p];
        lo = Math.max(lo, p);
        hi = Math.min(hi, q);
      }
      if (lo <= hi && hi > 0.001 && lo < 0.999)
        factor = Math.min(factor, block.state === "supported" ? 0 : 0.35);
    }
    return factor;
  }
  sweep(from, to, radius) {
    let first = null;
    for (const p of this.players) {
      if (!this.damage.players[p.id].alive) continue;
      const t = sweepCapsule(
        from,
        to,
        p.body.position,
        CHARACTER.radius,
        CHARACTER.halfSegment,
        radius,
      );
      if (t !== null && (!first || t < first.t)) first = { t, player: p.id };
    }
    return first;
  }
  resolve(shot, point, direct = null) {
    if (shot.resolved) return;
    shot.resolved = true;
    if (direct !== null) this.damage.direct(shot.id, direct);
    this.damage.explode(
      shot.id,
      point,
      this.players.map((p) => p.body.position),
      direct,
    );
    this.damage.finishBatch();
  }
  eye(id) {
    const p = this.players[id];
    return {
      x: p.body.position.x,
      y: p.body.position.y - CHARACTER.height / 2 + CHARACTER.eye,
      z: p.body.position.z,
    };
  }
  snapshot() {
    return {
      ...this.damage.snapshot(),
      players: this.players.map((p, i) => ({
        ...this.damage.snapshot().players[i],
        position: { ...p.body.position },
        eye: this.eye(i),
        yaw: p.yaw,
        pitch: p.pitch,
        mounted: p.mounted,
        grounded: p.grounded,
      })),
    };
  }
  dispose() {
    for (const p of this.players) this.world.removeBody(p.body);
    for (const b of this.obstacles) this.world.removeBody(b);
    this.pending.length = 0;
  }
}
