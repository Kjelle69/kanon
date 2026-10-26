import * as C from "../vendor/cannon-es.js";
export const FIXED_DT = 1 / 60;
export const AMMO = Object.freeze({
  light: Object.freeze({ mass: 12, speed: 40, radius: 0.11, reload: 2 }),
  heavy: Object.freeze({ mass: 160, speed: 28, radius: 0.24, reload: 6 }),
});
const vec = (p) => new C.Vec3(p.x, p.y, p.z);
const length = (p) => Math.hypot(p.x, p.y, p.z);

// Segment against a sphere-expanded oriented box. This conservative Minkowski
// approximation covers thin walls and moving/rotated rubble without tunneling.
export function sweptBox(from, to, radius, block) {
  const inv = block.body.quaternion.inverse();
  const a = inv.vmult(vec(from).vsub(block.body.position));
  const b = inv.vmult(vec(to).vsub(block.body.position));
  let enter = 0,
    exit = 1,
    axis = 0,
    sign = 1;
  for (const [i, key] of ["x", "y", "z"].entries()) {
    const h = block.half[key] + radius,
      d = b[key] - a[key];
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(a[key]) > h) return null;
      continue;
    }
    let lo = (-h - a[key]) / d,
      hi = (h - a[key]) / d;
    const n = d > 0 ? -1 : 1;
    if (lo > hi) [lo, hi] = [hi, lo];
    if (lo > enter) {
      enter = lo;
      axis = i;
      sign = n;
    }
    exit = Math.min(exit, hi);
    if (enter > exit) return null;
  }
  if (exit < 0 || enter > 1) return null;
  const normal = new C.Vec3();
  normal[["x", "y", "z"][axis]] = sign;
  return { t: Math.max(0, enter), normal: block.body.quaternion.vmult(normal) };
}

// Future mesh-fracture implementations may replace a block (even a detached one)
// using a fragment plan. No fake pre-authored collapse animation is used here.
export class FractureStrategy {
  plan(_block, _impact) {
    return null;
  }
}
export class DestructionWorld {
  constructor({
    onEvent = () => {},
    fracture = new FractureStrategy(),
    gravity = 9.81,
  } = {}) {
    this.world = new C.World({
      gravity: new C.Vec3(0, -gravity, 0),
      allowSleep: true,
    });
    this.world.broadphase = new C.SAPBroadphase(this.world);
    this.world.solver.iterations = 10;
    this.world.defaultContactMaterial.friction = 0.65;
    this.world.defaultContactMaterial.restitution = 0.04;
    this.blocks = [];
    this.bonds = [];
    this.projectiles = [];
    this.nextShot = 1;
    this.onEvent = onEvent;
    this.fracture = fracture;
    this.time = 0;
    this.accumulator = 0;
    this.droppedTime = 0;
    this.steps = 0;
    this.lastStepMs = 0;
    this.impacts = [];
    this.dirty = false;
    this.lastContacts = new Map();
    this.detached = 0;
    this.broken = 0;
    this.lastImpact = null;
    const floor = new C.Body({ mass: 0, shape: new C.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    floor.aabbNeedsUpdate = true;
    this.world.addBody(floor);
  }
  addBlock({
    x,
    y,
    z,
    sx = 1.06,
    sy = 0.72,
    sz = 0.94,
    owner = 0,
    density = 1600,
    strength = 2200,
    loadCapacity = 180000,
  }) {
    const half = new C.Vec3(sx / 2, sy / 2, sz / 2),
      mass = sx * sy * sz * density;
    const body = new C.Body({
      mass: 0,
      type: C.Body.STATIC,
      position: new C.Vec3(x, y, z),
      shape: new C.Box(half),
      allowSleep: true,
      sleepSpeedLimit: 0.18,
      sleepTimeLimit: 1.2,
      linearDamping: 0.08,
      angularDamping: 0.15,
    });
    const block = {
      id: this.blocks.length,
      body,
      half,
      mass,
      owner,
      strength,
      loadCapacity,
      damage: 0,
      state: "supported",
      bonds: [],
      foundation: y - sy / 2 < 0.08,
      initial: { x, y, z },
      lastDust: -10,
    };
    body.block = block;
    body.addEventListener("collide", (event) => {
      if (block.state === "supported") return;
      const speed = Math.abs(event.contact.getImpactVelocityAlongNormal());
      if (speed < 1.8) return;
      const other = event.body.block;
      const pair = other
        ? [block.id, other.id].sort((a, b) => a - b).join(":")
        : `floor:${block.id}`;
      if ((this.lastContacts.get(pair) ?? -10) + 0.3 > this.time) return;
      this.lastContacts.set(pair, this.time);
      const energy =
        0.5 * Math.min(block.mass, other?.mass ?? block.mass) * speed * speed;
      this.impacts.push({
        block: other,
        source: block,
        energy,
        point: { ...body.position },
        direction: { ...body.velocity },
      });
    });
    this.blocks.push(block);
    this.world.addBody(body);
    this.dirty = true;
    return block;
  }
  connect() {
    // Contacts across thin mortar gaps; no diagonal/corner support edges.
    for (let i = 0; i < this.blocks.length; i++)
      for (let j = i + 1; j < this.blocks.length; j++) {
        const a = this.blocks[i],
          b = this.blocks[j];
        if (a.owner !== b.owner) continue;
        const d = ["x", "y", "z"].map((k) =>
          Math.abs(a.initial[k] - b.initial[k]),
        );
        const hs = ["x", "y", "z"].map((k) => a.half[k] + b.half[k]);
        let face = -1;
        for (let k = 0; k < 3; k++)
          if (
            Math.abs(d[k] - hs[k]) < 0.1 &&
            d[(k + 1) % 3] < hs[(k + 1) % 3] - 0.1 &&
            d[(k + 2) % 3] < hs[(k + 2) % 3] - 0.1
          )
            face = k;
        if (face < 0) continue;
        const bond = {
          a,
          b,
          vertical: face === 1,
          health: 1,
          capacity: Math.min(a.loadCapacity, b.loadCapacity),
          broken: false,
        };
        a.bonds.push(bond);
        b.bonds.push(bond);
        this.bonds.push(bond);
      }
    this.evaluateSupport();
  }
  breakBond(bond) {
    if (!bond.broken) {
      bond.broken = true;
      bond.health = 0;
      this.broken++;
      this.dirty = true;
    }
  }
  detach(block, reason = "support-lost") {
    if (block.state !== "supported") return;
    block.state = "dynamic";
    this.detached++;
    for (const bond of block.bonds) this.breakBond(bond);
    const b = block.body;
    b.type = C.Body.DYNAMIC;
    b.mass = block.mass;
    b.updateMassProperties();
    b.updateSolveMassProperties();
    b.aabbNeedsUpdate = true;
    b.wakeUp();
    this.world.broadphase.dirty = true;
    this.onEvent({ type: "detach", block, point: { ...b.position }, reason });
  }
  evaluateSupport() {
    this.dirty = false;
    // Rooted support graph: gravity can carry load upward and mortar may bridge
    // at most two block widths sideways. It cannot obtain support from above.
    const distance = new Map(),
      queue = [];
    for (const b of this.blocks)
      if (b.state === "supported" && b.foundation) {
        distance.set(b.id, 0);
        queue.push(b);
      }
    for (let i = 0; i < queue.length; i++) {
      const a = queue[i],
        span = distance.get(a.id);
      for (const edge of a.bonds) {
        if (edge.broken || edge.health < 0.15) continue;
        const b = edge.a === a ? edge.b : edge.a;
        if (b.state !== "supported" || b.initial.y < a.initial.y - 0.1)
          continue;
        const cost = span + (edge.vertical ? 0 : 1),
          old = distance.get(b.id) ?? Infinity;
        if (cost <= 2 && cost < old) {
          distance.set(b.id, cost);
          queue.push(b);
        }
      }
    }
    // Approximate vertical load distribution. Damaged mortar has proportionally
    // less capacity; overload breaks connections and is resolved in a new pass.
    const loads = new Map(this.blocks.map((b) => [b.id, b.mass * 9.81]));
    const ordered = this.blocks
      .filter((b) => b.state === "supported" && distance.has(b.id))
      .sort((a, b) => b.initial.y - a.initial.y);
    for (const b of ordered) {
      const down = b.bonds.filter(
        (e) =>
          !e.broken &&
          e.vertical &&
          (e.a === b ? e.b : e.a).initial.y < b.initial.y,
      );
      for (const e of down) {
        const share = loads.get(b.id) / down.length;
        if (share > e.capacity * e.health) this.breakBond(e);
        else {
          const a = e.a === b ? e.b : e.a;
          loads.set(a.id, loads.get(a.id) + share);
        }
      }
    }
    const lost = this.blocks.filter(
      (b) => b.state === "supported" && !distance.has(b.id),
    );
    for (const b of lost) this.detach(b);
    if (lost.length >= 3)
      this.onEvent({
        type: "collapse",
        point: { ...lost[0].body.position },
        count: lost.length,
      });
  }
  damage(block, energy, point, direction, impulse = 0) {
    if (!block) return;
    block.damage += energy / block.strength;
    for (const bond of block.bonds) {
      if (bond.broken) continue;
      bond.health -= energy / (block.strength * 2);
      if (bond.health <= 0.15) this.breakBond(bond);
    }
    if (block.damage >= 1) this.detach(block, "impact");
    if (block.state !== "supported" && impulse > 0) {
      const d = vec(direction);
      const n = d.length();
      if (n > 0) d.scale(impulse / n, d);
      block.body.applyImpulse(d, vec(point).vsub(block.body.position));
    }
    this.dirty = true;
  }
  impact(block, point, velocity, mass, radius, normal = null) {
    const speed = length(velocity);
    const normalSpeed = normal
      ? Math.max(0, -vec(velocity).dot(vec(normal)))
      : speed;
    const incidence = speed > 0 ? Math.min(1, normalSpeed / speed) : 0;
    const energy =
        0.5 * mass * speed * speed * (0.1 + 0.9 * incidence * incidence),
      impulse = mass * speed * (0.1 + 0.9 * incidence);
    this.lastImpact = {
      energy,
      impulse,
      point: { ...point },
      block: block.id,
      owner: block.owner,
      normalSpeed,
    };
    const fracturePlan = this.fracture.plan(block, this.lastImpact);
    if (fracturePlan)
      this.onEvent({ type: "fracture-plan", block, plan: fracturePlan });
    this.damage(block, energy * 0.65, point, velocity, impulse * 0.75);
    const near = this.blocks.filter(
      (b) =>
        b !== block &&
        b.state === "supported" &&
        b.body.position.distanceTo(vec(point)) < 1.6 + radius,
    );
    const weights = near.map(
      (b) => 1 / (0.5 + b.body.position.distanceSquared(vec(point))),
    );
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    near.forEach((b, i) =>
      this.damage(
        b,
        (energy * 0.35 * weights[i]) / total,
        point,
        velocity,
        (impulse * 0.25 * weights[i]) / total,
      ),
    );
    this.onEvent({
      type: "impact",
      point: { ...point },
      energy,
      impulse,
      block,
    });
  }
  shoot({ position, direction, owner = 0, ammo = "heavy", speed }) {
    const spec = AMMO[ammo];
    if (!spec) throw Error("Unknown ammunition");
    const d = vec(direction);
    d.normalize();
    const velocity = d.scale(speed ?? spec.speed);
    const body = new C.Body({
      mass: spec.mass,
      position: vec(position),
      velocity,
      shape: new C.Sphere(spec.radius),
      linearDamping: 0,
      collisionFilterMask: 0,
      allowSleep: false,
    });
    // Ball contact is resolved by a conservative swept sphere before each step;
    // rubble contacts themselves use Cannon's complete rigid-body solver.
    this.world.addBody(body);
    const shot = {
      id: this.nextShot++,
      body,
      owner,
      ammo,
      ...spec,
      age: 0,
      hit: false,
    };
    this.projectiles.push(shot);
    return shot;
  }
  advance(seconds) {
    const accepted = Math.min(Math.max(seconds, 0), 0.1);
    this.droppedTime += Math.max(0, seconds - accepted);
    this.accumulator += accepted;
    let count = 0;
    while (
      this.accumulator + 1e-9 >= FIXED_DT &&
      count < 6 &&
      !this.characters?.damage.ended
    ) {
      this.step();
      this.accumulator -= FIXED_DT;
      count++;
    }
    return count;
  }
  step() {
    const start = performance.now();
    this.beforeStep?.();
    for (const shot of this.projectiles) {
      const from = shot.body.position;
      const to = from.vadd(shot.body.velocity.scale(FIXED_DT));
      to.y += this.world.gravity.y * FIXED_DT * FIXED_DT;
      let first = null;
      for (const block of this.blocks) {
        const hit = sweptBox(from, to, shot.radius, block);
        if (hit && (!first || hit.t < first.t)) first = { ...hit, block };
      }
      const floorT =
        to.y < shot.radius
          ? Math.max(0, (from.y - shot.radius) / (from.y - to.y))
          : Infinity;
      const person = this.characters?.sweep(from, to, shot.radius);
      if (person && person.t <= (first?.t ?? Infinity) && person.t <= floorT) {
        const point = new C.Vec3();
        from.lerp(to, person.t, point);
        this.characters.resolve(shot, point, person.player);
        this.onEvent({
          type: "impact",
          point,
          energy: 0.5 * shot.mass * shot.body.velocity.lengthSquared(),
          block: null,
        });
        shot.hit = true;
      } else if (first && first.t <= floorT) {
        const point = new C.Vec3();
        from.lerp(to, first.t, point);
        shot.body.position.copy(point);
        this.impact(
          first.block,
          point,
          shot.body.velocity,
          shot.mass,
          shot.radius,
          first.normal,
        );
        this.characters?.resolve(shot, point);
        shot.hit = true;
      } else if (floorT <= 1) {
        const point = new C.Vec3();
        from.lerp(to, floorT, point);
        point.y = 0;
        this.characters?.resolve(shot, point);
        this.onEvent({
          type: "impact",
          point,
          energy: 0.5 * shot.mass * shot.body.velocity.lengthSquared(),
          block: null,
        });
        shot.hit = true;
      }
      shot.age += FIXED_DT;
      if (shot.age > 8) shot.hit = true;
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--)
      if (this.projectiles[i].hit) {
        const s = this.projectiles[i];
        this.world.removeBody(s.body);
        this.projectiles.splice(i, 1);
      }
    // Run enough graph passes for overload-induced breaks to reach equilibrium.
    for (let pass = 0; this.dirty && pass < 4; pass++) this.evaluateSupport();
    this.world.step(FIXED_DT);
    this.time += FIXED_DT;
    this.characters?.afterStep();
    this.steps++;
    for (const hit of this.impacts.splice(0, 24)) {
      if (hit.block?.state === "supported")
        this.damage(hit.block, hit.energy * 0.4, hit.point, hit.direction);
      this.onEvent({
        type: "rubble-impact",
        point: hit.point,
        energy: hit.energy,
      });
    }
    this.impacts.length = 0;
    if (this.steps % 600 === 0)
      for (const [key, t] of this.lastContacts)
        if (t < this.time - 1) this.lastContacts.delete(key);
    this.lastStepMs = performance.now() - start;
  }
  stats() {
    const dynamic = this.blocks.filter((b) => b.state !== "supported");
    return {
      supported: this.blocks.length - dynamic.length,
      active: dynamic.filter((b) => b.body.sleepState !== C.Body.SLEEPING)
        .length,
      sleeping: dynamic.filter((b) => b.body.sleepState === C.Body.SLEEPING)
        .length,
      detached: this.detached,
      brokenBonds: this.broken,
      totalBonds: this.bonds.length,
      projectiles: this.projectiles.length,
      physicsMs: this.lastStepMs,
      steps: this.steps,
      droppedTime: this.droppedTime,
    };
  }
  dispose() {
    for (const body of [...this.world.bodies]) this.world.removeBody(body);
    this.blocks.length =
      this.bonds.length =
      this.projectiles.length =
      this.impacts.length =
        0;
    this.lastContacts.clear();
  }
}
