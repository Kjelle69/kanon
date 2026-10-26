export const DAMAGE = Object.freeze({
  direct: 50,
  blastNear: 35,
  blastMiddle: 15,
  nearRadius: 2,
  middleRadius: 5,
  outerRadius: 10,
  stoneMinSpeed: 1.8,
  stoneEnergyPerHp: 35,
  stoneCooldown: 0.7,
});
export function blastDamage(distance, config = DAMAGE) {
  const d = Math.max(0, distance);
  if (d <= config.nearRadius) return config.blastNear;
  if (d <= config.middleRadius)
    return (
      config.blastNear +
      ((config.blastMiddle - config.blastNear) * (d - config.nearRadius)) /
        (config.middleRadius - config.nearRadius)
    );
  if (d < config.outerRadius)
    return (
      (config.blastMiddle * (config.outerRadius - d)) /
      (config.outerRadius - config.middleRadius)
    );
  return 0;
}
export class DamageSystem {
  constructor({
    clock = () => 0,
    cover = () => 1,
    onDamage = () => {},
    config = {},
  } = {}) {
    this.config = { ...DAMAGE, ...config };
    this.clock = clock;
    this.cover = cover;
    this.onDamage = onDamage;
    this.players = [0, 1].map((id) => ({
      id,
      hp: 100,
      alive: true,
      lastDamage: null,
    }));
    this.ended = false;
    this.winner = null;
    this.directHits = new Set();
    this.blasts = new Set();
    this.contacts = new Map();
  }
  once(set, id) {
    if (set.has(id)) return false;
    set.add(id);
    if (set.size > 4096) set.delete(set.values().next().value);
    return true;
  }
  apply(id, amount, cause) {
    if (
      this.ended ||
      !Number.isInteger(id) ||
      !this.players[id] ||
      !Number.isFinite(amount) ||
      amount <= 0
    )
      return 0;
    const p = this.players[id];
    if (!p.alive) return 0;
    const taken = Math.min(p.hp, amount);
    p.hp = Math.max(0, p.hp - taken);
    p.alive = p.hp > 0;
    p.lastDamage = { amount: taken, cause, time: this.clock() };
    this.onDamage(id, p.lastDamage);
    return taken;
  }
  finishBatch() {
    if (this.ended) return;
    if (this.players.some((p) => !p.alive)) {
      this.ended = true;
      const alive = this.players.filter((p) => p.alive);
      this.winner = alive.length === 1 ? alive[0].id : null;
    }
  }
  direct(id, player) {
    if (!this.once(this.directHits, id)) return 0;
    return this.apply(player, this.config.direct, "direct");
  }
  explode(id, point, positions, exclude = null) {
    if (!this.once(this.blasts, id) || this.ended) return;
    for (const [i, p] of positions.entries())
      if (i !== exclude) {
        const distance = Math.hypot(
          p.x - point.x,
          p.y - point.y,
          p.z - point.z,
        );
        this.apply(
          i,
          blastDamage(distance, this.config) *
            Math.max(0, Math.min(1, this.cover(point, p))),
          "blast",
        );
      }
    this.finishBatch();
  }
  stone(player, block, mass, speed) {
    if (speed < this.config.stoneMinSpeed || this.ended) return 0;
    const key = `${player}:${block}`,
      now = this.clock();
    if (now - (this.contacts.get(key) ?? -Infinity) < this.config.stoneCooldown)
      return 0;
    this.contacts.set(key, now);
    if (this.contacts.size > 2048)
      for (const [k, t] of this.contacts)
        if (t < now - 2) this.contacts.delete(k);
    const reducedMass = (mass * 80) / (mass + 80),
      energy = 0.5 * reducedMass * speed * speed;
    const taken = this.apply(
      player,
      Math.min(60, energy / this.config.stoneEnergyPerHp),
      "stone",
    );
    this.finishBatch();
    return taken;
  }
  snapshot() {
    return {
      players: this.players.map((p) => ({
        ...p,
        lastDamage: p.lastDamage ? { ...p.lastDamage } : null,
      })),
      ended: this.ended,
      winner: this.winner,
    };
  }
}

// Exact segment against an upright capsule: finite cylinder plus two end spheres.
export function sweepCapsule(
  from,
  to,
  center,
  radius,
  halfSegment,
  projectileRadius = 0,
) {
  const r = radius + projectileRadius,
    d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  let best = Infinity;
  const roots = (a, b, c) => {
    if (c <= 0) return [0];
    if (a < 1e-12) return [];
    const q = b * b - 4 * a * c;
    if (q < 0) return [];
    return [(-b - Math.sqrt(q)) / (2 * a), (-b + Math.sqrt(q)) / (2 * a)];
  };
  const x = from.x - center.x,
    z = from.z - center.z;
  for (const t of roots(
    d.x * d.x + d.z * d.z,
    2 * (x * d.x + z * d.z),
    x * x + z * z - r * r,
  ))
    if (
      t >= 0 &&
      t <= 1 &&
      Math.abs(from.y + d.y * t - center.y) <= halfSegment
    )
      best = Math.min(best, t);
  for (const y of [center.y - halfSegment, center.y + halfSegment]) {
    const fy = from.y - y;
    for (const t of roots(
      d.x * d.x + d.y * d.y + d.z * d.z,
      2 * (x * d.x + fy * d.y + z * d.z),
      x * x + fy * fy + z * z - r * r,
    ))
      if (t >= 0 && t <= 1) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : null;
}
