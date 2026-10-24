import { test } from "node:test";
import assert from "node:assert/strict";
import { DestructionWorld, AMMO, sweptBox } from "../public/game/physics.js";

test("fixed-step ballistics is independent of render rate and preserves mass/energy", () => {
  const a = new DestructionWorld(),
    b = new DestructionWorld();
  const opts = {
    position: { x: 0, y: 20, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    speed: 100,
    ammo: "heavy",
  };
  const sa = a.shoot(opts),
    sb = b.shoot(opts);
  for (let i = 0; i < 60; i++) a.advance(1 / 60);
  for (let i = 0; i < 30; i++) b.advance(1 / 30);
  assert.equal(a.steps, 60);
  assert.equal(b.steps, 60);
  assert.ok(sa.body.position.distanceTo(sb.body.position) < 1e-8);
  assert.ok(Math.abs(sa.body.position.x - 100) < 0.01);
  assert.ok(Math.abs(sa.body.position.y - (20 - 9.81 / 2)) < 0.1);
  assert.ok(
    0.5 * AMMO.heavy.mass * AMMO.heavy.speed ** 2 >
      0.5 * AMMO.light.mass * AMMO.light.speed ** 2,
  );
  a.dispose();
  b.dispose();
});
test("swept sphere hits a thin wall at 600 m/s and transfers mass-based impulse", () => {
  const w = new DestructionWorld();
  const block = w.addBlock({ x: 5, y: 3, z: 0, sx: 0.15, sy: 2, sz: 2 });
  w.connect();
  // Isolated floating block detaches before the shot; swept collision must hit moving rubble too.
  const shot = w.shoot({
    position: { x: 0, y: 3, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    speed: 600,
  });
  w.step();
  assert.equal(w.projectiles.length, 0);
  assert.ok(w.lastImpact.energy > 1000000);
  assert.equal(w.lastImpact.block, block.id);
  assert.ok(block.body.velocity.x > 0);
  assert.equal(shot.hit, true);
  w.dispose();
});
test("destroying a foundation removes support, releases upper blocks, collides, sleeps and wakes", () => {
  const events = [],
    w = new DestructionWorld({ onEvent: (e) => events.push(e.type) });
  const column = [];
  for (let i = 0; i < 5; i++)
    column.push(w.addBlock({ x: 0, y: 0.36 + i * 0.75, z: 0 }));
  w.connect();
  assert.equal(w.stats().supported, 5);
  assert.ok(w.bonds.length >= 4);
  w.damage(
    column[0],
    10000,
    { x: 0, y: 0.3, z: 0 },
    { x: 1, y: 0, z: 0 },
    14000,
  );
  // Excavate the failed foundation: now the released column has no contact below.
  column[0].body.position.x = 5;
  column[0].body.aabbNeedsUpdate = true;
  let hadContacts = false;
  for (let i = 0; i < 480; i++) {
    w.step();
    hadContacts ||= w.world.contacts.length > 0;
  }
  assert.equal(w.stats().supported, 0);
  assert.ok(w.stats().brokenBonds >= 4);
  assert.ok(column.slice(1).some((b) => b.body.position.y < b.initial.y - 0.2));
  assert.ok(hadContacts);
  assert.ok(events.includes("rubble-impact"));
  assert.ok(w.stats().sleeping > 0);
  const b = column.find((b) => b.body.sleepState === 2);
  b.body.applyImpulse({ x: 1000, y: 1000, z: 0 });
  assert.notEqual(b.body.sleepState, 2);
  w.dispose();
  assert.equal(w.world.bodies.length, 0);
});
test("falling masonry damages another supported block through actual contact", () => {
  const w = new DestructionWorld();
  const base = w.addBlock({ x: 0, y: 0.36, z: 0, strength: 100 });
  const falling = w.addBlock({ x: 0, y: 5, z: 0 });
  w.connect();
  for (let i = 0; i < 120; i++) w.step();
  assert.ok(base.damage > 0);
  assert.equal(base.state, "dynamic");
  assert.ok(falling.body.position.y < 3);
  w.dispose();
});
test("sweep respects rotated rubble and misses unrelated trajectories", () => {
  const w = new DestructionWorld();
  const b = w.addBlock({ x: 2, y: 2, z: 0 });
  b.body.quaternion.setFromEuler(0, Math.PI / 4, 0);
  assert.ok(sweptBox({ x: 0, y: 2, z: 0 }, { x: 4, y: 2, z: 0 }, 0.1, b));
  assert.equal(
    sweptBox({ x: 0, y: 5, z: 0 }, { x: 4, y: 5, z: 0 }, 0.1, b),
    null,
  );
  w.dispose();
});
test("grazing hits transfer less damaging energy and mortar weakens before breaking", () => {
  const w = new DestructionWorld();
  const b = w.addBlock({ x: 0, y: 0.36, z: 0 });
  const upper = w.addBlock({ x: 0, y: 1.11, z: 0 });
  w.connect();
  const bond = w.bonds[0];
  w.damage(upper, upper.strength * 0.2, upper.body.position, {
    x: 1,
    y: 0,
    z: 0,
  });
  assert.ok(bond.health < 1 && bond.health > 0);
  assert.equal(bond.broken, false);
  w.impact(b, { x: 0, y: 0.36, z: 0 }, { x: 30, y: 0, z: 0 }, 160, 0.24, {
    x: -1,
    y: 0,
    z: 0,
  });
  const normal = w.lastImpact.energy;
  w.impact(b, { x: 0, y: 0.36, z: 0 }, { x: 30, y: 0, z: 0 }, 160, 0.24, {
    x: 0,
    y: 0,
    z: 1,
  });
  assert.ok(w.lastImpact.energy < normal * 0.2);
  w.dispose();
});
test("overloaded mortar fails, and fracture strategy receives detached rubble impacts too", () => {
  let plans = 0;
  const w = new DestructionWorld({
    fracture: {
      plan(block, impact) {
        plans++;
        return { sourceBlock: block.id, energy: impact.energy };
      },
    },
  });
  const a = w.addBlock({ x: 0, y: 0.36, z: 0, loadCapacity: 1 });
  const b = w.addBlock({ x: 0, y: 1.11, z: 0, loadCapacity: 1 });
  w.connect();
  w.step();
  assert.ok(w.stats().brokenBonds > 0);
  assert.equal(b.state, "dynamic");
  w.impact(b, b.body.position, { x: 20, y: 0, z: 0 }, 12, 0.1);
  assert.equal(plans, 1);
  w.dispose();
});
