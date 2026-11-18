import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MARS_RADIUS_M } from "./model/physics.js";

const STATUS_COLOR = {
  stable: [0.45, 0.38, 0.32],
  near: [0.878, 0.631, 0.09],
  reactivated: [0.824, 0.231, 0.196],
  excavated: [0.478, 0.243, 0.525],
  weak: [0.95, 0.78, 0.25],
};

function lonLatToVector(lon, lat, radius) {
  const lonR = (lon * Math.PI) / 180;
  const latR = (lat * Math.PI) / 180;
  const cosLat = Math.cos(latR);
  return new THREE.Vector3(radius * cosLat * Math.sin(lonR), radius * cosLat * Math.cos(lonR), radius * Math.sin(latR));
}

function vectorToLonLat(vector) {
  const r = vector.length() || 1;
  return {
    lat: (Math.asin(Math.max(-1, Math.min(1, vector.z / r))) * 180) / Math.PI,
    lon: (Math.atan2(vector.x, vector.y) * 180) / Math.PI,
  };
}

export function createGlobe(canvas, { onPick }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x14110e, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1e4, 5e7);
  camera.up.set(0, 0, 1);
  camera.position.set(MARS_RADIUS_M * 1.6, -MARS_RADIUS_M * 2.4, MARS_RADIUS_M * 1.2);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);
  controls.minDistance = MARS_RADIUS_M * 1.05;
  controls.maxDistance = MARS_RADIUS_M * 8;

  scene.add(new THREE.AmbientLight(0xfff4e5, 0.55));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.2);
  sun.position.set(MARS_RADIUS_M, -MARS_RADIUS_M * 0.4, MARS_RADIUS_M * 0.8);
  scene.add(sun);

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(MARS_RADIUS_M, 72, 48),
    new THREE.MeshPhongMaterial({ color: 0xb85a38, emissive: 0x2a120c, shininess: 6 }),
  );
  scene.add(globe);

  const graticule = new THREE.LineSegments(
    graticuleGeometry(MARS_RADIUS_M * 1.002),
    new THREE.LineBasicMaterial({ color: 0xf4efe4, transparent: true, opacity: 0.18 }),
  );
  scene.add(graticule);

  const faultMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
  let faultObject = null;
  let faultIndex = [];

  const impact = marker(0xf2d36b);
  const antipodeMark = marker(0x7eb6ff);
  scene.add(impact);
  scene.add(antipodeMark);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDown = null;
  canvas.addEventListener("pointerdown", (event) => {
    pointerDown = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!pointerDown) return;
    const dx = event.clientX - pointerDown.x;
    const dy = event.clientY - pointerDown.y;
    pointerDown = null;
    if (dx * dx + dy * dy > 16) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(globe)[0];
    if (!hit || !onPick) return;
    onPick(vectorToLonLat(hit.point));
  });

  function resize() {
    const width = canvas.clientWidth || 0;
    const height = canvas.clientHeight || 0;
    if (width < 2 || height < 2) return;
    if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false);
    }
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }

  function frame() {
    resize();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    resize,
    resetCamera() {
      camera.position.set(MARS_RADIUS_M * 1.6, -MARS_RADIUS_M * 2.4, MARS_RADIUS_M * 1.2);
      controls.target.set(0, 0, 0);
    },
    setFaults(features) {
      if (faultObject) {
        scene.remove(faultObject);
        faultObject.geometry.dispose();
      }
      const positions = [];
      const colors = [];
      faultIndex = [];
      const radius = MARS_RADIUS_M * 1.004;
      for (const feature of features || []) {
        const coords = feature?.geometry?.coordinates;
        if (!coords || coords.length < 2) continue;
        const start = positions.length / 3;
        for (let i = 1; i < coords.length; i += 1) {
          const a = lonLatToVector(coords[i - 1][0], coords[i - 1][1], radius);
          const b = lonLatToVector(coords[i][0], coords[i][1], radius);
          positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
          colors.push(0.45, 0.38, 0.32, 0.45, 0.38, 0.32);
        }
        faultIndex.push({
          id: feature.properties?.id,
          start,
          count: (positions.length / 3) - start,
        });
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      faultObject = new THREE.LineSegments(geometry, faultMaterial);
      scene.add(faultObject);
    },
    show({ statuses, impactLon, impactLat, antipodeLon, antipodeLat }) {
      place(impact, impactLon, impactLat);
      place(antipodeMark, antipodeLon, antipodeLat);
      if (!faultObject) return;
      const byId = new Map((statuses || []).map((row) => [row.id, row]));
      const color = faultObject.geometry.getAttribute("color");
      for (const entry of faultIndex) {
        const row = byId.get(entry.id);
        const rgb = row?.inWeakZone ? STATUS_COLOR.weak : STATUS_COLOR[row?.status] || STATUS_COLOR.stable;
        for (let i = 0; i < entry.count; i += 1) {
          const vertex = entry.start + i;
          color.setXYZ(vertex, rgb[0], rgb[1], rgb[2]);
        }
      }
      color.needsUpdate = true;
    },
  };
}

function place(object, lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    object.visible = false;
    return;
  }
  object.visible = true;
  object.position.copy(lonLatToVector(lon, lat, MARS_RADIUS_M * 1.02));
}

function marker(color) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(MARS_RADIUS_M * 0.025, 16, 12),
    new THREE.MeshBasicMaterial({ color }),
  );
  return mesh;
}

function graticuleGeometry(radius) {
  const positions = [];
  const push = (lon, lat, lon2, lat2) => {
    const a = lonLatToVector(lon, lat, radius);
    const b = lonLatToVector(lon2, lat2, radius);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -80; lat < 80; lat += 10) push(lon, lat, lon, lat + 10);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += 10) push(lon, lat, lon + 10, lat);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}
