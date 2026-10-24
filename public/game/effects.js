import * as THREE from "/vendor/three.module.js";
const CAPACITY = 2400,
  FRAGMENTS = 20000;
const palette = {
  smoke: [0.29, 0.3, 0.31],
  dust: [0.64, 0.56, 0.43],
  flame: [1, 0.48, 0.06],
  spark: [1, 0.85, 0.31],
};
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.cursor = 0;
    this.fragmentCursor = 0;
    this.fires = new Map();
    this.shots = 0;
    this.hits = 0;
    this.pool = Array.from({ length: CAPACITY }, () => ({
      life: 0,
      total: 1,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 0,
      kind: "smoke",
    }));
    this.fragments = Array.from({ length: FRAGMENTS }, () => ({
      life: 0,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 0,
      angle: 0,
    }));
    const geo = new THREE.BufferGeometry();
    for (const [name, n] of [
      ["position", 3],
      ["color", 3],
      ["size", 1],
      ["opacity", 1],
    ])
      geo.setAttribute(
        name,
        new THREE.BufferAttribute(new Float32Array(CAPACITY * n), n).setUsage(
          THREE.DynamicDrawUsage,
        ),
      );
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      uniforms: {},
      vertexShader: `attribute float size;attribute float opacity;varying vec3 tint;varying float alpha;void main(){tint=color;alpha=opacity;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(size*360./max(1.,-p.z),1.,120.);}`,
      fragmentShader: `varying vec3 tint;varying float alpha;void main(){vec2 p=abs(gl_PointCoord*2.-1.);float edge=max(max(p.x,p.y),(p.x+p.y)*.72);if(edge>1.)discard;float fade=1.-smoothstep(.35,1.,edge);gl_FragColor=vec4(tint,alpha*fade);}`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.mesh = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ color: 0xb3a28a, flatShading: true }),
      FRAGMENTS,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.highWater = 0;
    this.temp = new THREE.Object3D();
    this.light = new THREE.PointLight(0xffb04b, 0, 10, 2);
    scene.add(this.light);
    this.flash = 0;
    this.update(0);
  }
  emit(kind, point, count, energy = 1) {
    const color = palette[kind];
    for (let n = 0; n < count; n++) {
      const p = this.pool[this.cursor++ % CAPACITY],
        speed = kind === "spark" ? 5 : kind === "dust" ? 2 : 1;
      p.kind = kind;
      p.x = point.x;
      p.y = point.y;
      p.z = point.z;
      p.vx = (Math.random() - 0.5) * speed * energy;
      p.vy = (kind === "smoke" ? 1.2 : Math.random() * speed) * energy;
      p.vz = (Math.random() - 0.5) * speed * energy;
      p.total = p.life =
        kind === "flame"
          ? 0.1 + Math.random() * 0.12
          : kind === "spark"
            ? 0.2 + Math.random() * 0.4
            : 1 + Math.random() * 2;
      p.size =
        kind === "flame"
          ? 0.8
          : kind === "spark"
            ? 0.07
            : 0.25 + Math.random() * 0.35;
      p.color = color;
    }
  }
  chips(point, count = 24, force = 1) {
    for (let n = 0; n < count; n++) {
      const i = this.fragmentCursor++ % FRAGMENTS,
        p = this.fragments[i];
      Object.assign(p, {
        life: 3 + Math.random() * 4,
        x: point.x,
        y: point.y,
        z: point.z,
        vx: (Math.random() - 0.5) * 5 * force,
        vy: (1 + Math.random() * 4) * force,
        vz: (Math.random() - 0.5) * 5 * force,
        size: 0.035 + Math.random() * 0.1,
        angle: Math.random() * 6,
      });
      this.highWater = Math.max(this.highWater, i + 1);
    }
  }
  muzzle(point, direction) {
    this.shots++;
    this.flash = 0.08;
    this.light.position.copy(point);
    this.light.intensity = 18;
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Vector3()
        .copy(point)
        .addScaledVector(direction, i * 0.22);
      this.emit("flame", p, 3);
    }
    this.emit("smoke", point, 26);
    this.emit("spark", point, 12);
  }
  impact(point, energy) {
    this.hits++;
    const scale = Math.min(3, Math.sqrt(energy / 15000));
    this.emit("dust", point, Math.round(22 * scale), scale);
    this.chips(point, Math.round(24 * scale), scale);
  }
  collapse(point, count) {
    this.emit(
      "dust",
      point,
      Math.min(140, count * 12),
      Math.min(3, 1 + count / 10),
    );
  }
  ignite(object, seconds = 15) {
    if (object.userData.flammable)
      this.fires.set(object, { remaining: seconds, credit: 0 });
  }
  stress() {
    this.chips({ x: 0, y: 12, z: 0 }, FRAGMENTS, 3);
    // Spread the load across the arena; stacking 20k triangles at one point
    // measures pathological overdraw rather than a cloud of loose debris.
    for (const p of this.fragments) {
      p.x = (Math.random() - .5) * 35;
      p.y = 3 + Math.random() * 19;
      p.z = (Math.random() - .5) * 18;
    }
  }

  update(dt) {
    this.flash = Math.max(0, this.flash - dt);
    this.light.intensity = this.flash > 0 ? (18 * this.flash) / 0.08 : 0;
    for (const [object, fire] of this.fires) {
      fire.remaining -= dt;
      fire.credit += dt;
      if (fire.remaining <= 0) {
        this.fires.delete(object);
        continue;
      }
      if (fire.credit > 0.065) {
        fire.credit = 0;
        const p = object.getWorldPosition(new THREE.Vector3());
        p.y += 0.5;
        this.emit("flame", p, 4);
        this.emit("smoke", p, 2);
      }
    }
    let active = 0;
    const attrs = this.points.geometry.attributes;
    for (let i = 0; i < CAPACITY; i++) {
      const p = this.pool[i];
      p.life = Math.max(0, p.life - dt);
      if (p.life > 0) {
        active++;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.kind === "spark") p.vy -= 9.81 * dt;
        else {
          p.vy += dt * 0.25;
          p.size += dt * (p.kind === "flame" ? 0.1 : 0.45);
        }
        attrs.position.setXYZ(i, p.x, p.y, p.z);
        attrs.color.setXYZ(i, ...p.color);
        attrs.size.setX(i, p.size);
        attrs.opacity.setX(
          i,
          ((p.kind === "flame" ? 1 : 0.6) * p.life) / p.total,
        );
      } else {
        attrs.size.setX(i, 0);
        attrs.opacity.setX(i, 0);
      }
    }
    for (const a of Object.values(attrs)) a.needsUpdate = true;
    let fragments = 0;
    for (let i = 0; i < this.highWater; i++) {
      const p = this.fragments[i];
      p.life = Math.max(0, p.life - dt);
      if (p.life > 0) {
        fragments++;
        p.vy -= 9.81 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < p.size) {
          p.y = p.size;
          p.vy *= -0.2;
          p.vx *= 0.85;
          p.vz *= 0.85;
        }
        p.angle += dt;
        this.temp.position.set(p.x, p.y, p.z);
        this.temp.rotation.set(p.angle, p.angle * 0.7, 0);
        this.temp.scale.setScalar(p.size * Math.min(1, p.life));
      } else this.temp.scale.setScalar(0);
      this.temp.updateMatrix();
      this.mesh.setMatrixAt(i, this.temp.matrix);
    }
    if (fragments === 0) {
      this.highWater = 0;
      this.fragmentCursor = 0;
    }
    this.mesh.count = this.highWater;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.active = active;
    this.activeFragments = fragments;
  }
  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.scene.remove(this.points, this.mesh, this.light);
    this.fires.clear();
  }
}
