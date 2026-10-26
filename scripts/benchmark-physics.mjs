import { DestructionWorld } from "../public/game/physics.js";
import { Characters } from "../public/game/characters.js";
const w = new DestructionWorld();
const characters = process.argv.includes("--characters")
  ? new Characters(w)
  : null;
if (characters) {
  w.characters = characters;
  w.beforeStep = () => characters.beforeStep(1 / 60, {});
}
for (let p = 0; p < 2; p++) {
  const sign = p === 0 ? -1 : 1;
  for (let z = -6; z <= 6; z++)
    for (let row = 0; row < 8; row++) {
      if (Math.abs(z) <= 1 && row <= 5) continue;
      w.addBlock({
        x: sign * 11.9,
        y: 0.36 + row * 0.75,
        z: z * 0.98,
        owner: p,
      });
    }
  for (let j = 0; j < 7; j++)
    for (let row = 0; row < 6; row++)
      for (const z of [-6.8, 6.8])
        w.addBlock({
          x: sign * (13 + j * 1.06),
          y: 0.36 + row * 0.75,
          z,
          owner: p,
        });
  for (let z = -6; z <= 6; z += 2)
    w.addBlock({ x: sign * 11.9, y: 6.36, z: z * 0.98, owner: p });
}
w.connect();
const run = (n) => {
  const times = [];
  let peakActive = 0;
  for (let i = 0; i < n; i++) {
    w.step();
    times.push(w.lastStepMs);
    peakActive = Math.max(peakActive, w.stats().active);
  }
  times.sort((a, b) => a - b);
  return {
    medianMs: times[Math.floor(n * 0.5)],
    p95Ms: times[Math.floor(n * 0.95)],
    maxMs: times.at(-1),
    peakActive,
    end: w.stats(),
  };
};
const baseline = run(120);
w.shoot({
  position: { x: 0, y: 2.6, z: 2.9 },
  direction: { x: 1, y: 0, z: 0 },
  owner: 0,
});
const destruction = run(600);
console.log(
  JSON.stringify(
    {
      platform: process.arch,
      node: process.version,
      blocks: w.blocks.length,
      characters: characters?.snapshot(),
      baseline,
      destruction,
    },
    null,
    2,
  ),
);
w.dispose();
