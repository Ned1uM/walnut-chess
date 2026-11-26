function sample(x, y, seed) {
  let n = Math.imul(x + seed * 37, 0x45d9f3b) ^ Math.imul(y + seed * 71, 0x119de1f3);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let u = x - xi;
  let v = y - yi;
  u *= u * (3 - 2 * u);
  v *= v * (3 - 2 * v);
  const a = sample(xi, yi, seed);
  const b = sample(xi + 1, yi, seed);
  const c = sample(xi, yi + 1, seed);
  const d = sample(xi + 1, yi + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

export function woodPixels(width, height, color, seed, strength = 1, vertical = false) {
  const data = new Uint8ClampedArray(width * height * 4);
  const bend = (seed % 13) * .41;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const x = vertical ? row / height : column / width;
      const y = vertical ? column / width : row / height;
      const wave = y + .017 * Math.sin(x * 7 + bend) + .045 * noise(x * 3, y * 6, seed + 43);
      const current = noise(x * 2, wave * 14, seed) - .5;
      const growth = noise(x * 2.7, wave * 57, seed + 77) - .5;
      const fibers = noise(x * 6, wave * 175, seed + 3) - .5;
      const pore = sample(column, row, seed + 91) - .5;
      const light = strength * (.155 * current + .21 * growth + .1 * fibers + .052 * pore);
      const offset = (row * width + column) * 4;
      data[offset] = color[0] * (1 + light);
      data[offset + 1] = color[1] * (1 + 1.12 * light);
      data[offset + 2] = color[2] * (1 + 1.24 * light);
      data[offset + 3] = 255;
    }
  }
  return data;
}
