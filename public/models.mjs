import * as T from './vendor/three.module.min.js';

const around = 40;
const sphere = new T.SphereGeometry(1, 24, 16);

function foot(radius) {
  return [
    [0, 0], [.79, 0], [.92, .014], [.99, .035], [1, .067],
    [.97, .099], [.91, .119], [.88, .123], [.88, .152],
    [.85, .172], [.72, .204], [.66, .227], [.65, .253],
  ].map(([r, y]) => [r * radius, y]);
}

function turned(points, sides = around, solid = true) {
  const curve = new T.SplineCurve(points.map(([r, y]) => new T.Vector2(r, y)));
  const profile = curve.getPoints(points.length * 3);
  profile.forEach((point, index) => {
    point.x = Math.max(0, point.x);
    if (solid && index) point.y = Math.max(profile[index - 1].y, point.y);
  });
  return new T.LatheGeometry(profile, sides);
}

function relief(shape, thickness, bevel) {
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true, bevelThickness: bevel,
    bevelSize: bevel, bevelSegments: 3, curveSegments: 14,
  }).translate(0, 0, -thickness / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function oval(group, material, position, shape) {
  const mesh = new T.Mesh(sphere, material);
  mesh.position.set(...position);
  mesh.scale.set(...shape);
  group.add(mesh);
}

function horseHead() {
  const shape = new T.Shape();
  shape.moveTo(-.221, .30);
  shape.bezierCurveTo(-.212, .45, -.185, .53, -.105, .61);
  shape.bezierCurveTo(-.092, .664, -.058, .711, -.048, .739);
  shape.bezierCurveTo(-.122, .719, -.215, .677, -.282, .688);
  shape.bezierCurveTo(-.324, .72, -.31, .768, -.276, .81);
  shape.lineTo(-.157, .951);
  shape.bezierCurveTo(-.128, .981, -.098, 1.006, -.063, 1.016);
  shape.lineTo(-.04, 1.115);
  shape.quadraticCurveTo(.005, 1.095, .067, 1.035);
  shape.quadraticCurveTo(.094, 1.071, .126, 1.088);
  shape.lineTo(.145, 1.001);
  shape.bezierCurveTo(.302, .939, .336, .683, .288, .508);
  shape.bezierCurveTo(.267, .42, .232, .337, .224, .30);
  shape.closePath();
  return relief(shape, .22, .04);
}

function crenellation(start) {
  const inner = .126;
  const outer = .238;
  const end = start + .57;
  const shape = new T.Shape();
  shape.moveTo(outer * Math.cos(start), outer * Math.sin(start));
  shape.absarc(0, 0, outer, start, end, false);
  shape.lineTo(inner * Math.cos(end), inner * Math.sin(end));
  shape.absarc(0, 0, inner, end, start, true);
  shape.closePath();
  return new T.ExtrudeGeometry(shape, {
    depth: .111, bevelEnabled: true, bevelThickness: .009,
    bevelSize: .009, bevelSegments: 2, curveSegments: 4,
  }).rotateX(-Math.PI / 2).translate(0, .853, 0);
}

function bishopMitre() {
  const geometry = turned([
    [0, .858], [.12, .86], [.16, .91], [.148, .982],
    [.105, 1.068], [.049, 1.146], [.024, 1.169], [0, 1.176],
  ], 64);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const incline = Math.abs(y - (1.025 + x * .66));
    const nearFace = T.MathUtils.smoothstep(z, -.025, .056);
    const notch = (1 - T.MathUtils.smoothstep(incline, .012, .047)) * nearFace;
    positions.setXYZ(index, x, y, z - .07 * notch);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function queenCrown() {
  // Build the inward profile with an actual open cup and a scalloped rim.
  const crown = turned([
    [0, 1.01], [.14, 1.012], [.169, 1.052], [.186, 1.12], [.215, 1.192],
    [.205, 1.218], [.174, 1.218], [.153, 1.153], [.108, 1.11], [0, 1.10],
  ], 84, false);
  const positions = crown.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const wave = (1 - Math.cos(Math.atan2(x, z) * 7)) * .5;
    const cut = T.MathUtils.smoothstep(y, 1.106, 1.216) * .105 * wave ** .63;
    positions.setY(index, y - cut);
  }
  crown.computeVertexNormals();
  return crown;
}

function kingCross() {
  const shape = new T.Shape();
  const points = [
    [-.041, 1.133], [.041, 1.133], [.041, 1.238], [.124, 1.238],
    [.124, 1.307], [.041, 1.307], [.041, 1.401], [-.041, 1.401],
    [-.041, 1.307], [-.124, 1.307], [-.124, 1.238], [-.041, 1.238],
  ];
  shape.moveTo(...points[0]);
  points.slice(1).forEach(point => shape.lineTo(...point));
  shape.closePath();
  return relief(shape, .073, .013);
}

export const piecePalettes = {
  w: { body: '#e9cda0', detail: '#ab784a', felt: '#494936' },
  b: { body: '#3d2a22', detail: '#251c18', felt: '#1a221c' },
};

const parts = {
  p: [turned([
    ...foot(.272), [.143, .279], [.104, .345], [.084, .413], [.094, .499],
    [.132, .533], [.142, .557], [.129, .580], [.082, .592], [0, .592],
  ])],
  n: [turned([
    ...foot(.333), [.205, .284], [.222, .305], [.230, .332], [.215, .361],
    [.173, .375], [0, .376],
  ]), horseHead()],
  b: [turned([
    ...foot(.314), [.176, .286], [.13, .347], [.093, .469], [.087, .595],
    [.115, .678], [.147, .699], [.156, .722], [.136, .749], [.102, .765],
    [.107, .79], [.126, .818], [.132, .852], [.106, .872], [0, .879],
  ]), bishopMitre()],
  r: [turned([
    ...foot(.325), [.188, .277], [.166, .342], [.155, .501], [.169, .669],
    [.2, .709], [.225, .733], [.23, .776], [.213, .799], [.223, .813],
    [.237, .831], [.239, .855], [.215, .879], [.125, .88], [.122, .825], [0, .825],
  ], around, false),
  ...Array.from({ length: 6 }, (_, index) => crenellation(index * Math.PI / 3 + .15))],
  q: [turned([
    ...foot(.351), [.202, .284], [.157, .346], [.122, .456], [.102, .564],
    [.105, .685], [.133, .759], [.176, .778], [.185, .802], [.169, .834],
    [.124, .857], [.122, .885], [.156, .93], [.174, .96], [.16, .991],
    [.133, 1.017], [.091, 1.055], [0, 1.061],
  ]), queenCrown()],
  k: [turned([
    ...foot(.368), [.210, .288], [.166, .352], [.126, .47], [.116, .586],
    [.12, .719], [.159, .799], [.191, .825], [.197, .853], [.179, .883],
    [.133, .905], [.121, .938], [.154, .987], [.175, 1.025], [.166, 1.065],
    [.131, 1.097], [.106, 1.118], [.109, 1.15], [.09, 1.172], [0, 1.176],
  ]), kingCross()],
};

export function createMaterials(side) {
  const palette = piecePalettes[side];
  return {
    body: new T.MeshStandardMaterial({ color: palette.body, roughness: .34, metalness: .035 }),
    detail: new T.MeshStandardMaterial({ color: palette.detail, roughness: .46 }),
    felt: new T.MeshStandardMaterial({ color: palette.felt, roughness: .96 }),
  };
}

const sole = new T.CylinderGeometry(1, 1, .026, 36);
const sizes = { p: .252, n: .313, b: .294, r: .305, q: .331, k: .348 };

export function createPiece(type, side, materials = createMaterials(side)) {
  const group = new T.Group();
  group.add(...parts[type].map(geometry => new T.Mesh(geometry, materials.body)));
  const base = new T.Mesh(sole, materials.felt);
  base.scale.set(sizes[type], 1, sizes[type]);
  base.position.y = .006;
  group.add(base);

  if (type === 'p') oval(group, materials.body, [0, .696, 0], [.156, .163, .156]);
  if (type === 'b') oval(group, materials.body, [0, 1.171, 0], [.048, .05, .048]);
  if (type === 'q') oval(group, materials.body, [0, 1.204, 0], [.078, .105, .078]);
  if (type === 'n') {
    for (const sign of [-1, 1]) {
      oval(group, materials.body, [.076, .81, sign * .104], [.152, .133, .043]);
      oval(group, materials.detail, [-.11, .909, sign * .130], [.021, .016, .011]);
      oval(group, materials.detail, [-.268, .757, sign * .109], [.012, .016, .01]);
    }
  }
  if (type === 'r') {
    const well = new T.Mesh(new T.CircleGeometry(.128, 36), materials.detail);
    well.rotation.x = -Math.PI / 2;
    well.position.y = .846;
    group.add(well);
  }
  group.traverse(node => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  return group;
}
