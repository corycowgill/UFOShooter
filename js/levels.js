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
  const trunkMat = makeMaterial(0x553311);
  // Main trunk - tapered
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 * scale, 0.22 * scale, 2.5 * scale, 8),
    trunkMat
  );
  trunk.position.y = 1.25 * scale;
  group.add(trunk);
  // Branches
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + Math.random() * 0.5;
    const branch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03 * scale, 0.06 * scale, 0.8 * scale, 5),
      trunkMat
    );
    branch.position.set(
      Math.cos(angle) * 0.3 * scale,
      (1.5 + i * 0.4) * scale,
      Math.sin(angle) * 0.3 * scale
    );
    branch.rotation.z = Math.cos(angle) * 0.8;
    branch.rotation.x = Math.sin(angle) * 0.8;
    group.add(branch);
  }
  // Multiple foliage clusters
  const foliageMat1 = makeMaterial(0x116622);
  const foliageMat2 = makeMaterial(0x0e5519);
  const mainCanopy = new THREE.Mesh(new THREE.SphereGeometry(1.0 * scale, 8, 8), foliageMat1);
  mainCanopy.position.y = 2.8 * scale;
  group.add(mainCanopy);
  const cluster1 = new THREE.Mesh(new THREE.SphereGeometry(0.7 * scale, 7, 7), foliageMat2);
  cluster1.position.set(-0.5 * scale, 2.5 * scale, 0.3 * scale);
  group.add(cluster1);
  const cluster2 = new THREE.Mesh(new THREE.SphereGeometry(0.65 * scale, 7, 7), foliageMat1);
  cluster2.position.set(0.4 * scale, 2.6 * scale, -0.4 * scale);
  group.add(cluster2);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.5 * scale, 6, 6), foliageMat2);
  top.position.set(0.1 * scale, 3.3 * scale, 0.1 * scale);
  group.add(top);
  group.position.set(x, 0, z);
  return group;
}

function makeStreetLight(x, z) {
  const group = new THREE.Group();
  const poleMat = makeMaterial(0x555555);
  // Base plate
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.2, 0.3, 8),
    makeMaterial(0x444444)
  );
  base.position.y = 0.15;
  group.add(base);
  // Pole - tapered
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.06, 5, 8),
    poleMat
  );
  pole.position.y = 2.8;
  group.add(pole);
  // Curved arm
  const arm = new THREE.Mesh(
    new THREE.TorusGeometry(0.6, 0.025, 6, 8, Math.PI / 2),
    poleMat
  );
  arm.position.set(0.6, 5.0, 0);
  arm.rotation.z = Math.PI;
  arm.rotation.y = Math.PI / 2;
  group.add(arm);
  // Lantern fixture
  const fixture = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 0.25, 8),
    makeMaterial(0x666666)
  );
  fixture.position.set(1.2, 4.7, 0);
  group.add(fixture);
  // Bulb
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffdd88 })
  );
  bulb.position.set(1.2, 4.55, 0);
  group.add(bulb);
  const light = new THREE.PointLight(0xffdd88, 2.0, 25);
  light.position.set(1.2, 4.5, 0);
  group.add(light);
  group.position.set(x, 0, z);
  return group;
}

function makeCar(x, z, color, rotation = 0) {
  const group = new THREE.Group();
  // Body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.7, 4),
    makeMaterial(color)
  );
  body.position.y = 0.55;
  group.add(body);
  // Cabin/roof
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.6, 2.0),
    makeMaterial(color)
  );
  cabin.position.set(0, 1.15, -0.3);
  group.add(cabin);
  // Windshield
  const windshield = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.6),
    new THREE.MeshPhongMaterial({ color: 0x334466, transparent: true, opacity: 0.6, shininess: 100 })
  );
  windshield.position.set(0, 1.1, 0.65);
  windshield.rotation.x = -0.3;
  group.add(windshield);
  // Rear window
  const rearWin = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.5),
    new THREE.MeshPhongMaterial({ color: 0x334466, transparent: true, opacity: 0.6 })
  );
  rearWin.position.set(0, 1.1, -1.35);
  rearWin.rotation.x = 0.3;
  rearWin.rotation.y = Math.PI;
  group.add(rearWin);
  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12);
  const wheelMat = makeMaterial(0x111111);
  const wheelPos = [[-0.9,0.3,1.2],[0.9,0.3,1.2],[-0.9,0.3,-1.2],[0.9,0.3,-1.2]];
  for (const [wx,wy,wz] of wheelPos) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, wy, wz);
    group.add(wheel);
    const hub = new THREE.Mesh(new THREE.CircleGeometry(0.15, 8), makeMaterial(0x888888));
    hub.position.set(wx > 0 ? wx+0.11 : wx-0.11, wy, wz);
    hub.rotation.y = wx > 0 ? Math.PI/2 : -Math.PI/2;
    group.add(hub);
  }
  // Headlights
  for (const side of [-0.6, 0.6]) {
    const hl = new THREE.Mesh(new THREE.CircleGeometry(0.1, 8), new THREE.MeshBasicMaterial({ color: 0xffffaa }));
    hl.position.set(side, 0.6, 2.01);
    group.add(hl);
  }
  // Taillights
  for (const side of [-0.6, 0.6]) {
    const tl = new THREE.Mesh(new THREE.CircleGeometry(0.08, 6), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    tl.position.set(side, 0.6, -2.01);
    tl.rotation.y = Math.PI;
    group.add(tl);
  }
  // Bumpers
  const bumperMat = makeMaterial(0x444444);
  const fb = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.15, 0.15), bumperMat);
  fb.position.set(0, 0.28, 2.0);
  group.add(fb);
  const rb = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.15, 0.15), bumperMat);
  rb.position.set(0, 0.28, -2.0);
  group.add(rb);
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

function makeBench(x, z) {
  const group = new THREE.Group();
  const woodMat = makeMaterial(0x664422);
  const metalMat = makeMaterial(0x444444);
  // Seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.5), woodMat);
  seat.position.y = 0.5;
  group.add(seat);
  // Seat slats
  for (let i = 0; i < 4; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.08), woodMat);
    slat.position.set(0, 0.52, -0.18 + i * 0.12);
    group.add(slat);
  }
  // Backrest
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.06), woodMat);
  back.position.set(0, 0.85, -0.25);
  back.rotation.x = -0.15;
  group.add(back);
  // Legs (metal)
  for (const sx of [-0.6, 0.6]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.4), metalMat);
    leg.position.set(sx, 0.25, 0);
    group.add(leg);
    // Armrest support
    const armSupport = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), metalMat);
    armSupport.position.set(sx, 0.7, -0.22);
    group.add(armSupport);
    // Armrest
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.4), metalMat);
    arm.position.set(sx, 0.9, -0.05);
    group.add(arm);
  }
  group.position.set(x, 0, z);
  return group;
}

function makeTrafficLight(x, z) {
  const group = new THREE.Group();
  const poleMat = makeMaterial(0x444444);
  // Pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5.5, 6), poleMat);
  pole.position.y = 2.75;
  group.add(pole);
  // Horizontal arm
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 6), poleMat);
  arm.position.set(1.5, 5.3, 0);
  arm.rotation.z = Math.PI / 2;
  group.add(arm);
  // Signal housing
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.9, 0.25), makeMaterial(0x222222));
  housing.position.set(2.5, 5.3, 0);
  group.add(housing);
  // Visor on top
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.3), makeMaterial(0x222222));
  visor.position.set(2.5, 5.78, 0);
  group.add(visor);
  // Lights (red, yellow, green)
  const lightColors = [0xff0000, 0xffaa00, 0x00ff00];
  for (let i = 0; i < 3; i++) {
    const bulb = new THREE.Mesh(
      new THREE.CircleGeometry(0.08, 8),
      new THREE.MeshBasicMaterial({ color: lightColors[i], transparent: true, opacity: i === 0 ? 1.0 : 0.3 })
    );
    bulb.position.set(2.5, 5.55 - i * 0.25, 0.13);
    group.add(bulb);
  }
  // Walk signal on pole
  const walkBox = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.15), makeMaterial(0x222222));
  walkBox.position.set(0, 3.5, 0.1);
  group.add(walkBox);
  const walkLight = new THREE.Mesh(
    new THREE.CircleGeometry(0.06, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  walkLight.position.set(0, 3.5, 0.18);
  group.add(walkLight);
  group.position.set(x, 0, z);
  return group;
}

function makeFireHydrant(x, z) {
  const group = new THREE.Group();
  const hydrantMat = makeMaterial(0xcc2200);
  // Body
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.6, 8), hydrantMat);
  body.position.y = 0.3;
  group.add(body);
  // Top cap
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.12, 8), hydrantMat);
  cap.position.y = 0.66;
  group.add(cap);
  // Bonnet
  const bonnet = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), hydrantMat);
  bonnet.position.y = 0.75;
  group.add(bonnet);
  // Side nozzles
  for (const side of [-1, 1]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 6), hydrantMat);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(side * 0.16, 0.42, 0);
    group.add(nozzle);
    const nozzleCap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 6),
      makeMaterial(0xcc9900));
    nozzleCap.rotation.z = Math.PI / 2;
    nozzleCap.position.set(side * 0.22, 0.42, 0);
    group.add(nozzleCap);
  }
  // Base plate
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 8), makeMaterial(0x999999));
  base.position.y = 0.02;
  group.add(base);
  group.position.set(x, 0, z);
  return group;
}

function makeTrashCan(x, z) {
  const group = new THREE.Group();
  const canMat = makeMaterial(0x336633);
  // Body
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.22, 0.9, 8), canMat);
  body.position.y = 0.45;
  group.add(body);
  // Rim
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.02, 4, 8), canMat);
  rim.position.y = 0.9;
  group.add(rim);
  // Lid (dome)
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 4, 0, Math.PI * 2, 0, Math.PI / 3),
    makeMaterial(0x338833));
  lid.position.y = 0.92;
  group.add(lid);
  // Opening slot
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.06), makeMaterial(0x111111));
  slot.position.set(0, 0.95, 0.15);
  group.add(slot);
  group.position.set(x, 0, z);
  return group;
}

function makeNewsBox(x, z) {
  const group = new THREE.Group();
  const boxMat = makeMaterial(0x2244aa);
  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.4), boxMat);
  body.position.y = 0.45;
  group.add(body);
  // Coin slot panel
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15),
    makeMaterial(0x888888));
  panel.position.set(0, 0.65, 0.201);
  group.add(panel);
  // Window
  const window = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.25),
    new THREE.MeshPhongMaterial({ color: 0x334466, transparent: true, opacity: 0.6 }));
  window.position.set(0, 0.35, 0.201);
  group.add(window);
  // Legs
  for (const [lx, lz] of [[-0.2, -0.15], [0.2, -0.15], [-0.2, 0.15], [0.2, 0.15]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.04), makeMaterial(0x222222));
    leg.position.set(lx, 0.05, lz);
    group.add(leg);
  }
  group.position.set(x, 0, z);
  return group;
}

function makePlanter(x, z) {
  const group = new THREE.Group();
  // Concrete planter box
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.3, 0.5, 8),
    makeMaterial(0x777777)
  );
  pot.position.y = 0.25;
  group.add(pot);
  // Soil
  const soil = new THREE.Mesh(
    new THREE.CircleGeometry(0.35, 8),
    makeMaterial(0x3a2a1a)
  );
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 0.5;
  group.add(soil);
  // Small bush
  const bush = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 6, 6),
    makeMaterial(0x2a6622)
  );
  bush.position.y = 0.8;
  group.add(bush);
  // Some flowers
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const flower = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 4, 4),
      new THREE.MeshBasicMaterial({ color: [0xff4488, 0xffaa22, 0xff66aa, 0xffdd00][i] })
    );
    flower.position.set(Math.cos(angle) * 0.25, 0.9, Math.sin(angle) * 0.25);
    group.add(flower);
  }
  group.position.set(x, 0, z);
  return group;
}

function makeBusStop(x, z, rotation = 0) {
  const group = new THREE.Group();
  const metalMat = makeMaterial(0x555555);
  const glassMat = new THREE.MeshPhongMaterial({ color: 0x446688, transparent: true, opacity: 0.3, shininess: 100 });
  // Poles
  for (const px of [-1.2, 1.2]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 6), metalMat);
    pole.position.set(px, 1.5, 0);
    group.add(pole);
  }
  // Roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 1.5), metalMat);
  roof.position.set(0, 3, 0);
  group.add(roof);
  // Roof overhang curve
  const overhang = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.04, 0.3), metalMat);
  overhang.position.set(0, 2.96, -0.75);
  group.add(overhang);
  // Glass back panel
  const backPanel = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.5), glassMat);
  backPanel.position.set(0, 1.5, 0.7);
  group.add(backPanel);
  // Glass side panels
  for (const sx of [-1.2, 1.2]) {
    const sidePanel = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.5), glassMat);
    sidePanel.position.set(sx, 1.5, 0);
    sidePanel.rotation.y = Math.PI / 2;
    group.add(sidePanel);
  }
  // Bench inside
  const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.35), metalMat);
  benchSeat.position.set(0, 0.55, 0.3);
  group.add(benchSeat);
  // Ad panel frame
  const adFrame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 0.05), makeMaterial(0x333333));
  adFrame.position.set(0, 1.8, 0.68);
  group.add(adFrame);
  // Ad content (colored poster)
  const adPoster = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0),
    new THREE.MeshBasicMaterial({ color: 0x2244aa }));
  adPoster.position.set(0, 1.8, 0.65);
  group.add(adPoster);
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

function makeDumpster(x, z, rotation = 0) {
  const group = new THREE.Group();
  const dumpMat = makeMaterial(0x226622);
  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 1.3), dumpMat);
  body.position.y = 0.6;
  group.add(body);
  // Rim
  const rim = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 1.4), makeMaterial(0x113311));
  rim.position.y = 1.22;
  group.add(rim);
  // Lid (slightly open)
  const lid = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.06, 1.35), makeMaterial(0x1a5511));
  lid.position.set(0, 1.25, -0.5);
  lid.rotation.x = -0.25;
  group.add(lid);
  // Wheels
  for (const [wx, wz] of [[-0.8, -0.6], [0.8, -0.6]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 8), makeMaterial(0x111111));
    wheel.position.set(wx, 0.15, wz);
    wheel.rotation.z = Math.PI / 2;
    group.add(wheel);
  }
  // Side handles
  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), makeMaterial(0x333333));
    handle.position.set(side * 1.03, 0.9, 0);
    group.add(handle);
  }
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

function makeUtilityPole(x, z) {
  const group = new THREE.Group();
  const woodMat = makeMaterial(0x5a4020);
  // Main pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 6), woodMat);
  pole.position.y = 4.5;
  group.add(pole);
  // Cross arm
  const crossArm = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.12), woodMat);
  crossArm.position.y = 8.2;
  group.add(crossArm);
  // Insulators
  for (const ix of [-1.2, -0.4, 0.4, 1.2]) {
    const insulator = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.15, 6),
      makeMaterial(0x666688));
    insulator.position.set(ix, 8.35, 0);
    group.add(insulator);
  }
  // Transformer
  const transformer = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8),
    makeMaterial(0x555555));
  transformer.position.set(0.2, 6.5, 0);
  group.add(transformer);
  // Guy wire anchors (visual only)
  for (const side of [-1, 1]) {
    const wire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 5, 3),
      makeMaterial(0x333333)
    );
    wire.position.set(side * 0.8, 5.5, 0);
    wire.rotation.z = side * 0.6;
    group.add(wire);
  }
  group.position.set(x, 0, z);
  return group;
}

function makeFountain(x, z, scale = 1) {
  const group = new THREE.Group();
  const stoneMat = makeMaterial(0x999999);
  // Base pool
  const pool = new THREE.Mesh(
    new THREE.CylinderGeometry(3 * scale, 3.2 * scale, 0.5 * scale, 16),
    stoneMat
  );
  pool.position.y = 0.25 * scale;
  group.add(pool);
  // Water surface
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(2.8 * scale, 16),
    new THREE.MeshPhongMaterial({ color: 0x2266aa, transparent: true, opacity: 0.6, shininess: 100 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.45 * scale;
  group.add(water);
  // Center column
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3 * scale, 0.4 * scale, 2 * scale, 8),
    stoneMat
  );
  column.position.y = 1.5 * scale;
  group.add(column);
  // Top bowl
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(1 * scale, 0.6 * scale, 0.3 * scale, 12),
    stoneMat
  );
  bowl.position.y = 2.5 * scale;
  group.add(bowl);
  // Water jets (glowing cylinders)
  const jetMat = new THREE.MeshBasicMaterial({ color: 0x88bbff, transparent: true, opacity: 0.3 });
  // Center jet
  const centerJet = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.02, 1.5 * scale, 4), jetMat);
  centerJet.position.y = 3.5 * scale;
  group.add(centerJet);
  // Side jets
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const jet = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.01, 0.8 * scale, 4),
      jetMat
    );
    jet.position.set(
      Math.cos(angle) * 0.7 * scale,
      3 * scale,
      Math.sin(angle) * 0.7 * scale
    );
    jet.rotation.x = Math.sin(angle) * 0.3;
    jet.rotation.z = -Math.cos(angle) * 0.3;
    group.add(jet);
  }
  // Light
  const fLight = new THREE.PointLight(0x4488ff, 1.0, 10);
  fLight.position.y = 0.5 * scale;
  group.add(fLight);
  group.position.set(x, 0, z);
  return group;
}

function makeAnimalStatue(x, z, type = 'lion') {
  const group = new THREE.Group();
  const bronzeMat = makeMaterial(0x8a7340);
  // Pedestal
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 1), makeMaterial(0x777777));
  pedestal.position.y = 0.3;
  group.add(pedestal);
  // Simplified animal shape based on type
  if (type === 'lion') {
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 1.2), bronzeMat);
    body.position.set(0, 0.95, 0);
    group.add(body);
    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), bronzeMat);
    head.position.set(0, 1.15, 0.6);
    group.add(head);
    // Mane
    const mane = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), bronzeMat);
    mane.position.set(0, 1.2, 0.5);
    mane.scale.set(1.2, 1, 0.8);
    group.add(mane);
    // Legs
    for (const [lx, lz] of [[-0.2, 0.4], [0.2, 0.4], [-0.2, -0.4], [0.2, -0.4]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.12), bronzeMat);
      leg.position.set(lx, 0.7, lz);
      group.add(leg);
    }
    // Tail
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.01, 0.6, 4), bronzeMat);
    tail.position.set(0, 1.1, -0.7);
    tail.rotation.x = 0.4;
    group.add(tail);
  } else if (type === 'bear') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), bronzeMat);
    body.position.set(0, 1.2, 0);
    body.scale.set(0.8, 1, 0.7);
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), bronzeMat);
    head.position.set(0, 1.7, 0.2);
    group.add(head);
    // Ears
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.08, 4, 4), bronzeMat);
      ear.position.set(side * 0.18, 1.9, 0.15);
      group.add(ear);
    }
    // Snout
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.15), bronzeMat);
    snout.position.set(0, 1.6, 0.4);
    group.add(snout);
    // Arms raised
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.6, 6), bronzeMat);
      arm.position.set(side * 0.35, 1.5, 0.15);
      arm.rotation.z = side * -0.5;
      group.add(arm);
    }
  } else {
    // Generic quadruped
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 1.0), bronzeMat);
    body.position.set(0, 0.9, 0);
    group.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.3), bronzeMat);
    head.position.set(0, 1.05, 0.55);
    group.add(head);
    for (const [lx, lz] of [[-0.15, 0.3], [0.15, 0.3], [-0.15, -0.3], [0.15, -0.3]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 0.1), bronzeMat);
      leg.position.set(lx, 0.68, lz);
      group.add(leg);
    }
  }
  // Nameplate
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.15), makeMaterial(0x444444));
  plate.position.set(0, 0.3, 0.51);
  group.add(plate);
  group.position.set(x, 0, z);
  return group;
}

function makePlayground(x, z) {
  const group = new THREE.Group();
  const metalMat = makeMaterial(0xcc4444);
  const blueMat = makeMaterial(0x2244cc);
  const yellowMat = makeMaterial(0xcccc22);
  // Rubber surface
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), makeMaterial(0x884444));
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.01;
  group.add(surface);
  // Swing set
  const swingGroup = new THREE.Group();
  // A-frame
  for (const side of [-1, 1]) {
    const legA = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.5, 6), metalMat);
    legA.position.set(side * 2, 1.75, -0.3);
    legA.rotation.z = side * -0.15;
    swingGroup.add(legA);
    const legB = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.5, 6), metalMat);
    legB.position.set(side * 2, 1.75, 0.3);
    legB.rotation.z = side * -0.15;
    swingGroup.add(legB);
  }
  // Top bar
  const topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.2, 6), metalMat);
  topBar.rotation.z = Math.PI / 2;
  topBar.position.y = 3.3;
  swingGroup.add(topBar);
  // Swing seats
  for (const sx of [-0.8, 0.8]) {
    // Chains
    for (const cz of [-0.15, 0.15]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 2.2, 3), makeMaterial(0x888888));
      chain.position.set(sx, 2.2, cz);
      swingGroup.add(chain);
    }
    // Seat
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.2), makeMaterial(0x111111));
    seat.position.set(sx, 1.1, 0);
    swingGroup.add(seat);
  }
  swingGroup.position.set(-2, 0, 0);
  group.add(swingGroup);
  // Slide
  const slideGroup = new THREE.Group();
  // Platform
  const platform = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.5), blueMat);
  platform.position.set(0, 2, 0);
  slideGroup.add(platform);
  // Ladder
  for (let i = 0; i < 5; i++) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.04), yellowMat);
    rung.position.set(0, 0.4 + i * 0.4, -0.7);
    slideGroup.add(rung);
  }
  // Ladder sides
  for (const lx of [-0.3, 0.3]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.1, 0.04), yellowMat);
    rail.position.set(lx, 1, -0.7);
    slideGroup.add(rail);
  }
  // Slide surface
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 2.8), makeMaterial(0xdddd22));
  slide.position.set(0, 1.0, 1.6);
  slide.rotation.x = 0.35;
  slideGroup.add(slide);
  // Slide sides
  for (const lx of [-0.36, 0.36]) {
    const sideRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 2.8), makeMaterial(0xcc2222));
    sideRail.position.set(lx, 1.1, 1.6);
    sideRail.rotation.x = 0.35;
    slideGroup.add(sideRail);
  }
  // Support legs
  for (const [px, pz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
    const supportLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2, 6), blueMat);
    supportLeg.position.set(px, 1, pz);
    slideGroup.add(supportLeg);
  }
  slideGroup.position.set(2.5, 0, 0);
  group.add(slideGroup);
  group.position.set(x, 0, z);
  return group;
}

function makeRock(x, z, scale = 1) {
  const group = new THREE.Group();
  const rockMat = makeMaterial(0x666655);
  const mainRock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.5 * scale, 0),
    rockMat
  );
  mainRock.scale.set(1, 0.6, 1.2);
  mainRock.position.y = 0.2 * scale;
  mainRock.rotation.y = Math.random() * Math.PI;
  group.add(mainRock);
  if (scale > 0.8) {
    const small = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25 * scale, 0), rockMat);
    small.position.set(0.4 * scale, 0.1, 0.3 * scale);
    small.rotation.set(Math.random(), Math.random(), 0);
    group.add(small);
  }
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
  // Twilight invasion sky - gradient sphere
  const skyGeo = new THREE.SphereGeometry(500, 32, 32);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0x0e0e2a,
    side: THREE.BackSide
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // Stars - varied sizes and brightness
  const starGeo = new THREE.BufferGeometry();
  const starVerts = [];
  for (let i = 0; i < 3000; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const r = 490;
    starVerts.push(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi)
    );
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, transparent: true, opacity: 0.8 });
  scene.add(new THREE.Points(starGeo, starMat));
  // Bright stars (fewer, larger)
  const brightStarGeo = new THREE.BufferGeometry();
  const brightVerts = [];
  for (let i = 0; i < 200; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const r = 488;
    brightVerts.push(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi)
    );
  }
  brightStarGeo.setAttribute('position', new THREE.Float32BufferAttribute(brightVerts, 3));
  const brightStarMat = new THREE.PointsMaterial({ color: 0xeeeeff, size: 1.2, transparent: true, opacity: 0.9 });
  scene.add(new THREE.Points(brightStarGeo, brightStarMat));

  // Moon
  const moonGroup = new THREE.Group();
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(15, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xddddbb })
  );
  moonGroup.add(moon);
  // Moon glow
  const moonGlow = new THREE.Mesh(
    new THREE.SphereGeometry(20, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xddddaa, transparent: true, opacity: 0.08 })
  );
  moonGroup.add(moonGlow);
  // Craters
  for (let i = 0; i < 8; i++) {
    const crater = new THREE.Mesh(
      new THREE.CircleGeometry(1.5 + Math.random() * 2, 8),
      new THREE.MeshBasicMaterial({ color: 0xbbbb99, transparent: true, opacity: 0.3 })
    );
    const angle1 = Math.random() * Math.PI * 0.5 - 0.2;
    const angle2 = Math.random() * Math.PI * 0.5 - 0.2;
    crater.position.set(
      Math.sin(angle1) * 14.5,
      Math.cos(angle1) * Math.sin(angle2) * 14.5,
      Math.cos(angle1) * Math.cos(angle2) * 14.5
    );
    crater.lookAt(0, 0, 0);
    moonGroup.add(crater);
  }
  moonGroup.position.set(200, 250, -300);
  scene.add(moonGroup);
  // Moonlight
  const moonLight = new THREE.DirectionalLight(0xbbbbdd, 0.15);
  moonLight.position.set(200, 250, -300);
  scene.add(moonLight);

  // Wispy clouds (semi-transparent planes at various heights)
  for (let i = 0; i < 12; i++) {
    const cloudGroup = new THREE.Group();
    const cloudCount = 3 + Math.floor(Math.random() * 4);
    for (let j = 0; j < cloudCount; j++) {
      const cloud = new THREE.Mesh(
        new THREE.SphereGeometry(8 + Math.random() * 12, 8, 6),
        new THREE.MeshBasicMaterial({
          color: 0x222244,
          transparent: true,
          opacity: 0.12 + Math.random() * 0.08,
        })
      );
      cloud.scale.set(1.5 + Math.random(), 0.3 + Math.random() * 0.2, 1 + Math.random() * 0.5);
      cloud.position.set(
        (Math.random() - 0.5) * 25,
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 15
      );
      cloudGroup.add(cloud);
    }
    cloudGroup.position.set(
      (Math.random() - 0.5) * 500,
      60 + Math.random() * 60,
      (Math.random() - 0.5) * 500
    );
    scene.add(cloudGroup);
  }

  // UFO mothership - enhanced
  const ufoGroup = new THREE.Group();
  const ufoBody = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 12, 2, 24),
    new THREE.MeshPhongMaterial({ color: 0x445566, emissive: 0x223344 })
  );
  ufoGroup.add(ufoBody);
  // Bottom plate
  const ufoBottom = new THREE.Mesh(
    new THREE.CylinderGeometry(11.5, 9, 0.5, 24),
    new THREE.MeshPhongMaterial({ color: 0x334455, emissive: 0x112233 })
  );
  ufoBottom.position.y = -1.2;
  ufoGroup.add(ufoBottom);
  const ufoTop = new THREE.Mesh(
    new THREE.SphereGeometry(5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x556677, emissive: 0x334455 })
  );
  ufoTop.position.y = 1;
  ufoGroup.add(ufoTop);
  // Dome glass
  const ufoDome = new THREE.Mesh(
    new THREE.SphereGeometry(3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x66ff99, emissive: 0x113322, transparent: true, opacity: 0.25 })
  );
  ufoDome.position.y = 1;
  ufoGroup.add(ufoDome);
  // Ring detail
  const ufoRing = new THREE.Mesh(
    new THREE.TorusGeometry(10, 0.15, 6, 32),
    new THREE.MeshPhongMaterial({ color: 0x667788, emissive: 0x334455 })
  );
  ufoRing.rotation.x = Math.PI / 2;
  ufoRing.position.y = -0.5;
  ufoGroup.add(ufoRing);
  // Lights under UFO
  const ufoLight = new THREE.PointLight(0x00ff88, 3, 150);
  ufoLight.position.y = -2;
  ufoGroup.add(ufoLight);
  // Tractor beam cone
  const beamGeo = new THREE.CylinderGeometry(1, 15, 80, 16, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.04, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = -42;
  ufoGroup.add(beam);
  // Inner beam
  const innerBeamGeo = new THREE.CylinderGeometry(0.5, 5, 80, 8, 1, true);
  const innerBeamMat = new THREE.MeshBasicMaterial({ color: 0x88ffbb, transparent: true, opacity: 0.02, side: THREE.DoubleSide });
  const innerBeam = new THREE.Mesh(innerBeamGeo, innerBeamMat);
  innerBeam.position.y = -42;
  ufoGroup.add(innerBeam);
  // Running lights
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const rl = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 6, 6),
      new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0x00ff88 : 0x00ffcc })
    );
    rl.position.set(Math.cos(angle) * 10.5, -1, Math.sin(angle) * 10.5);
    ufoGroup.add(rl);
  }
  // Window ports
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const port = new THREE.Mesh(
      new THREE.CircleGeometry(0.4, 8),
      new THREE.MeshBasicMaterial({ color: 0x88ffbb, transparent: true, opacity: 0.5 })
    );
    port.position.set(Math.cos(angle) * 9, 0, Math.sin(angle) * 9);
    port.rotation.y = -angle + Math.PI / 2;
    ufoGroup.add(port);
  }
  ufoGroup.position.set(0, 80, -30);
  scene.add(ufoGroup);

  // Light fog
  scene.fog = new THREE.FogExp2(0x0e0e2a, 0.003);

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

  // Ambient - bright enough to see the city
  scene.add(new THREE.AmbientLight(0x6677aa, 1.2));
  const dirLight = new THREE.DirectionalLight(0xaabbff, 0.8);
  dirLight.position.set(10, 30, 10);
  scene.add(dirLight);
  const fillLight = new THREE.HemisphereLight(0x4466aa, 0x222244, 0.6);
  scene.add(fillLight);

  const sidewalkMat = makeMaterial(0x888888);
  const curbMat = makeMaterial(0x999999);
  const roadMat = makeMaterial(0x1e1e1e);

  // =============================================
  // === MICHIGAN AVENUE (north-south, z-axis) ===
  // =============================================
  // Road: 14 wide centered at x=0
  const michiganAve = new THREE.Mesh(new THREE.PlaneGeometry(14, 200), roadMat);
  michiganAve.rotation.x = -Math.PI / 2;
  michiganAve.position.set(0, 0.02, 0);
  group.add(michiganAve);

  // Center line (dashed yellow)
  for (let z = -95; z < 95; z += 6) {
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 3),
      new THREE.MeshBasicMaterial({ color: 0xffff00 })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.03, z);
    group.add(line);
  }
  // Lane markings (white dashed)
  for (const lx of [-3.5, 3.5]) {
    for (let z = -95; z < 95; z += 8) {
      const dash = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, 4),
        new THREE.MeshBasicMaterial({ color: 0xaaaaaa })
      );
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(lx, 0.03, z);
      group.add(dash);
    }
  }

  // === SIDEWALKS along Michigan Ave ===
  for (const side of [-1, 1]) {
    // Sidewalk (4 wide, just outside road edge at ±7)
    const sw = new THREE.Mesh(new THREE.PlaneGeometry(4, 200), sidewalkMat);
    sw.rotation.x = -Math.PI / 2;
    sw.position.set(side * 9, 0.04, 0);
    group.add(sw);
    // Inner curb (road edge)
    const innerCurb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 200), curbMat);
    innerCurb.position.set(side * 7, 0.075, 0);
    group.add(innerCurb);
    // Outer curb (building edge)
    const outerCurb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 200), curbMat);
    outerCurb.position.set(side * 11, 0.075, 0);
    group.add(outerCurb);
  }

  // === CROSS STREET at z = -35 ===
  const crossRoad1 = new THREE.Mesh(new THREE.PlaneGeometry(200, 10), roadMat);
  crossRoad1.rotation.x = -Math.PI / 2;
  crossRoad1.position.set(0, 0.025, -35);
  group.add(crossRoad1);
  // Cross street center line
  for (let x = -90; x < 90; x += 6) {
    const cl = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xffff00 })
    );
    cl.rotation.x = -Math.PI / 2;
    cl.position.set(x, 0.035, -35);
    group.add(cl);
  }

  // === CROSS STREET at z = 35 ===
  const crossRoad2 = new THREE.Mesh(new THREE.PlaneGeometry(200, 10), roadMat);
  crossRoad2.rotation.x = -Math.PI / 2;
  crossRoad2.position.set(0, 0.025, 35);
  group.add(crossRoad2);
  for (let x = -90; x < 90; x += 6) {
    const cl = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xffff00 })
    );
    cl.rotation.x = -Math.PI / 2;
    cl.position.set(x, 0.035, 35);
    group.add(cl);
  }

  // === CROSSWALKS at intersections ===
  for (const zInt of [-35, 35]) {
    // Crosswalks across Michigan Ave (north & south side of intersection)
    for (const zSide of [-6, 6]) {
      for (let i = 0; i < 8; i++) {
        const stripe = new THREE.Mesh(
          new THREE.PlaneGeometry(1.2, 0.4),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(-5.5 + i * 1.6, 0.035, zInt + zSide);
        group.add(stripe);
      }
    }
    // Crosswalks across cross street (east & west side)
    for (const xSide of [-8, 8]) {
      for (let i = 0; i < 6; i++) {
        const stripe = new THREE.Mesh(
          new THREE.PlaneGeometry(0.4, 1.2),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(xSide, 0.035, zInt - 3.5 + i * 1.4);
        group.add(stripe);
      }
    }
  }

  // ========================================
  // === CHICAGO RIVER (east-west at z=0) ===
  // ========================================
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 12),
    new THREE.MeshPhongMaterial({ color: 0x0d3d5c, transparent: true, opacity: 0.8, emissive: 0x001122 })
  );
  river.rotation.x = -Math.PI / 2;
  river.position.set(0, 0.01, 0);
  group.add(river);

  // Riverwalk (stone embankment along both banks)
  for (const zSide of [-1, 1]) {
    const bankZ = zSide * 6.5;
    // Stone wall
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(200, 1.5, 0.6),
      makeMaterial(0x555555)
    );
    wall.position.set(0, 0.75, bankZ);
    group.add(wall);
    // Railing on top
    const railing = new THREE.Mesh(
      new THREE.BoxGeometry(200, 0.1, 0.08),
      makeMaterial(0x333333)
    );
    railing.position.set(0, 1.55, bankZ);
    group.add(railing);
    // Railing posts
    for (let x = -90; x < 90; x += 4) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.5, 0.06),
        makeMaterial(0x333333)
      );
      post.position.set(x, 1.3, bankZ);
      group.add(post);
    }
    // Walkway along the river
    const walkway = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 2),
      makeMaterial(0x776655)
    );
    walkway.rotation.x = -Math.PI / 2;
    walkway.position.set(0, 0.05, bankZ + zSide * 1.3);
    group.add(walkway);
  }

  // === MICHIGAN AVE BRIDGE over the river ===
  // Bridge deck (raises the road over the river)
  const bridgeDeck = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.8, 14),
    makeMaterial(0x555555)
  );
  bridgeDeck.position.set(0, 0.4, 0);
  group.add(bridgeDeck);
  addCollider(colliders, bridgeDeck);
  // Bridge road surface
  const bridgeRoad = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 12),
    roadMat
  );
  bridgeRoad.rotation.x = -Math.PI / 2;
  bridgeRoad.position.set(0, 0.81, 0);
  group.add(bridgeRoad);
  // Bridge railings
  for (const xSide of [-8, 8]) {
    const bridgeRail = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 1.2, 14),
      makeMaterial(0x444444)
    );
    bridgeRail.position.set(xSide, 1.4, 0);
    group.add(bridgeRail);
    // Decorative posts
    for (let z = -6; z <= 6; z += 3) {
      const bPost = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 1.5, 0.2),
        makeMaterial(0x555555)
      );
      bPost.position.set(xSide, 1.5, z);
      group.add(bPost);
    }
  }
  // Bridge support arches
  for (const zOff of [-3, 3]) {
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(2.5, 0.3, 6, 12, Math.PI),
      makeMaterial(0x444444)
    );
    arch.position.set(0, -0.5, zOff);
    arch.rotation.y = Math.PI / 2;
    group.add(arch);
  }

  // ============================================
  // === MILLENNIUM PARK (east of Michigan Ave) ==
  // ============================================
  // Park ground (east side, z = 15 to 55)
  const parkGround = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 35),
    makeMaterial(0x3a6633)
  );
  parkGround.rotation.x = -Math.PI / 2;
  parkGround.position.set(32, 0.03, 20);
  group.add(parkGround);

  // Bean plaza (paved area within the park)
  const beanPlaza = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 22),
    makeMaterial(0x999999)
  );
  beanPlaza.rotation.x = -Math.PI / 2;
  beanPlaza.position.set(30, 0.04, 20);
  group.add(beanPlaza);
  // Plaza border tiles
  const borderMat = makeMaterial(0x777777);
  for (const side of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const border = new THREE.Mesh(
      new THREE.PlaneGeometry(side[0] !== 0 ? 0.5 : 22, side[1] !== 0 ? 0.5 : 22),
      borderMat
    );
    border.rotation.x = -Math.PI / 2;
    border.position.set(30 + side[0] * 11.25, 0.045, 20 + side[1] * 11.25);
    group.add(border);
  }

  // === THE BEAN (Cloud Gate) - now in Millennium Park ===
  const bean = new THREE.Mesh(
    new THREE.SphereGeometry(3, 24, 24),
    new THREE.MeshPhongMaterial({
      color: 0xbbbbdd,
      emissive: 0x222233,
      shininess: 120,
    })
  );
  bean.scale.set(1.5, 0.8, 1);
  bean.position.set(30, 2.4, 20);
  group.add(bean);
  addCollider(colliders, bean);
  // Bean reflection on ground
  const beanReflect = new THREE.Mesh(
    new THREE.CircleGeometry(4, 16),
    new THREE.MeshBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.3 })
  );
  beanReflect.rotation.x = -Math.PI / 2;
  beanReflect.position.set(30, 0.045, 20);
  group.add(beanReflect);

  // Park benches around the Bean
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const bx = 30 + Math.cos(angle) * 9;
    const bz = 20 + Math.sin(angle) * 9;
    const bench = makeBench(bx, bz);
    bench.rotation.y = angle + Math.PI;
    group.add(bench);
  }

  // Park trees
  const parkTreePositions = [
    [16, 12], [16, 28], [44, 12], [44, 28],
    [20, 6], [40, 6], [20, 34], [40, 34],
    [14, 20], [46, 20],
  ];
  for (const [tx, tz] of parkTreePositions) {
    group.add(makeTree(tx, tz, 0.8 + Math.random() * 0.4));
  }

  // Park path from sidewalk to Bean
  const parkPath = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 20),
    makeMaterial(0x887766)
  );
  parkPath.rotation.x = -Math.PI / 2;
  parkPath.position.set(20, 0.04, 20);
  group.add(parkPath);

  // Park lamp posts
  for (const [lx, lz] of [[20, 10], [20, 30], [40, 10], [40, 30]]) {
    group.add(makeStreetLight(lx, lz));
  }

  // ================================================
  // === WILLIS TOWER (Sears Tower) - west side ===
  // ================================================
  const willis = makeBox(8, 45, 8, 0x222222, -30, 0, -55);
  group.add(willis);
  addCollider(colliders, willis);
  // Setback tiers (Willis has stepped profile)
  const willisT2 = makeBox(6, 8, 6, 0x222222, -30, 45, -55);
  group.add(willisT2);
  const willisT3 = makeBox(4, 6, 4, 0x222222, -30, 53, -55);
  group.add(willisT3);
  // Antennas
  const ant1 = makeBox(0.2, 12, 0.2, 0x444444, -30, 59, -55);
  group.add(ant1);
  const ant2 = makeBox(0.2, 10, 0.2, 0x444444, -28, 59, -55);
  group.add(ant2);
  // Antenna tip lights
  for (const [ax, ah] of [[-30, 65], [-28, 64]]) {
    const tipLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
    tipLight.position.set(ax, ah, -55);
    group.add(tipLight);
  }
  // Window lights
  for (let y = 2; y < 44; y += 3) {
    for (let side = 0; side < 4; side++) {
      if (Math.random() > 0.35) {
        const win = new THREE.Mesh(
          new THREE.PlaneGeometry(0.8, 1.2),
          new THREE.MeshBasicMaterial({ color: 0xffdd66, transparent: true, opacity: 0.4 + Math.random() * 0.6 })
        );
        const angle = side * Math.PI / 2;
        const offset = 4.01;
        win.position.set(
          -30 + Math.sin(angle) * offset + (Math.random() - 0.5) * 3,
          y,
          -55 + Math.cos(angle) * offset + (Math.random() - 0.5) * 3
        );
        win.rotation.y = angle;
        group.add(win);
      }
    }
  }

  // ====================================
  // === TRUMP TOWER - east of river ===
  // ====================================
  const trump = makeBox(6, 38, 6, 0x888899, 30, 0, -15);
  group.add(trump);
  addCollider(colliders, trump);
  // Glass facade
  const trumpGlass = makeBox(6.1, 38, 6.1, 0x4466aa, 30, 0, -15);
  trumpGlass.material.transparent = true;
  trumpGlass.material.opacity = 0.15;
  group.add(trumpGlass);
  // Spire
  const spire = makeBox(0.4, 8, 0.4, 0x999999, 30, 38, -15);
  group.add(spire);

  // =========================================
  // === MICHIGAN AVE BUILDINGS (both sides) ==
  // =========================================
  // West side buildings (x < -11)
  const westBldgData = [
    { x: -20, z: -70, w: 7, d: 6, h: 18 },
    { x: -22, z: -55, w: 8, d: 7, h: 28 },
    { x: -18, z: -20, w: 6, d: 6, h: 15 },
    { x: -22, z: -10, w: 8, d: 5, h: 22 },
    { x: -20, z: 15, w: 7, d: 6, h: 20 },
    { x: -22, z: 30, w: 8, d: 7, h: 25 },
    { x: -18, z: 50, w: 6, d: 5, h: 14 },
    { x: -22, z: 65, w: 8, d: 6, h: 30 },
  ];
  // East side buildings (x > 11) — skip where park is (z 5 to 38)
  const eastBldgData = [
    { x: 20, z: -70, w: 7, d: 6, h: 20 },
    { x: 22, z: -55, w: 8, d: 7, h: 32 },
    { x: 18, z: -20, w: 6, d: 5, h: 16 },
    { x: 20, z: 50, w: 7, d: 6, h: 22 },
    { x: 22, z: 65, w: 8, d: 7, h: 26 },
  ];

  function addBuilding(bd, facingSide) {
    const colors = [0x333344, 0x3a3a4a, 0x2e2e3e, 0x404050, 0x353545];
    const bldg = makeBox(bd.w, bd.h, bd.d, colors[Math.floor(Math.random() * colors.length)], bd.x, 0, bd.z);
    group.add(bldg);
    addCollider(colliders, bldg);
    // Window grid
    for (let y = 2; y < bd.h; y += 3) {
      for (let wOff = -bd.d / 3; wOff <= bd.d / 3; wOff += bd.d / 3) {
        if (Math.random() > 0.3) {
          const win = new THREE.Mesh(
            new THREE.PlaneGeometry(0.8, 1.5),
            new THREE.MeshBasicMaterial({ color: Math.random() > 0.4 ? 0xffdd44 : 0x222244, transparent: true, opacity: 0.6 + Math.random() * 0.4 })
          );
          win.position.set(
            bd.x + facingSide * (bd.w / 2 + 0.01),
            y,
            bd.z + wOff
          );
          win.rotation.y = facingSide > 0 ? -Math.PI / 2 : Math.PI / 2;
          group.add(win);
        }
      }
    }
    // Rooftop details
    if (bd.h > 20) {
      // AC units on roof
      const ac = makeBox(1.5, 1, 1.5, 0x666666, bd.x + 1, bd.h, bd.z);
      group.add(ac);
      const ac2 = makeBox(1, 0.8, 1, 0x666666, bd.x - 1.5, bd.h, bd.z + 1);
      group.add(ac2);
    }
  }

  for (const bd of westBldgData) addBuilding(bd, 1);
  for (const bd of eastBldgData) addBuilding(bd, -1);

  // === STREET LIGHTS along Michigan Ave ===
  for (let z = -80; z < 80; z += 15) {
    // Skip river zone (-7 to 7)
    if (z > -8 && z < 8) continue;
    group.add(makeStreetLight(8, z));
    group.add(makeStreetLight(-8, z));
  }

  // === TRAFFIC LIGHTS at intersections ===
  for (const zInt of [-35, 35]) {
    for (const xSide of [-7.5, 7.5]) {
      const tl = makeTrafficLight(xSide, zInt);
      group.add(tl);
    }
  }

  // === FIRE HYDRANTS along sidewalks ===
  for (const [fx, fz] of [[-8, -50], [8, -50], [-8, -15], [8, -15], [-8, 45], [8, 45], [-8, 60], [8, 60]]) {
    group.add(makeFireHydrant(fx, fz));
  }

  // === NEWSPAPER BOXES / TRASH CANS on sidewalks ===
  for (let z = -70; z < 70; z += 20) {
    if (z > -8 && z < 8) continue;
    // West sidewalk trash can
    group.add(makeTrashCan(-9.5, z));
    // East sidewalk newspaper box
    group.add(makeNewsBox(9.5, z + 5));
  }

  // === PLANTERS on sidewalks ===
  for (let z = -65; z < 70; z += 25) {
    if (z > -10 && z < 10) continue;
    group.add(makePlanter(-8.5, z));
    group.add(makePlanter(8.5, z));
  }

  // === PARKED CARS (along curbs, not in road center) ===
  const carColors = [0xcc0000, 0x0044cc, 0x333333, 0xffffff, 0xcccc00, 0x228822, 0x666666];
  // West side parked cars (in the parking lane area near curb)
  for (let i = 0; i < 6; i++) {
    const cz = -65 + i * 22;
    if (cz > -8 && cz < 8) continue; // skip river
    if (cz > 28 && cz < 42) continue; // skip cross street
    const car = makeCar(-5.5, cz, carColors[Math.floor(Math.random() * carColors.length)], 0);
    group.add(car);
    addCollider(colliders, car);
  }
  // East side parked cars
  for (let i = 0; i < 5; i++) {
    const cz = -55 + i * 22;
    if (cz > -8 && cz < 8) continue;
    if (cz > 28 && cz < 42) continue;
    const car = makeCar(5.5, cz, carColors[Math.floor(Math.random() * carColors.length)], 0);
    group.add(car);
    addCollider(colliders, car);
  }

  // === BUS STOPS ===
  group.add(makeBusStop(-9, -55, Math.PI / 2));
  group.add(makeBusStop(9, 55, -Math.PI / 2));

  // === CONSTRUCTION ZONE (west side near bridge) ===
  // Barriers
  const barrierMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
  const barrierStripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let bz = -28; bz < -18; bz += 2.5) {
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.3), barrierMat);
    barrier.position.set(-10, 0.4, bz);
    group.add(barrier);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.15, 0.31), barrierStripeMat);
    stripe.position.set(-10, 0.5, bz);
    group.add(stripe);
  }
  // Traffic cones
  for (let ci = 0; ci < 5; ci++) {
    const coneGroup = new THREE.Group();
    const coneBase = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.3), barrierMat);
    coneBase.position.y = 0.02;
    coneGroup.add(coneBase);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 6), barrierMat);
    cone.position.y = 0.3;
    coneGroup.add(cone);
    const coneStripe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.08, 6), barrierStripeMat);
    coneStripe.position.y = 0.25;
    coneGroup.add(coneStripe);
    coneGroup.position.set(-6.5 + ci * 0.8, 0, -23);
    group.add(coneGroup);
  }
  // Scaffolding (on the nearby building)
  for (let sy = 0; sy < 12; sy += 3) {
    const scaffPlatform = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 4), makeMaterial(0x555555));
    scaffPlatform.position.set(-15, sy + 3, -23);
    group.add(scaffPlatform);
    for (const [spx, spz] of [[-16, -25], [-14, -25], [-16, -21], [-14, -21]]) {
      const scaffPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3, 4), makeMaterial(0x555555));
      scaffPole.position.set(spx, sy + 1.5, spz);
      group.add(scaffPole);
    }
  }

  // === STORE AWNINGS on ground-floor west buildings ===
  for (const bd of westBldgData) {
    if (Math.random() > 0.5) continue;
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(bd.d * 0.6, 0.06, 2),
      makeMaterial([0xcc3333, 0x338833, 0x333388, 0xcc8833][Math.floor(Math.random() * 4)])
    );
    awning.position.set(bd.x + bd.w / 2 + 1, 3.5, bd.z);
    group.add(awning);
  }

  // === DUMPSTERS in alleys ===
  group.add(makeDumpster(-14, -65, 0));
  group.add(makeDumpster(-14, 55, Math.PI));

  // === ADDITIONAL BUILDINGS further back ===
  // Deep west block
  for (let z = -80; z < 80; z += 16) {
    const h = 12 + Math.random() * 20;
    const bldg = makeBox(6, h, 6, 0x3a3a4a, -38 - Math.random() * 8, 0, z);
    group.add(bldg);
    addCollider(colliders, bldg);
  }
  // Deep east block (behind park area)
  for (let z = -80; z < -5; z += 16) {
    const h = 12 + Math.random() * 20;
    const bldg = makeBox(6, h, 6, 0x3a3a4a, 42 + Math.random() * 8, 0, z);
    group.add(bldg);
    addCollider(colliders, bldg);
  }
  for (let z = 45; z < 80; z += 16) {
    const h = 12 + Math.random() * 20;
    const bldg = makeBox(6, h, 6, 0x3a3a4a, 42 + Math.random() * 8, 0, z);
    group.add(bldg);
    addCollider(colliders, bldg);
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

  scene.add(new THREE.AmbientLight(0x557755, 1.2));
  const dirLight = new THREE.DirectionalLight(0xaaffaa, 0.8);
  dirLight.position.set(-10, 20, 10);
  scene.add(dirLight);
  const fillLight = new THREE.HemisphereLight(0x446644, 0x223322, 0.6);
  scene.add(fillLight);

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

  // === Pond with details ===
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(8, 24),
    new THREE.MeshPhongMaterial({ color: 0x114466, transparent: true, opacity: 0.7, shininess: 80 })
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(40, 0.03, 30);
  group.add(pond);
  // Pond edge stones
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    const rock = makeRock(
      40 + Math.cos(angle) * 8.3,
      30 + Math.sin(angle) * 8.3,
      0.3 + Math.random() * 0.3
    );
    group.add(rock);
  }
  // Lily pads
  for (let i = 0; i < 6; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 4;
    const lilyPad = new THREE.Mesh(
      new THREE.CircleGeometry(0.3 + Math.random() * 0.2, 8, 0, Math.PI * 1.8),
      makeMaterial(0x116622)
    );
    lilyPad.rotation.x = -Math.PI / 2;
    lilyPad.rotation.z = Math.random() * Math.PI;
    lilyPad.position.set(40 + Math.cos(angle) * r, 0.04, 30 + Math.sin(angle) * r);
    group.add(lilyPad);
  }
  // Wooden bridge across pond
  const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(2, 0.15, 8), makeMaterial(0x664422));
  bridgeDeck.position.set(40, 0.3, 30);
  group.add(bridgeDeck);
  for (const side of [-1, 1]) {
    const railing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 8), makeMaterial(0x553311));
    railing.position.set(40 + side * 1, 0.65, 30);
    group.add(railing);
    for (let z = -3; z <= 3; z += 2) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), makeMaterial(0x553311));
      post.position.set(40 + side * 1, 0.5, 30 + z);
      group.add(post);
    }
  }

  // === Animal statues in enclosures ===
  group.add(makeAnimalStatue(-20, 15, 'lion'));
  group.add(makeAnimalStatue(20, 15, 'bear'));
  group.add(makeAnimalStatue(-20, -20, 'generic'));
  group.add(makeAnimalStatue(20, -20, 'generic'));
  group.add(makeAnimalStatue(-20, -50, 'generic'));
  group.add(makeAnimalStatue(20, -50, 'bear'));

  // === Central Fountain ===
  group.add(makeFountain(0, 0, 1));

  // === Playground ===
  group.add(makePlayground(40, -20));

  // === Nature Museum Building ===
  const museum = makeBox(20, 8, 12, 0x887766, -40, 0, -40);
  group.add(museum);
  addCollider(colliders, museum);
  // Museum entrance with columns
  const museumDoor = makeBox(3, 5, 0.5, 0x443322, -40, 0, -33.5);
  group.add(museumDoor);
  // Entrance columns
  for (const mx of [-42, -38]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 6, 8), makeMaterial(0x998877));
    col.position.set(mx, 3, -33.5);
    group.add(col);
  }
  // Museum roof
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(14, 4, 4),
    makeMaterial(0x554433)
  );
  roof.position.set(-40, 10, -40);
  roof.rotation.y = Math.PI / 4;
  group.add(roof);
  // Museum windows
  for (let mx = -47; mx < -33; mx += 3) {
    const mWin = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2),
      new THREE.MeshBasicMaterial({ color: 0xffdd66, transparent: true, opacity: 0.4 }));
    mWin.position.set(mx, 4, -33.9);
    group.add(mWin);
  }

  // === Information kiosks along paths ===
  for (const [kx, kz] of [[4, 20], [-4, -10], [4, -40]]) {
    const kiosk = new THREE.Group();
    const kioskPost = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6), makeMaterial(0x556633));
    kioskPost.position.y = 0.9;
    kiosk.add(kioskPost);
    const kioskSign = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.04), makeMaterial(0x446633));
    kioskSign.position.y = 1.6;
    kiosk.add(kioskSign);
    const kioskMap = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7),
      new THREE.MeshBasicMaterial({ color: 0x88aa66 }));
    kioskMap.position.set(0, 1.6, 0.025);
    kiosk.add(kioskMap);
    kiosk.position.set(kx, 0, kz);
    group.add(kiosk);
  }

  // === Flower beds ===
  for (const [fx, fz] of [[8, 35], [-8, 35], [8, -5], [-8, -5], [0, -30]]) {
    const bed = new THREE.Group();
    const bedBorder = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.1, 4, 8),
      makeMaterial(0x665533)
    );
    bedBorder.rotation.x = -Math.PI / 2;
    bedBorder.position.y = 0.1;
    bed.add(bedBorder);
    const bedSoil = new THREE.Mesh(new THREE.CircleGeometry(1.2, 8), makeMaterial(0x3a2a1a));
    bedSoil.rotation.x = -Math.PI / 2;
    bedSoil.position.y = 0.02;
    bed.add(bedSoil);
    // Flowers in rows
    const flowerColors = [0xff4488, 0xffaa22, 0xff66cc, 0xffdd00, 0xee3366, 0xff8844];
    for (let fi = 0; fi < 12; fi++) {
      const fAngle = (fi / 12) * Math.PI * 2;
      const fr = 0.4 + Math.random() * 0.6;
      const flower = new THREE.Mesh(new THREE.SphereGeometry(0.06, 4, 4),
        new THREE.MeshBasicMaterial({ color: flowerColors[Math.floor(Math.random() * flowerColors.length)] }));
      flower.position.set(Math.cos(fAngle) * fr, 0.15, Math.sin(fAngle) * fr);
      bed.add(flower);
      // Stem
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 3), makeMaterial(0x226622));
      stem.position.set(Math.cos(fAngle) * fr, 0.08, Math.sin(fAngle) * fr);
      bed.add(stem);
    }
    bed.position.set(fx, 0, fz);
    group.add(bed);
  }

  // === Scattered rocks and boulders ===
  for (let i = 0; i < 15; i++) {
    const rx = (Math.random() - 0.5) * 100;
    const rz = (Math.random() - 0.5) * 100;
    if (Math.abs(rx) < 3 || Math.abs(rz) < 3) continue;
    group.add(makeRock(rx, rz, 0.5 + Math.random() * 0.8));
  }

  // === Trees everywhere ===
  for (let i = 0; i < 50; i++) {
    const x = (Math.random() - 0.5) * 160;
    const z = (Math.random() - 0.5) * 160;
    // Don't place on paths, enclosures, pond, or playground
    if (Math.abs(x) < 3 || (Math.abs(z) < 3 && Math.abs(x) < 40)) continue;
    if (Math.abs(x - 40) < 10 && Math.abs(z - 30) < 10) continue;
    if (Math.abs(x - 40) < 8 && Math.abs(z + 20) < 6) continue;
    const tree = makeTree(x, z, 0.8 + Math.random() * 0.6);
    group.add(tree);
  }

  // Benches along paths (now proper benches)
  for (let z = -40; z < 40; z += 12) {
    const b = makeBench(3, z);
    b.rotation.y = -Math.PI / 2;
    group.add(b);
    if (z % 24 === 0) {
      const b2 = makeBench(-3, z);
      b2.rotation.y = Math.PI / 2;
      group.add(b2);
    }
  }

  // Trash cans along paths
  for (const [tx, tz] of [[3.5, 5], [-3.5, -15], [3.5, 30], [-3.5, -35]]) {
    group.add(makeTrashCan(tx, tz));
  }

  // Lamp posts
  for (let z = -40; z < 50; z += 12) {
    group.add(makeStreetLight(2.5, z));
    group.add(makeStreetLight(-2.5, z));
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

  scene.add(new THREE.AmbientLight(0x667788, 1.2));
  const dirLight = new THREE.DirectionalLight(0xbbbbff, 0.8);
  dirLight.position.set(5, 25, -10);
  scene.add(dirLight);
  const fillLight = new THREE.HemisphereLight(0x445566, 0x222233, 0.6);
  scene.add(fillLight);

  // === CTA Brown Line Elevated Tracks ===
  // Support pillars with cross bracing
  for (let z = -80; z < 80; z += 8) {
    const pillar = makeBox(0.6, 6, 0.6, 0x555555, 0, 0, z);
    group.add(pillar);
    addCollider(colliders, pillar);
    // Cross braces between pillars
    if (z < 72) {
      const brace = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 8),
        makeMaterial(0x444444)
      );
      brace.position.set(0, 4, z + 4);
      brace.rotation.x = 0.15;
      group.add(brace);
    }
  }
  // Track bed
  const trackBed = makeBox(5, 0.5, 170, 0x444444, 0, 6, 0);
  group.add(trackBed);
  // Rails
  const rail1 = makeBox(0.1, 0.15, 170, 0x888888, -1.2, 6.3, 0);
  const rail2 = makeBox(0.1, 0.15, 170, 0x888888, 1.2, 6.3, 0);
  group.add(rail1, rail2);
  // Railroad ties
  for (let z = -84; z < 84; z += 1) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 0.15), makeMaterial(0x3a3a3a));
    tie.position.set(0, 6.2, z);
    group.add(tie);
  }

  // === Ravenswood Station - enhanced ===
  const stationPlatform = makeBox(8, 0.3, 15, 0x666666, 0, 6.2, 0);
  group.add(stationPlatform);
  // Platform edge stripe
  const platStripe = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 15),
    new THREE.MeshBasicMaterial({ color: 0xffff00 }));
  platStripe.rotation.x = -Math.PI / 2;
  platStripe.position.set(-3.8, 6.36, 0);
  group.add(platStripe);
  // Station shelter - proper roof
  const shelterRoof = makeBox(7.5, 0.15, 5, 0x446666, 0, 9.5, -2);
  group.add(shelterRoof);
  // Shelter supports
  for (const [sx, sz] of [[-3.2, -4.2], [3.2, -4.2], [-3.2, 0.2], [3.2, 0.2]]) {
    const support = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 6), makeMaterial(0x446666));
    support.position.set(sx, 8, sz);
    group.add(support);
  }
  // Benches on platform
  for (const bz of [-3, 0, 3]) {
    const pBench = makeBench(2, 0);
    pBench.position.set(2, 6.35, bz);
    pBench.rotation.y = -Math.PI / 2;
    group.add(pBench);
  }
  // CTA sign
  const ctaSign = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 0.08), makeMaterial(0x224488));
  ctaSign.position.set(0, 9, 0);
  group.add(ctaSign);
  const ctaDot = new THREE.Mesh(new THREE.CircleGeometry(0.25, 12),
    new THREE.MeshBasicMaterial({ color: 0x884400 }));
  ctaDot.position.set(0, 9, 0.05);
  group.add(ctaDot);
  // Station stairs
  const stairs = makeBox(2, 6, 3, 0x555555, 5, 0, 0);
  group.add(stairs);
  addCollider(colliders, stairs);
  // Stair railing
  for (const side of [-1, 1]) {
    const stairRail = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.8, 3.5),
      makeMaterial(0x444444)
    );
    stairRail.position.set(5 + side * 1, 3.4, 0);
    stairRail.rotation.x = 0.35;
    group.add(stairRail);
  }

  // === Residential Buildings (both sides of tracks) ===
  function makeResidential(x, z, stories) {
    const h = stories * 3.5;
    const w = 6 + Math.random() * 4;
    const d = 8 + Math.random() * 4;
    const colors = [0x884433, 0x774422, 0x665544, 0x776655, 0x885544];
    const bldg = makeBox(w, h, d, colors[Math.floor(Math.random() * colors.length)], x, 0, z);
    group.add(bldg);
    addCollider(colliders, bldg);
    const facing = x > 0 ? -1 : 1;
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
        win.position.set(x + facing * (w/2 + 0.01), y, z + wx);
        win.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2;
        group.add(win);
      }
    }
    // Window sills
    for (let y = 2; y < h; y += 3.5) {
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, w * 0.8),
        makeMaterial(0x666655));
      sill.position.set(x + facing * (w/2 + 0.05), y - 0.05, z);
      group.add(sill);
    }
    // Fire escape (on every other building)
    if (Math.random() > 0.4 && stories >= 2) {
      const feX = x + facing * (w/2 + 0.8);
      for (let fy = 3.5; fy < h; fy += 3.5) {
        // Platform
        const fePlatform = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 2), makeMaterial(0x333333));
        fePlatform.position.set(feX, fy, z);
        group.add(fePlatform);
        // Railing
        const feRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.8, 2), makeMaterial(0x333333));
        feRail.position.set(feX + facing * 0.73, fy + 0.4, z);
        group.add(feRail);
        const feRailFront = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.04), makeMaterial(0x333333));
        feRailFront.position.set(feX, fy + 0.8, z - 1);
        group.add(feRailFront);
        // Ladder between floors
        if (fy > 3.5) {
          const feLadder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.5, 0.04), makeMaterial(0x333333));
          feLadder.position.set(feX + facing * 0.3, fy - 1.75, z + 0.5);
          group.add(feLadder);
          // Ladder rungs
          for (let rl = 0; rl < 5; rl++) {
            const rung = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.03), makeMaterial(0x444444));
            rung.position.set(feX + facing * 0.3, fy - 3 + rl * 0.7, z + 0.5);
            group.add(rung);
          }
        }
      }
      // Drop ladder to ground (retracted)
      const dropLadder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2, 0.04), makeMaterial(0x333333));
      dropLadder.position.set(feX + facing * 0.3, 2.5, z + 0.5);
      group.add(dropLadder);
    }
    // Stoop/stairs with railing
    const stoopX = x + (x > 0 ? -w/2 - 0.5 : w/2 + 0.5);
    const stoop = makeBox(2, 0.8, 1.5, 0x777777, stoopX, 0, z);
    group.add(stoop);
    for (const side of [-0.9, 0.9]) {
      const stoopRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1, 0.04), makeMaterial(0x333333));
      stoopRail.position.set(stoopX + side, 1.3, z - 0.7);
      group.add(stoopRail);
    }
    // Roof cornice
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.2, d + 0.3), makeMaterial(0x555544));
    cornice.position.set(x, h + 0.1, z);
    group.add(cornice);
  }

  // Houses along both sides
  for (let z = -70; z < 70; z += 14) {
    makeResidential(-18 - Math.random() * 5, z + Math.random() * 4, 2 + Math.floor(Math.random() * 2));
    makeResidential(18 + Math.random() * 5, z + Math.random() * 4, 2 + Math.floor(Math.random() * 2));
  }

  // === Storefronts along one side - enhanced ===
  const storeNames = [0x2244aa, 0xaa2244, 0x22aa44, 0xaa8822, 0x4422aa, 0x228888];
  for (let si = 0; si < 7; si++) {
    const z = -30 + si * 10;
    const store = makeBox(5, 4, 6, 0x776655, -12, 0, z);
    group.add(store);
    addCollider(colliders, store);
    // Awning
    const awningColor = [0xcc3333, 0x33cc33, 0x3333cc, 0xcccc33, 0xcc6633, 0x33cccc, 0x9933cc];
    const awning = makeBox(5.5, 0.1, 2, awningColor[si], -12, 3.5, z - 3.5);
    group.add(awning);
    // Awning valance
    const valance = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 0.3),
      new THREE.MeshBasicMaterial({ color: awningColor[si], transparent: true, opacity: 0.8 }));
    valance.position.set(-12, 3.3, z - 4.5);
    group.add(valance);
    // Storefront window
    const sfWindow = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.5),
      new THREE.MeshPhongMaterial({ color: 0x334466, transparent: true, opacity: 0.4, shininess: 100 }));
    sfWindow.position.set(-9.49, 2, z);
    sfWindow.rotation.y = Math.PI / 2;
    group.add(sfWindow);
    // Store sign
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 3),
      new THREE.MeshBasicMaterial({ color: storeNames[si % storeNames.length] }));
    signBoard.position.set(-9.4, 3.8, z);
    group.add(signBoard);
    // Store light
    const storeLight = new THREE.PointLight(0xffaa44, 0.5, 8);
    storeLight.position.set(-12, 3, z - 4);
    group.add(storeLight);
    // Door
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.5), makeMaterial(0x443322));
    door.position.set(-9.49, 1.5, z - 2);
    door.rotation.y = Math.PI / 2;
    group.add(door);
  }

  // === Water Tower - enhanced ===
  const towerBase = makeBox(2, 12, 2, 0x777777, 35, 0, -20);
  group.add(towerBase);
  addCollider(colliders, towerBase);
  // Cross bracing on tower
  for (let ty = 2; ty < 10; ty += 4) {
    const brace1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4, 0.06), makeMaterial(0x666666));
    brace1.position.set(35 - 0.8, ty + 2, -20);
    brace1.rotation.z = 0.4;
    group.add(brace1);
    const brace2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4, 0.06), makeMaterial(0x666666));
    brace2.position.set(35 + 0.8, ty + 2, -20);
    brace2.rotation.z = -0.4;
    group.add(brace2);
  }
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 4, 12),
    makeMaterial(0x666666)
  );
  tank.position.set(35, 14, -20);
  group.add(tank);
  // Tank bands
  for (const by of [12.5, 14, 15.5]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.04, 4, 12),
      makeMaterial(0x555555));
    band.rotation.x = Math.PI / 2;
    band.position.set(35, by, -20);
    group.add(band);
  }
  const tankRoof = new THREE.Mesh(
    new THREE.ConeGeometry(3, 2, 12),
    makeMaterial(0x555555)
  );
  tankRoof.position.set(35, 17, -20);
  group.add(tankRoof);

  // === Church / community building ===
  const church = makeBox(8, 10, 12, 0x887766, -35, 0, -40);
  group.add(church);
  addCollider(colliders, church);
  // Steeple
  const steeple = makeBox(3, 6, 3, 0x887766, -35, 10, -40);
  group.add(steeple);
  const steepleRoof = new THREE.Mesh(
    new THREE.ConeGeometry(2.5, 5, 4),
    makeMaterial(0x555555)
  );
  steepleRoof.position.set(-35, 18.5, -40);
  steepleRoof.rotation.y = Math.PI / 4;
  group.add(steepleRoof);
  // Cross on top
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), makeMaterial(0xddddcc));
  crossV.position.set(-35, 21.8, -40);
  group.add(crossV);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.1), makeMaterial(0xddddcc));
  crossH.position.set(-35, 22.2, -40);
  group.add(crossH);
  // Church windows (arched - approximated)
  for (let cz = -45; cz <= -35; cz += 3) {
    const cWin = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.5),
      new THREE.MeshBasicMaterial({ color: 0xddaa44, transparent: true, opacity: 0.5 }));
    cWin.position.set(-31, 5, cz);
    cWin.rotation.y = -Math.PI / 2;
    group.add(cWin);
  }
  // Church entrance
  const churchDoor = new THREE.Mesh(new THREE.PlaneGeometry(2, 3.5), makeMaterial(0x553322));
  churchDoor.position.set(-35, 2, -33.9);
  group.add(churchDoor);

  // === Utility poles along east road ===
  for (let z = -60; z < 60; z += 20) {
    group.add(makeUtilityPole(12, z));
  }

  // === Dumpsters in alleys ===
  group.add(makeDumpster(-15, -55, Math.PI / 2));
  group.add(makeDumpster(15, 25, -Math.PI / 2));
  group.add(makeDumpster(-15, 40, Math.PI / 2));

  // === Chain link fence sections (around a vacant lot) ===
  const fenceMat = new THREE.MeshPhongMaterial({ color: 0x888888, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
  const fencePost = makeMaterial(0x555555);
  // Vacant lot at east side
  for (let fz = 55; fz < 75; fz += 3) {
    const fencePanel = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), fenceMat);
    fencePanel.position.set(14, 1, fz);
    fencePanel.rotation.y = Math.PI / 2;
    group.add(fencePanel);
    const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4), fencePost);
    fp.position.set(14, 1.1, fz - 1.5);
    group.add(fp);
  }

  // === Tree-lined streets ===
  for (let z = -70; z < 70; z += 10) {
    group.add(makeTree(-10, z, 0.7 + Math.random() * 0.4));
    group.add(makeTree(10, z, 0.7 + Math.random() * 0.4));
  }
  // Some backyard trees
  for (let i = 0; i < 12; i++) {
    const tx = (Math.random() > 0.5 ? -1 : 1) * (25 + Math.random() * 15);
    const tz = (Math.random() - 0.5) * 140;
    group.add(makeTree(tx, tz, 0.6 + Math.random() * 0.5));
  }

  // === Sidewalks with curbs ===
  const sidewalkMat = makeMaterial(0x888888);
  const curbMat = makeMaterial(0x999999);
  for (const sx of [-8, 8]) {
    const sw = new THREE.Mesh(new THREE.PlaneGeometry(3, 170), sidewalkMat);
    sw.rotation.x = -Math.PI / 2;
    sw.position.set(sx, 0.015, 0);
    group.add(sw);
    // Curbs
    const innerCurb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 170), curbMat);
    innerCurb.position.set(sx + (sx > 0 ? -1.5 : 1.5), 0.06, 0);
    group.add(innerCurb);
  }

  // === Roads ===
  const road = new THREE.Mesh(new THREE.PlaneGeometry(6, 170), makeMaterial(0x1a1a1a));
  road.rotation.x = -Math.PI / 2;
  road.position.set(-5, 0.01, 0);
  group.add(road);
  const road2 = new THREE.Mesh(new THREE.PlaneGeometry(6, 170), makeMaterial(0x1a1a1a));
  road2.rotation.x = -Math.PI / 2;
  road2.position.set(5, 0.01, 0);
  group.add(road2);
  // Road markings
  for (const rx of [-5, 5]) {
    for (let rz = -80; rz < 80; rz += 6) {
      const centerLine = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 3),
        new THREE.MeshBasicMaterial({ color: 0xffff00 }));
      centerLine.rotation.x = -Math.PI / 2;
      centerLine.position.set(rx, 0.02, rz);
      group.add(centerLine);
    }
  }

  // Street lights
  for (let z = -60; z < 60; z += 15) {
    group.add(makeStreetLight(-7, z));
    group.add(makeStreetLight(7, z));
  }

  // Trash cans and fire hydrants
  for (let z = -50; z < 50; z += 25) {
    group.add(makeTrashCan(-9, z));
    group.add(makeFireHydrant(9, z + 10));
  }

  // Parked cars with detail
  const carColors = [0xcc0000, 0x333333, 0x0044aa, 0xeeeeee, 0x444400, 0x666666, 0x882222];
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? -7.5 : 7.5;
    const car = makeCar(
      side, -55 + i * 16,
      carColors[Math.floor(Math.random() * carColors.length)],
      0
    );
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
