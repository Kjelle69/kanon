import { test } from "node:test";
import assert from "node:assert/strict";
import { DestructionWorld, FIXED_DT } from "../public/game/physics.js";
import { Characters } from "../public/game/characters.js";
import {
  DamageSystem,
  blastDamage,
  sweepCapsule,
} from "../public/game/damage.js";
function setup() {
  const w = new DestructionWorld();
  const c = new Characters(w);
  w.characters = c;
  w.beforeStep = () => c.beforeStep(FIXED_DT, {});
  return { w, c };
}
test("direct hit is exactly 50, deduplicated; death determines winner", () => {
  const d = new DamageSystem();
  d.direct(1, 1);
  d.direct(1, 1);
  assert.equal(d.players[1].hp, 50);
  d.explode(
    1,
    { x: 0, y: 0, z: 0 },
    [
      { x: 20, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ],
    1,
  );
  assert.equal(d.players[1].hp, 50);
  d.direct(2, 1);
  d.finishBatch();
  assert.equal(d.winner, 0);
  assert.ok(d.ended);
  assert.equal(d.apply(0, 50, "late"), 0);
});
test("continuous explosion function, cover and stationary stones", () => {
  for (const [r, hp] of [
    [0, 35],
    [2, 35],
    [5, 15],
    [10, 0],
    [15, 0],
  ])
    assert.equal(blastDamage(r), hp);
  for (const d of [2, 5, 10])
    assert.ok(
      Math.abs(blastDamage(d - 0.0001) - blastDamage(d + 0.0001)) < 0.01,
    );
  const protectedPlayer = new DamageSystem({ cover: () => 0 });
  protectedPlayer.explode(1, { x: 0, y: 0, z: 0 }, [
    { x: 1, y: 0, z: 0 },
    { x: 3, y: 0, z: 0 },
  ]);
  assert.equal(protectedPlayer.players[0].hp, 100);
  let time = 0;
  const d = new DamageSystem({ clock: () => time });
  assert.equal(d.stone(0, 9, 1000, 0.2), 0);
  d.stone(0, 9, 1000, 3);
  const hp = d.players[0].hp;
  d.stone(0, 9, 1000, 3);
  assert.equal(d.players[0].hp, hp);
  time = 1;
  d.stone(0, 9, 1000, 3);
  assert.ok(d.players[0].hp < hp);
});
test("swept capsule handles cylinder, head, misses and first impact exactly once", () => {
  assert.ok(
    sweepCapsule(
      { x: -10, y: 1, z: 0 },
      { x: 10, y: 1, z: 0 },
      { x: 0, y: 0.85, z: 0 },
      0.3,
      0.55,
      0.1,
    ) !== null,
  );
  assert.equal(
    sweepCapsule(
      { x: -10, y: 4, z: 0 },
      { x: 10, y: 4, z: 0 },
      { x: 0, y: 0.85, z: 0 },
      0.3,
      0.55,
      0.1,
    ),
    null,
  );
  const { w, c } = setup();
  const target = c.players[1];
  w.shoot({
    position: { x: 12, y: 0.85, z: 1.8 },
    direction: { x: 1, y: 0, z: 0 },
    speed: 600,
  });
  w.step();
  assert.equal(c.damage.players[1].hp, 50);
  for (let i = 0; i < 10; i++) w.step();
  assert.equal(c.damage.players[1].hp, 50);
  w.dispose();
});
test("characters move with gravity, collide with walls, remain in court and mount/unmount", () => {
  const { w, c } = setup();
  const p = c.players[1];
  p.yaw = Math.PI / 2;
  c.motion(1, 0, 1);
  w.addBlock({ x: 20, y: 1, z: 3, sx: 8, sy: 2, sz: 0.5, owner: 99 });
  w.connect();
  for (let i = 0; i < 180; i++) {
    c.motion(1, 0, 1);
    w.step();
  }
  assert.ok(p.body.position.z < 2.5);
  assert.ok(p.body.position.y > 0.8 && p.body.position.y < 1);
  assert.ok(p.grounded);
  p.body.position.set(20.2, 0.86, 1.8);
  assert.equal(c.interact(1, { yaw: 0.1, up: 0.24 }), true);
  assert.ok(p.mounted);
  assert.equal(c.interact(1, { yaw: 0.1, up: 0.24 }), true);
  assert.equal(p.mounted, false);
  p.body.position.set(23, 0.85, 0);
  assert.equal(c.interact(1, { yaw: 0, up: 0 }), false);
  p.body.position.set(100, 0.86, 100);
  c.afterStep();
  assert.ok(p.body.position.x < 24 && p.body.position.z < 6);
  w.dispose();
});
test("falling real masonry damages a character, cosmetic effects have no path to damage", () => {
  const { w, c } = setup();
  const p = c.players[0];
  w.addBlock({ x: p.body.position.x, y: 5, z: p.body.position.z });
  w.connect();
  for (let i = 0; i < 100; i++) w.step();
  assert.ok(c.damage.players[0].hp < 100);
  w.dispose();
});
test("actual intact masonry blocks blast and projectile before a capsule; loose cover attenuates", () => {
  const { w, c } = setup();
  const wall = w.addBlock({
    x: 18,
    y: 1,
    z: 1.8,
    sx: 0.2,
    sy: 2,
    sz: 3,
    strength: 1e9,
  });
  w.connect();
  const from = { x: 16, y: 0.85, z: 1.8 },
    to = { x: 20.2, y: 0.85, z: 1.8 };
  assert.equal(c.cover(from, to), 0);
  w.shoot({
    position: from,
    direction: { x: 1, y: 0, z: 0 },
    speed: 600,
    owner: 0,
  });
  w.step();
  assert.equal(c.damage.players[1].hp, 100);
  w.detach(wall);
  assert.equal(c.cover(from, to), 0.35);
  wall.body.position.z = 5;
  assert.equal(c.cover(from, to), 1);
  w.dispose();
});
test("camera pitch clamps and movement input expires without freezing gravity", () => {
  const { w, c } = setup();
  c.look(1, 50, 50);
  assert.ok(c.players[1].pitch <= (75 * Math.PI) / 180);
  c.look(1, 0, -100);
  assert.ok(c.players[1].pitch >= (-75 * Math.PI) / 180);
  c.motion(1, 1, 0);
  for (let i = 0; i < 120; i++) w.step();
  assert.ok(
    Math.abs(c.players[1].body.velocity.x) < 0.02 &&
      Math.abs(c.players[1].body.velocity.z) < 0.02,
  );
  assert.ok(c.players[1].grounded);
  w.dispose();
});
