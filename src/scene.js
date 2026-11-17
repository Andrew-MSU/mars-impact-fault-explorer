import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MARS_RADIUS_M, destinationPoint } from "./model/physics.js";

const STATUS = {
  stable: [0.184, 0.435, 0.624],
  near: [0.878, 0.631, 0.09],
  reactivated: [0.824, 0.231, 0.196],
  excavated: [0.478, 0.243, 0.525],
};

const STOPS = [
  [-8000, [12, 46, 110]],
  [-5500, [24, 92, 150]],
  [-3500, [36, 140, 150]],
  [-2000, [70, 158, 112]],
  [-500, [186, 176, 84]],
  [1500, [196, 140, 64]],
  [4000, [168, 92, 58]],
  [7000, [186, 150, 130]],
  [14000, [244, 236, 228]],
];

function hypsometric(elev) {
  if (elev <= STOPS[0][0]) return STOPS[0][1].map((channel) => channel / 255);
  for (let i = 1; i < STOPS.length; i += 1) {
    if (elev <= STOPS[i][0]) {
      const span = STOPS[i][0] - STOPS[i - 1][0];
      const t = span === 0 ? 0 : (elev - STOPS[i - 1][0]) / span;
      return STOPS[i - 1][1].map((channel, k) => (channel + (STOPS[i][1][k] - channel) * t) / 255);
    }
  }
  return STOPS[STOPS.length - 1][1].map((channel) => channel / 255);
}

function makeLabel(text, color = "#f4efe4") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = color;
  ctx.font = "600 36px Palatino, Georgia, serif";
  ctx.fillText(text, 4, 46);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  return sprite;
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (material.map) material.map.dispose();
        material.dispose();
      }
    }
  });
}

export function createView(canvas, { onPick }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x14110e, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 100, 2e7);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.98;

  scene.add(new THREE.AmbientLight(0xfff4e5, 0.72));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.15);
  sun.position.set(0.6, -0.35, 1);
  scene.add(sun);

  const terrain = new THREE.Group();
  const overlays = new THREE.Group();
  scene.add(terrain, overlays);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let frame = null;
  let terrainKey = "";
  let regionKey = "";
  let projector = null;
  let terrainMesh = null;
  let pointerDown = null;

  function resize() {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function resetCamera() {
    if (!frame) return;
    const span = Math.max(frame.widthM, frame.heightM);
    camera.position.set(-span * 0.05, -span * 0.78, span * 0.48);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function project(lon, lat) {
    return projector.project(lon, lat);
  }

  function buildTerrain(next) {
    disposeObject(terrain);
    terrain.clear();
    const { cols, rows, heights, ve, widthM, heightM } = next;
    const positions = new Float32Array(cols * rows * 3);
    const colors = new Float32Array(cols * rows * 3);
    const dx = widthM / (cols - 1);
    const dy = heightM / (rows - 1);
    for (let iy = 0; iy < rows; iy += 1) {
      for (let ix = 0; ix < cols; ix += 1) {
        const index = iy * cols + ix;
        const elev = heights[index];
        positions[index * 3] = -widthM / 2 + ix * dx;
        positions[index * 3 + 1] = heightM / 2 - iy * dy;
        positions[index * 3 + 2] = elev * ve;
        const color = hypsometric(elev);
        colors[index * 3] = color[0];
        colors[index * 3 + 1] = color[1];
        colors[index * 3 + 2] = color[2];
      }
    }
    const indices = [];
    for (let iy = 0; iy < rows - 1; iy += 1) {
      for (let ix = 0; ix < cols - 1; ix += 1) {
        const a = iy * cols + ix;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    terrainMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    );
    terrain.add(terrainMesh);

    const north = makeLabel("N");
    north.position.set(0, heightM / 2 + widthM * 0.03, (next.elevMax || 0) * ve);
    north.scale.set(widthM * 0.08, widthM * 0.02, 1);
    terrain.add(north);
  }

  function faultVertex(lon, lat, depthM, dipDeg, azimuth, ve) {
    const horiz = depthM / Math.tan((dipDeg * Math.PI) / 180);
    const moved = horiz > 1 ? destinationPoint(lon, lat, azimuth, horiz) : { lon, lat };
    const { x, y } = project(moved.lon, moved.lat);
    const elev = projector.sampleElev(lon, lat);
    return [x, y, (elev - depthM) * ve];
  }

  function buildOverlays(next) {
    disposeObject(overlays);
    overlays.clear();
    const ve = next.ve;
    const { widthM, heightM } = next;

    if (next.showSubsurface) {
      const cols = next.cols;
      const rows = next.rows;
      const positions = [];
      const colors = [];
      const indices = [];
      const moho = [];
      const bdt = [];
      const y = -heightM / 2 - Math.max(widthM, heightM) * 0.012;
      const ledge = heightM * 0.07;
      for (let ix = 0; ix < cols; ix += 1) {
        const elev = next.heights[(rows - 1) * cols + ix];
        const x = -widthM / 2 + (ix / (cols - 1)) * widthM;
        const top = elev * ve;
        const base = (elev - Math.max(next.bdtM, next.crustM) * 1.08) * ve;
        const mohoZ = (elev - next.crustM) * ve;
        const bdtZ = (elev - next.bdtM) * ve;
        const start = positions.length / 3;
        positions.push(x, y, top, x, y, mohoZ, x, y, base);
        const crust = [0.62, 0.4, 0.28];
        const mantle = [0.32, 0.14, 0.18];
        colors.push(...crust, ...crust, ...mantle);
        moho.push(x, y, mohoZ);
        bdt.push(x, y, bdtZ);
        if (ix > 0) {
          const prev = start - 3;
          indices.push(prev, prev + 1, start, start, prev + 1, start + 1);
          indices.push(prev + 1, prev + 2, start + 1, start + 1, prev + 2, start + 2);
        }
      }
      const wall = new THREE.BufferGeometry();
      wall.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      wall.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      wall.setIndex(indices);
      wall.computeVertexNormals();
      overlays.add(new THREE.Mesh(wall, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));

      const mohoLine = new THREE.BufferGeometry();
      mohoLine.setAttribute("position", new THREE.Float32BufferAttribute(moho, 3));
      overlays.add(new THREE.Line(mohoLine, new THREE.LineBasicMaterial({ color: 0xf0d7a4 })));
      const bdtLine = new THREE.BufferGeometry();
      bdtLine.setAttribute("position", new THREE.Float32BufferAttribute(bdt, 3));
      overlays.add(new THREE.Line(bdtLine, new THREE.LineBasicMaterial({ color: 0x7dcec4 })));

      const ledgeGeo = (source, yLift) => {
        const lifted = [];
        for (let i = 0; i < source.length; i += 3) {
          lifted.push(source[i], source[i + 1] + yLift, source[i + 2]);
        }
        const geo = new THREE.BufferGeometry();
        const count = source.length / 3;
        const pos = new Float32Array(count * 2 * 3);
        const idx = [];
        for (let i = 0; i < count; i += 1) {
          pos.set(source.slice(i * 3, i * 3 + 3), i * 3);
          pos.set(lifted.slice(i * 3, i * 3 + 3), (count + i) * 3);
          if (i > 0) {
            const a = i - 1;
            const b = i;
            idx.push(a, b, count + a, b, count + b, count + a);
          }
        }
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setIndex(idx);
        return geo;
      };
      overlays.add(
        new THREE.Mesh(
          ledgeGeo(moho, ledge),
          new THREE.MeshBasicMaterial({ color: 0xf0d7a4, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
        ),
      );
      overlays.add(
        new THREE.Mesh(
          ledgeGeo(bdt, ledge * 0.65),
          new THREE.MeshBasicMaterial({ color: 0x7dcec4, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
        ),
      );
      const southMid = next.heights[(rows - 1) * cols + Math.floor(cols / 2)];
      const mohoLabel = makeLabel("Moho", "#f0d7a4");
      mohoLabel.position.set(widthM * 0.42, y, (southMid - next.crustM) * ve);
      mohoLabel.scale.set(widthM * 0.09, widthM * 0.022, 1);
      const bdtLabel = makeLabel("BDT", "#9ee0d6");
      bdtLabel.position.set(widthM * 0.42, y, (southMid - next.bdtM) * ve);
      bdtLabel.scale.set(widthM * 0.07, widthM * 0.018, 1);
      overlays.add(mohoLabel, bdtLabel);
    }

    const positions = [];
    const colors = [];
    const indices = [];
    for (const segment of next.segments || []) {
      const profile = segment.display?.profile;
      if (!profile?.length) continue;
      const rowsZ = [{ z: 0, status: profile[0].status }, ...profile];
      const base = positions.length / 3;
      rowsZ.forEach((row, rowIndex) => {
        const color = STATUS[row.status] || STATUS.stable;
        for (const end of [
          [segment.lon0, segment.lat0],
          [segment.lon1, segment.lat1],
        ]) {
          positions.push(...faultVertex(end[0], end[1], row.z, segment.dipDeg, segment.dipAzimuthDeg, ve));
          colors.push(...color);
        }
        if (rowIndex > 0) {
          const a = base + (rowIndex - 1) * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          indices.push(a, c, b, b, c, d);
        }
      });
      const trace = [];
      for (const end of [
        [segment.lon0, segment.lat0],
        [segment.lon1, segment.lat1],
      ]) {
        const point = faultVertex(end[0], end[1], 0, segment.dipDeg, segment.dipAzimuthDeg, ve);
        point[2] += Math.max(80, 400 / ve) * ve * 0.15;
        trace.push(...point);
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(trace, 3));
      const worst = profile.some((row) => row.status === "excavated")
        ? "excavated"
        : profile.some((row) => row.status === "reactivated")
          ? "reactivated"
          : profile.some((row) => row.status === "near")
            ? "near"
            : "stable";
      const rgb = STATUS[worst];
      overlays.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]) })));
    }
    if (positions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      overlays.add(
        new THREE.Mesh(
          geometry,
          new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
        ),
      );
    }

    if (next.impact) {
      const { x, y } = project(next.impact.lon, next.impact.lat);
      const z = projector.sampleElev(next.impact.lon, next.impact.lat) * ve;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(next.widthM, next.heightM) * 0.008, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xf2d48a }),
      );
      marker.position.set(x, y, z + Math.max(next.widthM, next.heightM) * 0.01);
      overlays.add(marker);
      if (next.craterFinalM > 0) {
        const ring = [];
        for (let i = 0; i <= 72; i += 1) {
          const bearing = (i / 72) * 360;
          const point = destinationPoint(next.impact.lon, next.impact.lat, bearing, next.craterFinalM / 2);
          const projected = project(point.lon, point.lat);
          const elev = projector.sampleElev(point.lon, point.lat);
          ring.push(projected.x, projected.y, elev * ve + Math.max(widthM, heightM) * 0.004);
        }
        const ringGeo = new THREE.BufferGeometry();
        ringGeo.setAttribute("position", new THREE.Float32BufferAttribute(ring, 3));
        overlays.add(new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: 0xf2d48a })));
      }
    }
  }

  function show(next) {
    const regionChanged = next.regionId !== regionKey;
    frame = next;
    projector = next.projector;
    const key = `${next.regionId}:${next.ve}`;
    if (key !== terrainKey) {
      buildTerrain(next);
      terrainKey = key;
    }
    buildOverlays(next);
    if (regionChanged) {
      regionKey = next.regionId;
      resetCamera();
    }
  }

  canvas.addEventListener("pointerdown", (event) => {
    pointerDown = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!pointerDown || !terrainMesh || !projector) return;
    const dx = event.clientX - pointerDown.x;
    const dy = event.clientY - pointerDown.y;
    pointerDown = null;
    if (dx * dx + dy * dy > 16) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(terrainMesh, false);
    if (!hits.length) return;
    const { x, y } = hits[0].point;
    onPick(projector.unproject(x, y));
  });

  const observer = new ResizeObserver(() => resize());
  observer.observe(canvas.parentElement || canvas);
  resize();

  let running = true;
  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  return {
    show,
    resize,
    resetCamera,
    dispose() {
      running = false;
      observer.disconnect();
      disposeObject(terrain);
      disposeObject(overlays);
      renderer.dispose();
    },
  };
}

export function makeProjector(region, heights) {
  const lat0 = (((region.south + region.north) / 2) * Math.PI) / 180;
  const lon0 = (region.west + region.east) / 2;
  const latMid = (region.south + region.north) / 2;
  const widthM = ((region.east - region.west) * Math.PI) / 180 * MARS_RADIUS_M * Math.cos(lat0);
  const heightM = ((region.north - region.south) * Math.PI) / 180 * MARS_RADIUS_M;
  const cols = region.terrain.width;
  const rows = region.terrain.height;
  function sampleElev(lon, lat) {
    const fx = ((lon - region.west) / (region.east - region.west)) * (cols - 1);
    const fy = ((region.north - lat) / (region.north - region.south)) * (rows - 1);
    const x0 = Math.max(0, Math.min(cols - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(rows - 1, Math.floor(fy)));
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const a = heights[y0 * cols + x0];
    const b = heights[y0 * cols + x1];
    const c = heights[y1 * cols + x0];
    const d = heights[y1 * cols + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }
  return {
    widthM,
    heightM,
    project(lon, lat) {
      return {
        x: ((lon - lon0) * Math.PI) / 180 * MARS_RADIUS_M * Math.cos(lat0),
        y: ((lat - latMid) * Math.PI) / 180 * MARS_RADIUS_M,
      };
    },
    unproject(x, y) {
      return {
        lon: lon0 + (x / (MARS_RADIUS_M * Math.cos(lat0))) * (180 / Math.PI),
        lat: latMid + (y / MARS_RADIUS_M) * (180 / Math.PI),
      };
    },
    sampleElev,
  };
}
