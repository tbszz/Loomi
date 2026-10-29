const clamp = value => Math.max(0, Math.min(1, value));
const lerp = (from, to, progress) => from + (to - from) * progress;
const smoothstep = value => { const p = clamp(value); return p * p * (3 - 2 * p); };

// v runs from the physical top (0) to bottom (1); t is the close timeline.
// Sampling boundaries, rather than band centres, gives neighbours identical edges.
export function genieEdge(W, T, v, t, mirrored = false) {
  const position = clamp(v);
  if (t <= 0) return { left: W.left, right: W.left + W.width, y: W.top + position * W.height };
  if (t >= 1) return { left: T.x, right: T.x, y: T.y };
  const p = smoothstep(t / .4);
  const q = smoothstep((t - .4) / .6);
  const distance = mirrored ? W.top + W.height - T.y : T.y - W.top;
  // A row may lie inside the window. Use an extended funnel and continuously
  // contract its path during sucking so Phase B still starts at the original band.
  const path = Math.max(W.height, distance);
  const pathY = Math.min(path, (mirrored ? 1 - position : position) * W.height + q * path);
  const effectiveV = pathY / W.height;
  const funnel = smoothstep(effectiveV) ** 1.6;
  const squeeze = p * funnel;
  const contraction = lerp(1, distance / path, q);
  const tail = W.height * .25;
  const u = clamp((pathY - (path - tail)) / tail);
  const compress = smoothstep(q / .15);
  // Integrate the height scale along the last quarter of the funnel. Moving
  // centres by uncompressed h while scaling their heights would leave gaps.
  // .5002 is the integral of max(.02, 1 - u) over the unit interval.
  const remaining = pathY < path - tail
    ? path - tail - pathY + tail * .5002
    : u < .98 ? tail * (.5002 - u + u * u / 2) : (path - pathY) * .02;
  const y = lerp(pathY, path - remaining, compress) * contraction;
  const centre = lerp(W.left + W.width / 2, T.x, squeeze);
  // Taper the tip to a point continuously, including when an edge reaches it.
  const width = lerp(W.width, Math.min(24, W.width), squeeze) * (1 - p * smoothstep(u));
  return {
    left: centre - width / 2, right: centre + width / 2,
    y: mirrored ? W.top + W.height - y : W.top + y,
  };
}

export function genieSlice(W, T, count, index, t, mirrored = false) {
  const top = genieEdge(W, T, index / count, t, mirrored);
  const bottom = genieEdge(W, T, (index + 1) / count, t, mirrored);
  const x = Math.min(top.left, bottom.left);
  const width = Math.max(top.right, bottom.right) - x;
  const height = Math.max(0, bottom.y - top.y);
  return {
    top, bottom, x, y: top.y, width, height,
    sx: ((top.right - top.left) + (bottom.right - bottom.left)) / (2 * W.width),
    sy: clamp(height / (W.height / count)), opacity: height > 0 && width > 0 ? 1 : 0,
  };
}

// Computed panel colours are sRGB rgb()/rgba(); surface tokens may also be hex.
function rgba(colour) {
  const hex = colour.trim().match(/^#([\da-f]{3,8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex].map(value => value + value).join('') : hex;
    return [0, 2, 4].map(index => parseInt(expanded.slice(index, index + 2), 16))
      .concat(expanded.length === 8 ? parseInt(expanded.slice(6), 16) / 255 : 1);
  }
  const parts = colour.match(/[\d.]+%?/g) || [];
  return [0, 1, 2, 3].map(index => parts[index] == null ? (index === 3 ? 1 : 0)
    : parseFloat(parts[index]) * (parts[index].endsWith('%') ? (index === 3 ? .01 : 2.55) : 1));
}

export function opaqueGenieSurface(surface, background) {
  const [r, g, b, alpha] = rgba(surface);
  const base = rgba(background);
  return `rgb(${[r, g, b].map((value, index) => Math.round(lerp(base[index], value, clamp(alpha)))).join(', ')})`;
}
