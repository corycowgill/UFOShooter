// levels.js - Three Chicago levels with procedural landmarks
export const LEVELS = [
  { name: 'DOWNTOWN CHICAGO', builder: buildDowntownChicago },
  { name: 'LINCOLN PARK ZOO', builder: buildLincolnParkZoo },
  { name: 'RAVENSWOOD', builder: buildRavenswood },
];

function makeMaterial(color, emissive = 0x000000) {
  return new THREE.MeshPhongMaterial({ color, emissive });
}

function makeBox(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeMaterial(color));
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeTree(x, z, scale = 1) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15 * scale, 0.2 * scale, 2 * scale, 6),
    makeMaterial(0x553311)
  );
  trunk.position.y = scale;
  group.add(trunk);
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(1.2 * scale, 8, 8),
    makeMaterial(0x116622)
  );
  canopy.position.y = 2.5 * scale;
  group.add(canopy);
  group.position.set(x, 0, z);
  return group;
}

function makeStreetLight(x, z) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 5, 6),
    makeMaterial(0x555555)
  );
  pole.position.y = 2.5;
  group.add(pole);
  const fixture = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.1, 0.15),
    makeMaterial(0x666666)
  );
  fixture.position.set(0, 5, 0);
  group.add(fixture);
  const light = new THREE.PointLight(0xffdd88, 0.8, 15);
  light.position.set(0, 4.9, 0);
  group.add(light);
  group.position.set(x, 0, z);
  return group;
}

function addGround(group, size, color = 0x333333) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 2, size * 2),
    makeMaterial(color, 0x111111)
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
}

function addSky(scene) {
  // Dark invasion sky
  const skyGeo = new THREE.SphereGeometry(500, 32, 32);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0x0a0a1a,
    side: THREE.BackSide
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // UFO mothership
  const ufoGroup = new THREE.Group();
  const ufoBody = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 12, 2, 16),
    new THREE.MeshPhongMaterial({ color: 0x334455, emissive: 0x112233 })
  );
  ufoGroup.add(ufoBody);
  const ufoTop = new THREE.Mesh(
    new THREE.SphereGeometry(5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x445566, emissive: 0x112233 })
  );
  ufoTop.position.y = 1;
  ufoGroup.add(ufoTop);
  // Lights under UFO
  const ufoLight = new THREE.PointLight(0x00ff88, 2, 100);
  ufoLight.position.y = -2;
  ufoGroup.add(ufoLight);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0x00ff88 })
    );
    light.position.set(Math.cos(angle) * 10, -1, Math.sin(angle) * 10);
    ufoGroup.add(light);
  }
  ufoGroup.position.set(0, 80, -30);
  scene.add(ufoGroup);

  // Eerie fog
  scene.fog = new THREE.FogExp2(0x0a0a1a, 0.008);

  return ufoGroup;
}

function addCollider(colliders, mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  colliders.push({ box, mesh });
}

// ========== LEVEL 1: DOWNTOWN CHICAGO ==========
function buildDowntownChicago(scene) {
  const group = new THREE.Group();
  const colliders = [];

  addGround(group, 100, 0x2a2a2a);
  const ufo = addSky(scene);

  // Ambient
  scene.add(new THREE.AmbientLight(0x223344, 0.4));
  const dirLight = new THREE.DirectionalLight(0x8888ff, 0.3);
  dirLight.position.set(10, 30, 10);
  scene.add(dirLight);

  // === Willis Tower (Sears Tower) - tall dark building ===
  const willis = makeBox(8, 45, 8, 0x222222, -30, 0, -40);
  group.add(willis);
  addCollider(colliders, willis);
  // Antenna
  const antenna = makeBox(0.3, 10, 0.3, 0x444444, -30, 45, -40);
  group.add(antenna);
  // Window lights
  for (let y = 2; y < 44; y += 3) {
    for (let side = 0; side < 4; side++) {
      if (Math.random() > 0.4) {
        const win = new THREE.Mesh(
          new THREE.PlaneGeometry(0.8, 1.2),
          new THREE.MeshBasicMaterial({ color: 0xffdd66, transparent: true, opacity: 0.5 + Math.random() * 0.5 })
        );
        const angle = side * Math.PI / 2;
        const offset = 4.01;
        win.position.set(
          -30 + Math.sin(angle) * offset + (Math.random() - 0.5) * 3,
          y,
          -40 + Math.cos(angle) * offset + (Math.random() - 0.5) * 3
        );
        win.rotation.y = angle;
        group.add(win);
      }
    }
  }

  // === Trump Tower ===
  const trump = makeBox(6, 38, 6, 0x888899, 25, 0, -35);
  group.add(trump);
  addCollider(colliders, trump);
  // Glass facade hint
  const trumpGlass = makeBox(6.1, 38, 6.1, 0x4466aa, 25, 0, -35);
  trumpGlass.material.transparent = true;
  trumpGlass.material.opacity = 0.15;
  group.add(trumpGlass);

  // === The Bean (Cloud Gate) ===
  const bean = new THREE.Mesh(
    new THREE.SphereGeometry(3, 16, 16),
    new THREE.MeshPhongMaterial({
      color: 0xaaaacc,
      emissive: 0x222233,
      shininess: 100,
      envMap: null,
    })
  );
  bean.scale.set(1.5, 0.8, 1);
  bean.position.set(0, 2.4, 15);
  group.add(bean);
  addCollider(colliders, bean);

  // Bean plaza
  const plaza = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    makeMaterial(0x999999)
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0.01, 15);
  group.add(plaza);

  // === Chicago River ===
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 200),
    new THREE.MeshPhongMaterial({ color: 0x114477, transparent: true, opacity: 0.7, emissive: 0x001122 })
  );
  river.rotation.x = -Math.PI / 2;
  river.position.set(0, 0.05, 0);
  group.add(river);

  // === Michigan Avenue buildings ===
  for (let i = 0; i < 12; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const h = 10 + Math.random() * 25;
    const w = 4 + Math.random() * 4;
    const d = 4 + Math.random() * 4;
    const z = -80 + i * 14;
    const bldg = makeBox(w, h, d, 0x333344 + Math.floor(Math.random() * 0x111111), side * (15 + w/2 + 5), 0, z);
    group.add(bldg);
    addCollider(colliders, bldg);
    // Some window lights
    for (let y = 2; y < h; y += 4) {
      const win = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1.5),
        new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: Math.random() * 0.8 })
      );
      win.position.set(side * (15 + 5), y, z);
      win.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(win);
    }
  }

  // === Street / Roads ===
  // Michigan Ave road
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 200),
    makeMaterial(0x222222)
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, -10);
  group.add(road);
  // Road lines
  for (let z = -90; z < 90; z += 6) {
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 3),
      new THREE.MeshBasicMaterial({ color: 0xffff00 })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.03, z);
    group.add(line);
  }

  // Street lights
  for (let z = -80; z < 80; z += 20) {
    group.add(makeStreetLight(8, z));
    group.add(makeStreetLight(-8, z));
  }

  // Some scattered cars (simple boxes)
  for (let i = 0; i < 8; i++) {
    const carColors = [0xcc0000, 0x0044cc, 0x333333, 0xffffff, 0xcccc00];
    const car = makeBox(1.8, 1.2, 4, carColors[Math.floor(Math.random() * carColors.length)],
      (Math.random() - 0.5) * 8, 0, -70 + i * 20);
    car.rotation.y = Math.random() * 0.3;
    group.add(car);
    addCollider(colliders, car);
  }

  scene.add(group);
  return { group, colliders, ufo, spawnPoints: generateSpawnPoints(80) };
}

// ========== LEVEL 2: LINCOLN PARK ZOO ==========
function buildLincolnParkZoo(scene) {
  const group = new THREE.Group();
  const colliders = [];

  addGround(group, 100, 0x1a3311);
  const ufo = addSky(scene);

  scene.add(new THREE.AmbientLight(0x223322, 0.5));
  const dirLight = new THREE.DirectionalLight(0x88ff88, 0.2);
  dirLight.position.set(-10, 20, 10);
  scene.add(dirLight);

  // === Zoo Entrance Gate ===
  const gateLeft = makeBox(1, 6, 1, 0x885533, -5, 0, 50);
  const gateRight = makeBox(1, 6, 1, 0x885533, 5, 0, 50);
  const gateTop = makeBox(12, 1.5, 1.5, 0x885533, 0, 6, 50);
  group.add(gateLeft, gateRight, gateTop);
  addCollider(colliders, gateLeft);
  addCollider(colliders, gateRight);
  // Gate sign
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 1.2),
    new THREE.MeshBasicMaterial({ color: 0x228833 })
  );
  sign.position.set(0, 7.5, 50);
  group.add(sign);

  // === Paths (lighter ground strips) ===
  const pathMat = makeMaterial(0x998866);
  const mainPath = new THREE.Mesh(new THREE.PlaneGeometry(4, 100), pathMat);
  mainPath.rotation.x = -Math.PI / 2;
  mainPath.position.set(0, 0.02, 0);
  group.add(mainPath);
  const crossPath = new THREE.Mesh(new THREE.PlaneGeometry(80, 4), pathMat);
  crossPath.rotation.x = -Math.PI / 2;
  crossPath.position.set(0, 0.02, 0);
  group.add(crossPath);

  // === Animal Enclosures ===
  function makeEnclosure(x, z, w, d, label) {
    const fenceH = 1.5;
    const fenceMat = makeMaterial(0x886644);
    // Four fence sides
    const sides = [
      makeBox(w, fenceH, 0.1, 0x886644, x, 0, z - d/2),
      makeBox(w, fenceH, 0.1, 0x886644, x, 0, z + d/2),
      makeBox(0.1, fenceH, d, 0x886644, x - w/2, 0, z),
      makeBox(0.1, fenceH, d, 0x886644, x + w/2, 0, z),
    ];
    sides.forEach(s => { group.add(s); addCollider(colliders, s); });
    // Ground inside
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 0.2, d - 0.2),
      makeMaterial(0x2a4422)
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(x, 0.01, z);
    group.add(floor);
    // Sign post
    const post = makeBox(0.8, 1.2, 0.1, 0x445522, x - w/2 + 0.5, 0, z - d/2 - 0.3);
    group.add(post);
  }

  makeEnclosure(-20, 15, 14, 12, 'Lions');
  makeEnclosure(20, 15, 14, 12, 'Primates');
  makeEnclosure(-20, -20, 14, 12, 'Reptiles');
  makeEnclosure(20, -20, 14, 12, 'Birds');
  makeEnclosure(-20, -50, 14, 12, 'Elephants');
  makeEnclosure(20, -50, 14, 12, 'Penguins');

  // === Pond ===
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(8, 24),
    new THREE.MeshPhongMaterial({ color: 0x114466, transparent: true, opacity: 0.7 })
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(40, 0.03, 30);
  group.add(pond);

  // === Nature Museum Building ===
  const museum = makeBox(20, 8, 12, 0x887766, -40, 0, -40);
  group.add(museum);
  addCollider(colliders, museum);
  // Museum entrance
  const museumDoor = makeBox(3, 5, 0.5, 0x443322, -40, 0, -33.5);
  group.add(museumDoor);
  // Museum roof
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(14, 4, 4),
    makeMaterial(0x554433)
  );
  roof.position.set(-40, 10, -40);
  roof.rotation.y = Math.PI / 4;
  group.add(roof);

  // === Trees everywhere ===
  for (let i = 0; i < 40; i++) {
    const x = (Math.random() - 0.5) * 160;
    const z = (Math.random() - 0.5) * 160;
    // Don't place on paths or enclosures
    if (Math.abs(x) < 3 || (Math.abs(z) < 3 && Math.abs(x) < 40)) continue;
    const tree = makeTree(x, z, 0.8 + Math.random() * 0.6);
    group.add(tree);
  }

  // Benches along paths
  for (let z = -40; z < 40; z += 15) {
    const bench = makeBox(1.5, 0.5, 0.5, 0x664422, 3, 0, z);
    group.add(bench);
    addCollider(colliders, bench);
  }

  // Lamp posts
  for (let z = -40; z < 50; z += 15) {
    group.add(makeStreetLight(2, z));
    group.add(makeStreetLight(-2, z));
  }

  scene.add(group);
  return { group, colliders, ufo, spawnPoints: generateSpawnPoints(70) };
}

// ========== LEVEL 3: RAVENSWOOD ==========
function buildRavenswood(scene) {
  const group = new THREE.Group();
  const colliders = [];

  addGround(group, 100, 0x2a2a2a);
  const ufo = addSky(scene);

  scene.add(new THREE.AmbientLight(0x222233, 0.4));
  const dirLight = new THREE.DirectionalLight(0x9999ff, 0.3);
  dirLight.position.set(5, 25, -10);
  scene.add(dirLight);

  // === CTA Brown Line Elevated Tracks ===
  // Support pillars
  for (let z = -80; z < 80; z += 8) {
    const pillar = makeBox(0.6, 6, 0.6, 0x555555, 0, 0, z);
    group.add(pillar);
    addCollider(colliders, pillar);
  }
  // Track bed
  const trackBed = makeBox(5, 0.5, 170, 0x444444, 0, 6, 0);
  group.add(trackBed);
  // Rails
  const rail1 = makeBox(0.1, 0.15, 170, 0x888888, -1.2, 6.3, 0);
  const rail2 = makeBox(0.1, 0.15, 170, 0x888888, 1.2, 6.3, 0);
  group.add(rail1, rail2);

  // === Ravenswood Station ===
  const stationPlatform = makeBox(8, 0.3, 15, 0x666666, 0, 6.2, 0);
  group.add(stationPlatform);
  // Station shelter
  const shelter = makeBox(7, 3, 12, 0x446666, 0, 6.5, 0);
  shelter.material.transparent = true;
  shelter.material.opacity = 0.4;
  group.add(shelter);
  // Station stairs
  const stairs = makeBox(2, 6, 3, 0x555555, 5, 0, 0);
  group.add(stairs);
  addCollider(colliders, stairs);

  // === Residential Buildings (both sides of tracks) ===
  function makeResidential(x, z, stories) {
    const h = stories * 3.5;
    const w = 6 + Math.random() * 4;
    const d = 8 + Math.random() * 4;
    const colors = [0x884433, 0x774422, 0x665544, 0x776655, 0x885544];
    const bldg = makeBox(w, h, d, colors[Math.floor(Math.random() * colors.length)], x, 0, z);
    group.add(bldg);
    addCollider(colliders, bldg);
    // Windows
    for (let y = 2; y < h; y += 3.5) {
      for (let wx = -w/3; wx <= w/3; wx += w/3) {
        const win = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1.5),
          new THREE.MeshBasicMaterial({
            color: Math.random() > 0.5 ? 0xffdd44 : 0x222244,
            transparent: true,
            opacity: 0.7
          })
        );
        const facing = x > 0 ? -1 : 1;
        win.position.set(x + facing * (w/2 + 0.01), y, z + wx);
        win.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2;
        group.add(win);
      }
    }
    // Stoop/stairs
    const stoop = makeBox(2, 0.8, 1.5, 0x777777, x + (x > 0 ? -w/2 - 0.5 : w/2 + 0.5), 0, z);
    group.add(stoop);
  }

  // Houses along both sides
  for (let z = -70; z < 70; z += 14) {
    makeResidential(-18 - Math.random() * 5, z + Math.random() * 4, 2 + Math.floor(Math.random() * 2));
    makeResidential(18 + Math.random() * 5, z + Math.random() * 4, 2 + Math.floor(Math.random() * 2));
  }

  // === Storefronts along one side ===
  for (let z = -30; z < 30; z += 10) {
    const store = makeBox(5, 4, 6, 0x776655, -12, 0, z);
    group.add(store);
    addCollider(colliders, store);
    // Awning
    const awning = makeBox(5.5, 0.1, 2, 0xcc3333 + Math.floor(Math.random() * 0x00cc00), -12, 3.5, z - 3.5);
    group.add(awning);
    // Store light
    const storeLight = new THREE.PointLight(0xffaa44, 0.5, 8);
    storeLight.position.set(-12, 3, z - 4);
    group.add(storeLight);
  }

  // === Water Tower ===
  const towerBase = makeBox(2, 12, 2, 0x777777, 35, 0, -20);
  group.add(towerBase);
  addCollider(colliders, towerBase);
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 4, 8),
    makeMaterial(0x666666)
  );
  tank.position.set(35, 14, -20);
  group.add(tank);
  const tankRoof = new THREE.Mesh(
    new THREE.ConeGeometry(3, 2, 8),
    makeMaterial(0x555555)
  );
  tankRoof.position.set(35, 17, -20);
  group.add(tankRoof);

  // === Tree-lined streets ===
  for (let z = -70; z < 70; z += 10) {
    group.add(makeTree(-10, z, 0.7 + Math.random() * 0.4));
    group.add(makeTree(10, z, 0.7 + Math.random() * 0.4));
  }

  // === Sidewalks ===
  const sidewalkMat = makeMaterial(0x888888);
  const swL = new THREE.Mesh(new THREE.PlaneGeometry(3, 170), sidewalkMat);
  swL.rotation.x = -Math.PI / 2;
  swL.position.set(-8, 0.015, 0);
  group.add(swL);
  const swR = new THREE.Mesh(new THREE.PlaneGeometry(3, 170), sidewalkMat);
  swR.rotation.x = -Math.PI / 2;
  swR.position.set(8, 0.015, 0);
  group.add(swR);

  // === Road ===
  const road = new THREE.Mesh(new THREE.PlaneGeometry(6, 170), makeMaterial(0x1a1a1a));
  road.rotation.x = -Math.PI / 2;
  road.position.set(-5, 0.01, 0);
  group.add(road);
  const road2 = new THREE.Mesh(new THREE.PlaneGeometry(6, 170), makeMaterial(0x1a1a1a));
  road2.rotation.x = -Math.PI / 2;
  road2.position.set(5, 0.01, 0);
  group.add(road2);

  // Street lights
  for (let z = -60; z < 60; z += 15) {
    group.add(makeStreetLight(-7, z));
    group.add(makeStreetLight(7, z));
  }

  // Parked cars
  for (let i = 0; i < 6; i++) {
    const carColors = [0xcc0000, 0x333333, 0x0044aa, 0xeeeeee, 0x444400];
    const side = i % 2 === 0 ? -7.5 : 7.5;
    const car = makeBox(1.8, 1.2, 4, carColors[Math.floor(Math.random() * carColors.length)],
      side, 0, -50 + i * 20);
    group.add(car);
    addCollider(colliders, car);
  }

  scene.add(group);
  return { group, colliders, ufo, spawnPoints: generateSpawnPoints(75) };
}

function generateSpawnPoints(radius) {
  const points = [];
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    const r = radius * (0.6 + Math.random() * 0.4);
    points.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
  }
  return points;
}
