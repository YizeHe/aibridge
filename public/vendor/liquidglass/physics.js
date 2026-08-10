/**
 * Liquid Glass Physics Engine
 * ---------------------------
 * Generates refraction displacement maps from first-principles optics:
 *   1. Rounded-rect signed distance field (glass footprint)
 *   2. Convex bezel height profile (molded glass rim)
 *   3. Surface normals via ∇h
 *   4. Snell's law refraction (air → glass)
 *   5. Lateral ray projection → RG displacement channels
 *   6. Schlick Fresnel → B channel (specular weight)
 *
 * Encoding for SVG feDisplacementMap:
 *   P'(x,y) = P(x + scale*(R-0.5), y + scale*(G-0.5))
 * so R=G=128 ⇒ no displacement; edges encode outward/inward bend.
 */

/**
 * Signed distance to rounded box.
 * Convention: positive OUTSIDE, negative INSIDE (standard SDF).
 */
function sdRoundedBox(px, py, hw, hh, radius) {
  const r = Math.min(radius, hw, hh);
  const bx = Math.abs(px) - (hw - r);
  const by = Math.abs(py) - (hh - r);
  const ox = Math.max(bx, 0);
  const oy = Math.max(by, 0);
  const outside = Math.hypot(ox, oy);
  const inside = Math.min(Math.max(bx, by), 0);
  return outside + inside - r;
}

/**
 * Distance from the nearest edge, positive inside the shape, 0 on edge.
 */
function distFromEdge(px, py, hw, hh, radius) {
  return -sdRoundedBox(px, py, hw, hh, radius);
}

/**
 * Glass thickness profile along the inward normal.
 * Convex molded rim: steep rise in the outer third (strong bend), then soft
 * plateau — the silhouette that makes liquid-glass edges “lens” the backdrop.
 *
 * Height units are optical-path scales (not CSS px); paired with Snell projection
 * they feed RG channels in ~[-0.5, 0.5].
 *
 * @param {number} d  distance from edge (px), ≥ 0 inside
 * @param {number} bezel  rim width
 * @param {number} maxH  max optical thickness
 * @returns {{ h: number, dh: number }} height and d(height)/d(d)
 */
function glassProfile(d, bezel, maxH) {
  if (d <= 0) return { h: 0, dh: 0 };
  if (d >= bezel) return { h: maxH, dh: 0 };

  // Smoothstep-like S-curve with extra edge kick (derivative peaks near d→0+)
  // h = maxH * (1 - (1-t)^2.4)  → fast climb, flat approach to plateau
  const t = d / bezel;
  const p = 2.4;
  const u = 1 - t;
  const h = maxH * (1 - Math.pow(u, p));
  // dh/dd = maxH * p * (1-t)^(p-1) * (1/bezel)
  const dh = maxH * p * Math.pow(u, p - 1) / bezel;
  return { h, dh };
}

/**
 * Refract incident unit vector I through interface with normal N (both point
 * such that N faces the incident side). Returns refracted direction T.
 * η = n1/n2 (incident / transmitted IOR).
 */
function refract(Ix, Iy, Iz, Nx, Ny, Nz, eta) {
  const cosi = Math.min(1, Math.max(-1, -(Ix * Nx + Iy * Ny + Iz * Nz)));
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) {
    // Total internal reflection — treat as no lateral bend
    return { x: 0, y: 0, z: -1, fresnel: 1 };
  }
  const c = eta * cosi - Math.sqrt(k);
  const Tx = eta * Ix + c * Nx;
  const Ty = eta * Iy + c * Ny;
  const Tz = eta * Iz + c * Nz;
  // Schlick approx for unpolarized Fresnel at glass (R0 ≈ 0.04 for n=1.5)
  const R0 = 0.04;
  const m = 1 - cosi;
  const fresnel = R0 + (1 - R0) * m * m * m * m * m;
  return { x: Tx, y: Ty, z: Tz, fresnel };
}

/**
 * Generate a physics-based displacement map for a rounded-rect glass lens.
 *
 * @param {number} width
 * @param {number} height
 * @param {object} opts
 * @returns {HTMLCanvasElement}
 */
export function generateDisplacementMap(width, height, opts = {}) {
  const {
    radius = 28,
    bezel = 20,
    ior = 1.52, // crown glass
    maxHeight = 10,
    liquidPhase = 0,
    liquidAmp = 0.12,
    liquidFreq = 3.0,
    padding = 0,
  } = opts;

  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.createImageData(w, h);
  const data = img.data;

  // Content box inside optional padding (filter overflow)
  const cx = w / 2;
  const cy = h / 2;
  const hw = w / 2 - padding;
  const hh = h / 2 - padding;
  const rad = Math.min(radius, hw, hh);
  const nAir = 1.0;
  const eta = nAir / ior;

  // Finite-difference epsilon for SDF gradient
  const eps = 0.85;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;

      let d = distFromEdge(px, py, hw, hh, rad);

      // Liquid meniscus: gentle traveling wave along the rim only
      if (d > -2 && d < bezel * 1.8) {
        const ang = Math.atan2(py, px);
        const wave =
          Math.sin(ang * liquidFreq + liquidPhase) * 0.55 +
          Math.sin(ang * (liquidFreq * 2.1) - liquidPhase * 1.3) * 0.35 +
          Math.sin(ang * 0.7 + liquidPhase * 0.5) * 0.15;
        const falloff = Math.exp(-Math.max(d, 0) / (bezel * 0.85));
        d += liquidAmp * bezel * wave * falloff;
      }

      const idx = (y * w + x) * 4;

      if (d <= 0.05) {
        // Outside — neutral displacement, transparent
        data[idx] = 128;
        data[idx + 1] = 128;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
        continue;
      }

      const { h: thick, dh } = glassProfile(d, bezel, maxHeight);

      // SDF gradient (outward for standard SDF; we use edge-distance so flip)
      const dL = distFromEdge(px - eps, py, hw, hh, rad);
      const dR = distFromEdge(px + eps, py, hw, hh, rad);
      const dU = distFromEdge(px, py - eps, hw, hh, rad);
      const dD = distFromEdge(px, py + eps, hw, hh, rad);
      // ∇d points inward (increasing distance-from-edge)
      let gdx = (dR - dL) / (2 * eps);
      let gdy = (dD - dU) / (2 * eps);
      const gl = Math.hypot(gdx, gdy) || 1;
      gdx /= gl;
      gdy /= gl;

      // Height gradient: ∂h/∂x = (dh/dd) * ∂d/∂x
      const hx = dh * gdx;
      const hy = dh * gdy;

      // Surface normal pointing toward viewer (+Z out of screen)
      const invLen = 1 / Math.hypot(hx, hy, 1);
      const Nx = -hx * invLen;
      const Ny = -hy * invLen;
      const Nz = 1 * invLen;

      // Incident ray from camera into the scene
      const I = { x: 0, y: 0, z: -1 };
      const T = refract(I.x, I.y, I.z, Nx, Ny, Nz, eta);

      // Lateral offset after traversing optical thickness
      // (thin-slab approx of second interface + gradient “lens” term)
      const invTz = Math.abs(T.z) > 1e-4 ? 1 / T.z : 0;
      // Snell-projected bend
      let ox = T.x * invTz * thick * 1.15;
      let oy = T.y * invTz * thick * 1.15;
      // Direct normal term (dominant near steep bezel — matches Apple-like rim warp)
      ox += Nx * thick * 0.55;
      oy += Ny * thick * 0.55;

      // Weak center magnification (barrel) once past the bezel
      if (d > bezel * 0.75) {
        const centerPull = 0.04 * thick * Math.min(1, (d - bezel * 0.75) / bezel);
        ox -= (px / Math.max(hw, 1)) * centerPull;
        oy -= (py / Math.max(hh, 1)) * centerPull;
      }

      ox = Math.max(-0.5, Math.min(0.5, ox));
      oy = Math.max(-0.5, Math.min(0.5, oy));

      // Soft alpha at rim for anti-aliased mask
      const edgeAlpha = Math.min(1, d / 1.6);

      data[idx] = Math.round((ox + 0.5) * 255);
      data[idx + 1] = Math.round((oy + 0.5) * 255);
      data[idx + 2] = Math.round(Math.min(1, T.fresnel * 1.4) * 255);
      data[idx + 3] = Math.round(edgeAlpha * 255);
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Build a specular / highlight overlay from the Fresnel (B) channel
 * and geometric rim lighting — used as a CSS mask / canvas layer.
 */
export function generateSpecularOverlay(width, height, opts = {}) {
  const {
    radius = 28,
    lightAngle = -0.65, // radians, top-left
    lightElev = 0.55,
    padding = 0,
  } = opts;

  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  const data = img.data;

  const cx = w / 2;
  const cy = h / 2;
  const hw = w / 2 - padding;
  const hh = h / 2 - padding;
  const rad = Math.min(radius, hw, hh);

  const Lx = Math.cos(lightAngle) * Math.cos(lightElev);
  const Ly = Math.sin(lightAngle) * Math.cos(lightElev);
  const Lz = Math.sin(lightElev);
  const eps = 0.85;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const d = distFromEdge(px, py, hw, hh, rad);
      const idx = (y * w + x) * 4;

      if (d <= 0) {
        data[idx + 3] = 0;
        continue;
      }

      const dL = distFromEdge(px - eps, py, hw, hh, rad);
      const dR = distFromEdge(px + eps, py, hw, hh, rad);
      const dU = distFromEdge(px, py - eps, hw, hh, rad);
      const dD = distFromEdge(px, py + eps, hw, hh, rad);
      let gdx = (dR - dL) / (2 * eps);
      let gdy = (dD - dU) / (2 * eps);
      // Rim normal tilts outward near edge
      const rim = Math.exp(-d / 10);
      const tilt = rim * 0.85;
      const Nx = -gdx * tilt;
      const Ny = -gdy * tilt;
      const Nz = Math.sqrt(Math.max(0, 1 - Nx * Nx - Ny * Ny));

      // Half-vector specular (Blinn-Phong)
      const Vx = 0,
        Vy = 0,
        Vz = 1;
      let Hx = Lx + Vx,
        Hy = Ly + Vy,
        Hz = Lz + Vz;
      const hl = Math.hypot(Hx, Hy, Hz) || 1;
      Hx /= hl;
      Hy /= hl;
      Hz /= hl;
      const ndoth = Math.max(0, Nx * Hx + Ny * Hy + Nz * Hz);
      const spec = Math.pow(ndoth, 48) * 0.95 + Math.pow(ndoth, 8) * 0.25;

      // Fresnel rim glow
      const ndotv = Math.max(0, Nz);
      const fres = Math.pow(1 - ndotv, 2.5) * 0.55;

      const a = Math.min(1, (spec + fres) * Math.min(1, d / 1.5));
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(a * 255);
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

export const PRESETS = {
  crystal: { ior: 1.52, bezel: 20, maxHeight: 10, liquidAmp: 0.12 },
  dense: { ior: 1.7, bezel: 24, maxHeight: 13, liquidAmp: 0.09 },
  soft: { ior: 1.4, bezel: 28, maxHeight: 8, liquidAmp: 0.18 },
  thin: { ior: 1.48, bezel: 14, maxHeight: 7, liquidAmp: 0.07 },
  liquid: { ior: 1.55, bezel: 26, maxHeight: 11, liquidAmp: 0.24, liquidFreq: 4 },
};
