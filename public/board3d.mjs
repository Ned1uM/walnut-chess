import * as T from './vendor/three.module.min.js';
import { createMaterials, createPiece } from './models.mjs';
import { woodPixels } from './wood.mjs';

const files = 'abcdefgh';
const types = 'pnbrqk';
const boardSize = 8.94;

function positionOf(square, flipped) {
  const sign = flipped ? -1 : 1;
  return new T.Vector3((files.indexOf(square[0]) - 3.5) * sign, 0, (4.5 - Number(square[1])) * sign);
}

function woodCanvas(width, height, color, seed, strength, vertical) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(woodPixels(width, height, color, seed, strength, vertical), width, height), 0, 0);
  return canvas;
}

function canvasMap(canvas, renderer) {
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function plankTop(renderer) {
  const cell = 128;
  const padding = 60;
  const edge = cell * 8 + padding * 2;
  const board = woodCanvas(edge, edge, [105, 66, 42], 12, 1.33);
  const ctx = board.getContext('2d');
  const strip = woodCanvas(padding, edge, [100, 64, 42], 37, 1.38, true);
  const front = woodCanvas(edge, padding, [116, 75, 46], 28, 1.24);
  ctx.drawImage(strip, 0, 0);
  ctx.drawImage(strip, edge - padding, 0);
  ctx.drawImage(front, 0, 0);
  ctx.drawImage(front, 0, edge - padding);
  ctx.fillStyle = '#563820';
  ctx.fillRect(padding - 7, padding - 7, cell * 8 + 14, cell * 8 + 14);
  ctx.strokeStyle = '#c69d60';
  ctx.lineWidth = 2.3;
  ctx.strokeRect(padding - 6, padding - 6, cell * 8 + 12, cell * 8 + 12);
  ctx.strokeStyle = '#b28553aa';
  ctx.strokeRect(12, 12, edge - 24, edge - 24);

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const seed = row * 8 + col + 200;
      const shifting = Math.sin(seed * 2.1) * 4;
      const oak = (row + col) % 2 ? [126, 82, 52] : [216, 181, 128];
      const color = oak.map(component => component + shifting);
      const square = woodCanvas(cell, cell, color, seed, (row + col) % 2 ? 1.18 : .65, col % 3 === 2);
      ctx.drawImage(square, padding + col * cell, padding + row * cell);
      ctx.strokeStyle = '#3f2b2040';
      ctx.lineWidth = .85;
      ctx.strokeRect(padding + col * cell + .5, padding + row * cell + .5, cell - 1, cell - 1);
    }
  }
  return canvasMap(board, renderer);
}

function makeCoordinates(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const texture = canvasMap(canvas, renderer);
  const mesh = new T.Mesh(new T.PlaneGeometry(boardSize, boardSize), new T.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, toneMapped: false,
  }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = .006;
  mesh.renderOrder = 1;

  function draw(flipped) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '600 23px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4d9a3';
    ctx.shadowColor = '#322014cc';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 1.4;
    for (let index = 0; index < 8; index += 1) {
      const center = 512 + (index - 3.5) * 1024 / boardSize;
      ctx.fillText(files[flipped ? 7 - index : index], center, 997);
      ctx.fillText(String(flipped ? index + 1 : 8 - index), 28, center);
    }
    texture.needsUpdate = true;
  }
  return { mesh, draw };
}

function flatMesh(geometry, material, y = 0) {
  const mesh = new T.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

function layeredBox(size, height, top, side) {
  return new T.Mesh(new T.BoxGeometry(size, height, size), [side, side, top, side, side, side]);
}

function makeTable(renderer, scene) {
  const top = new T.MeshStandardMaterial({ map: plankTop(renderer), roughness: .61, metalness: .015 });
  const side = new T.MeshStandardMaterial({
    map: canvasMap(woodCanvas(512, 96, [91, 54, 36], 88, 1.4), renderer), roughness: .5,
  });
  const trim = new T.MeshStandardMaterial({ color: '#ab7949', roughness: .5, metalness: .20 });
  const base = layeredBox(boardSize, .18, top, side);
  base.position.y = -.09;
  base.castShadow = true;
  base.receiveShadow = true;
  scene.add(base);

  for (const [size, height, y, material] of [
    [9.02, .06, -.208, trim], [8.94, .17, -.315, side], [9.01, .078, -.421, side],
  ]) {
    const layer = layeredBox(size, height, material, material);
    layer.position.y = y;
    layer.receiveShadow = true;
    layer.castShadow = true;
    scene.add(layer);
  }

  const ground = flatMesh(new T.PlaneGeometry(40, 40), new T.ShadowMaterial({ opacity: .28 }), -.49);
  ground.receiveShadow = true;
  scene.add(ground);

  const shade = document.createElement('canvas');
  shade.width = 128;
  shade.height = 128;
  const ctx = shade.getContext('2d');
  ctx.filter = 'blur(6px)';
  ctx.fillStyle = '#06100ccc';
  ctx.fillRect(12, 12, 104, 104);
  const softShadow = flatMesh(new T.PlaneGeometry(10.8, 10.65), new T.MeshBasicMaterial({
    map: canvasMap(shade, renderer), transparent: true, depthWrite: false, opacity: .85, toneMapped: false,
  }), -.481);
  softShadow.position.set(.23, -.481, .36);
  scene.add(softShadow);
}

function makeLights(scene) {
  scene.add(new T.HemisphereLight('#fff0d9', '#536b5a', 2.07));
  const key = new T.DirectionalLight('#fff1da', 2.17);
  key.position.set(-4.5, 10, 4.1);
  key.castShadow = true;
  key.shadow.mapSize.set(1536, 1536);
  Object.assign(key.shadow.camera, { left: -7.25, right: 7.25, top: 7.25, bottom: -7.25, near: .5, far: 26 });
  key.shadow.normalBias = .032;
  key.shadow.bias = -.00022;
  key.shadow.intensity = .64;
  scene.add(key);

  const rim = new T.DirectionalLight('#cbdccc', 1.37);
  rim.position.set(2, 5, -6);
  scene.add(rim);
  const fill = new T.DirectionalLight('#ffe3c5', .43);
  fill.position.set(6, 3, 6);
  scene.add(fill);
}

const tiles = new T.PlaneGeometry(.985, .985);
const disk = new T.CircleGeometry(.115, 32);
const ring = new T.RingGeometry(.389, .434, 48);
const markerMaterials = {};
for (const [label, color, opacity] of [
  ['last', '#ffd47c', .37], ['selected', '#fcdc82', .47], ['stroke', '#ffe08f', .95],
  ['dot', '#254b3c', .72], ['capture', '#bddba6', .93], ['check', '#c23a28', .56],
  ['hint', '#92ca82', .55], ['hintStroke', '#c5eda6', .98], ['focus', '#fff0c8', .96],
  ['drop', '#d7ef9f', .65], ['protected', '#a8dbeb', .98],
]) {
  markerMaterials[label] = new T.MeshBasicMaterial({ color, transparent: true, opacity, toneMapped: false, depthWrite: false });
}

const borderLong = new T.PlaneGeometry(.975, .052);
const borderShort = new T.PlaneGeometry(.052, .891);

function contactTexture(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 9, 32, 32, 31);
  gradient.addColorStop(0, '#20160dbd');
  gradient.addColorStop(.55, '#24190e66');
  gradient.addColorStop(1, '#24190e00');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new T.MeshBasicMaterial({ map: canvasMap(canvas, renderer), transparent: true, depthWrite: false, toneMapped: false });
}

export class Board3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'default' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(35, 1, .1, 80);
    this.coordinates = makeCoordinates(this.renderer);
    this.pieces = new T.Group();
    this.marks = new T.Group();
    this.scene.add(this.coordinates.mesh, this.pieces, this.marks);
    makeLights(this.scene);
    makeTable(this.renderer, this.scene);

    this.contact = contactTexture(this.renderer);
    this.templates = {};
    for (const side of ['w', 'b']) {
      const materials = createMaterials(side);
      for (const type of types) this.templates[side + type] = createPiece(type, side, materials);
    }

    this.active = new Map();
    this.animations = [];
    this.held = null;
    this.flipped = null;
    this.frame = 0;
    this.needsDraw = true;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.ray = new T.Raycaster();
    this.boardPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    const camera = this.camera;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    const inclination = width < 540 ? .86 : .80;
    const direction = new T.Vector3(0, Math.sin(inclination), Math.cos(inclination));
    const target = new T.Vector3(0, .28, 0);
    const outline = [];
    for (const x of [-4.53, 4.53]) {
      for (const z of [-4.53, 4.53]) outline.push(new T.Vector3(x, -.46, z));
    }
    for (const x of [-3.9, 3.9]) outline.push(new T.Vector3(x, 1.38, -3.75));

    let distance = 17.6;
    for (let pass = 0; pass < 6; pass += 1) {
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      const extrema = outline.map(point => point.clone().project(camera));
      const horizontal = Math.max(...extrema.map(point => Math.abs(point.x)));
      const upper = Math.max(...extrema.map(point => point.y));
      const lower = Math.min(...extrema.map(point => point.y));
      const vertical = (upper - lower) / 2;
      distance *= Math.max(horizontal / .915, vertical / .855) ** .73;
      target.y += (upper + lower) * .5 * distance * .24;
    }
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    this.invalidate();
  }

  invalidate() {
    this.needsDraw = true;
    if (!this.frame && !this.canvas.hidden) this.frame = requestAnimationFrame(time => this.draw(time));
  }

  draw(time) {
    this.frame = 0;
    if (this.canvas.hidden || !this.width) return;
    const moving = this.animations.length > 0;
    this.animations = this.animations.filter(({ model, start, end, lift, since, duration }) => {
      const progress = Math.min(1, Math.max(0, (time - since) / duration));
      const eased = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
      model.position.lerpVectors(start, end, eased);
      model.position.y += Math.sin(progress * Math.PI) * lift;
      this.placeShadow(model);
      return progress < 1;
    });
    if (moving || this.needsDraw) this.renderer.render(this.scene, this.camera);
    this.needsDraw = false;
    if (this.animations.length) this.frame = requestAnimationFrame(next => this.draw(next));
  }

  placeShadow(model) {
    model.userData.shade.position.set(model.position.x, .012, model.position.z);
  }

  slide(model, end, duration, lift = 0) {
    this.animations = this.animations.filter(animation => animation.model !== model);
    if (duration && model.position.distanceToSquared(end) > .0001) {
      this.animations.push({ model, start: model.position.clone(), end, lift, since: performance.now(), duration });
    } else {
      model.position.copy(end);
    }
    this.placeShadow(model);
    this.invalidate();
  }

  setBoard(pieces, flipped, move = null, duration = 0) {
    const old = this.active;
    const next = new Map();
    const used = new Set();
    this.animations = [];
    this.held = null;
    const flipChanged = flipped !== this.flipped;
    if (flipChanged) {
      this.flipped = flipped;
      this.coordinates.draw(flipped);
    }
    let rook = null;
    if (move && /[kq]/.test(move.flags)) {
      const kingside = move.flags.includes('k');
      rook = { from: (kingside ? 'h' : 'a') + move.from[1], to: (kingside ? 'f' : 'd') + move.from[1] };
    }
    for (const piece of pieces) {
      const id = piece.color + piece.type;
      const relay = piece.square === move?.to ? move : piece.square === rook?.to ? rook : null;
      const earlier = old.get(relay?.from ?? piece.square);
      const same = earlier?.userData.id === id;
      const model = same ? earlier : this.templates[id].clone(true);
      used.add(model);
      next.set(piece.square, model);
      model.userData.id = id;
      model.userData.square = piece.square;
      model.rotation.y = piece.type === 'n' ? (piece.color === 'w' ? -.13 : .30) : 0;
      const end = positionOf(piece.square, flipped);
      const start = same ? model.position.clone() : relay ? positionOf(relay.from, flipped) : end;
      if (!same) {
        const shade = flatMesh(new T.PlaneGeometry(1, 1), this.contact, .012);
        shade.renderOrder = 4;
        model.userData.shade = shade;
        this.pieces.add(shade, model);
      }
      model.position.copy(start);
      const lift = duration >= 300 ? (piece.type === 'n' ? .27 : .063) : 0;
      this.slide(model, end, flipChanged ? 0 : duration, lift);
    }
    for (const model of old.values()) {
      if (used.has(model)) continue;
      const shade = model.userData.shade;
      this.pieces.remove(shade, model);
      shade.geometry.dispose();
    }
    this.active = next;
    this.invalidate();
  }

  setMarkers({ last, selected, legal, check, hint, focus, dropTarget, protectedSquare }) {
    this.marks.clear();
    const add = (square, geometry, label, y, order, dx = 0, dz = 0) => {
      const point = positionOf(square, this.flipped);
      const mesh = flatMesh(geometry, markerMaterials[label], y);
      mesh.position.x = point.x + dx;
      mesh.position.z = point.z + dz;
      mesh.renderOrder = order;
      this.marks.add(mesh);
    };
    const outline = (square, label) => {
      for (const sign of [-1, 1]) {
        add(square, borderLong, label, .015, 5, 0, sign * .458);
        add(square, borderShort, label, .015, 5, sign * .458, 0);
      }
    };
    if (last) for (const square of [last.from, last.to]) add(square, tiles, 'last', .009, 2);
    if (check) add(check, tiles, 'check', .010, 3);
    if (selected) {
      add(selected, tiles, 'selected', .011, 3);
      outline(selected, 'stroke');
    }
    if (hint) {
      for (const square of [hint.from, hint.to]) {
        add(square, tiles, 'hint', .013, 3);
        outline(square, 'hintStroke');
      }
    }
    for (const square of legal) {
      const occupied = this.active.has(square);
      add(square, occupied ? ring : disk, occupied ? 'capture' : 'dot', .018, 6);
    }
    if (protectedSquare) outline(protectedSquare, 'protected');
    if (dropTarget) {
      add(dropTarget, tiles, 'drop', .019, 5);
      outline(dropTarget, 'hintStroke');
    }
    if (focus) outline(focus, 'focus');
    this.invalidate();
  }

  pointRay(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    this.ray.setFromCamera(new T.Vector2(2 * x - 1, 1 - 2 * y), this.camera);
    return x >= 0 && x <= 1 && y >= 0 && y <= 1;
  }

  squareOnBoard() {
    const spot = this.ray.ray.intersectPlane(this.boardPlane, new T.Vector3());
    if (spot && Math.abs(spot.x) < 4 && Math.abs(spot.z) < 4) {
      const sign = this.flipped ? -1 : 1;
      return files[Math.floor(spot.x * sign + 4)] + (8 - Math.floor(spot.z * sign + 4));
    }
    return null;
  }

  squareOnPiece(ignored = null) {
    const models = [...this.active.values()].filter(model => model !== ignored);
    this.pieces.updateMatrixWorld(true);
    let object = this.ray.intersectObjects(models, true)[0]?.object;
    while (object && !object.userData.square) object = object.parent;
    return object?.userData.square;
  }

  pick(clientX, clientY) {
    if (!this.pointRay(clientX, clientY)) return {};
    return { tile: this.squareOnBoard(), piece: this.squareOnPiece() };
  }

  hold(square, clientX, clientY) {
    const model = this.active.get(square);
    if (!model || !this.pointRay(clientX, clientY)) return false;
    const plane = new T.Plane(new T.Vector3(0, 1, 0), -.48);
    const grip = this.ray.ray.intersectPlane(plane, new T.Vector3());
    if (!grip) return false;
    const lift = .24;
    this.animations = this.animations.filter(animation => animation.model !== model);
    this.held = { model, plane, offset: model.position.clone().sub(grip), home: positionOf(square, this.flipped), lift };
    model.position.y = lift;
    this.invalidate();
    return true;
  }

  drag(clientX, clientY, destinations) {
    if (!this.held) return null;
    const { model, plane, offset, lift } = this.held;
    const inside = this.pointRay(clientX, clientY);
    const grip = this.ray.ray.intersectPlane(plane, new T.Vector3());
    if (grip) {
      grip.add(offset);
      model.position.set(T.MathUtils.clamp(grip.x, -5, 5), lift, T.MathUtils.clamp(grip.z, -5, 5));
      this.placeShadow(model);
      this.invalidate();
    }
    if (!inside) return null;
    const tile = this.squareOnBoard();
    if (destinations.has(tile)) return tile;
    if (![...destinations].some(square => this.active.has(square))) return null;
    const piece = this.squareOnPiece(model);
    return destinations.has(piece) ? piece : null;
  }

  release(commit, duration) {
    if (!this.held) return;
    const { model, home } = this.held;
    this.held = null;
    if (!commit) this.slide(model, home, duration);
  }
}
