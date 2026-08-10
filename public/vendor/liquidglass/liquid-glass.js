/**
 * LiquidGlass — attaches physics refraction filters to DOM elements.
 *
 * Pipeline (Chromium backdrop-filter + SVG):
 *   backdrop → optional blur → R/G/B split displacement (chromatic aberration)
 *            → recombine → composite with glass tint & specular layer
 *
 * Falls back to enhanced CSS glass when url() backdrop-filter is unavailable.
 */

import {
  generateDisplacementMap,
  generateSpecularOverlay,
  PRESETS,
} from "./physics.js";

let filterSeq = 0;
const instances = new Set();

function supportsBackdropUrlFilter() {
  if (typeof CSS === "undefined" || !CSS.supports) return false;
  // Feature-detect: browsers that accept url() in backdrop-filter
  return (
    CSS.supports("backdrop-filter", "url(#x)") ||
    CSS.supports("-webkit-backdrop-filter", "url(#x)")
  );
}

const CAN_URL_BACKDROP = supportsBackdropUrlFilter();

/**
 * Ensure a hidden SVG defs host exists in the document.
 */
function getSvgHost() {
  let host = document.getElementById("liquid-glass-svg-host");
  if (!host) {
    host = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    host.id = "liquid-glass-svg-host";
    host.setAttribute("width", "0");
    host.setAttribute("height", "0");
    host.style.cssText =
      "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    host.innerHTML = "<defs></defs>";
    document.body.prepend(host);
  }
  return host.querySelector("defs");
}

/**
 * Create (or rebuild) the multi-pass chromatic displacement filter.
 * @param {number} elW element CSS width
 * @param {number} elH element CSS height
 */
function buildFilter(filterId, mapDataUrl, scale, blur, elW, elH) {
  const defs = getSvgHost();
  let filter = defs.querySelector(`#${filterId}`);
  if (filter) filter.remove();

  const ns = "http://www.w3.org/2000/svg";
  filter = document.createElementNS(ns, "filter");
  filter.setAttribute("id", filterId);
  // Pixel-space filter region with overscan for edge bend
  const padX = Math.round(elW * 0.12);
  const padY = Math.round(elH * 0.12);
  filter.setAttribute("x", String(-padX));
  filter.setAttribute("y", String(-padY));
  filter.setAttribute("width", String(elW + padX * 2));
  filter.setAttribute("height", String(elH + padY * 2));
  filter.setAttribute("filterUnits", "userSpaceOnUse");
  filter.setAttribute("primitiveUnits", "userSpaceOnUse");
  filter.setAttribute("color-interpolation-filters", "sRGB");

  // Displacement map image — covers the element box
  const feImage = document.createElementNS(ns, "feImage");
  feImage.setAttribute("href", mapDataUrl);
  feImage.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", mapDataUrl);
  feImage.setAttribute("x", "0");
  feImage.setAttribute("y", "0");
  feImage.setAttribute("width", String(elW));
  feImage.setAttribute("height", String(elH));
  feImage.setAttribute("result", "dispMap");
  feImage.setAttribute("preserveAspectRatio", "none");
  filter.appendChild(feImage);

  // Mild optical blur (wavelength scattering in glass)
  const feBlur = document.createElementNS(ns, "feGaussianBlur");
  feBlur.setAttribute("in", "SourceGraphic");
  feBlur.setAttribute("stdDeviation", String(blur));
  feBlur.setAttribute("result", "blurred");
  filter.appendChild(feBlur);

  // --- Chromatic aberration: three displacement scales for R / G / B ---
  const scales = {
    r: scale * 1.12,
    g: scale,
    b: scale * 0.88,
  };

  for (const [ch, sc] of Object.entries(scales)) {
    const disp = document.createElementNS(ns, "feDisplacementMap");
    disp.setAttribute("in", "blurred");
    disp.setAttribute("in2", "dispMap");
    disp.setAttribute("scale", String(sc));
    disp.setAttribute("xChannelSelector", "R");
    disp.setAttribute("yChannelSelector", "G");
    disp.setAttribute("result", `disp_${ch}`);
    filter.appendChild(disp);

    // Isolate channel
    const ct = document.createElementNS(ns, "feComponentTransfer");
    ct.setAttribute("in", `disp_${ch}`);
    ct.setAttribute("result", `iso_${ch}`);
    for (const c of ["R", "G", "B"]) {
      const fn = document.createElementNS(ns, `feFunc${c}`);
      if (c.toLowerCase() === ch) {
        fn.setAttribute("type", "identity");
      } else {
        fn.setAttribute("type", "table");
        fn.setAttribute("tableValues", "0 0");
      }
      ct.appendChild(fn);
    }
    // Keep alpha
    const fa = document.createElementNS(ns, "feFuncA");
    fa.setAttribute("type", "identity");
    ct.appendChild(fa);
    filter.appendChild(ct);
  }

  // Recombine R+G
  const mergeRG = document.createElementNS(ns, "feComposite");
  mergeRG.setAttribute("in", "iso_r");
  mergeRG.setAttribute("in2", "iso_g");
  mergeRG.setAttribute("operator", "arithmetic");
  mergeRG.setAttribute("k1", "0");
  mergeRG.setAttribute("k2", "1");
  mergeRG.setAttribute("k3", "1");
  mergeRG.setAttribute("k4", "0");
  mergeRG.setAttribute("result", "rg");
  filter.appendChild(mergeRG);

  // +B
  const mergeRGB = document.createElementNS(ns, "feComposite");
  mergeRGB.setAttribute("in", "rg");
  mergeRGB.setAttribute("in2", "iso_b");
  mergeRGB.setAttribute("operator", "arithmetic");
  mergeRGB.setAttribute("k1", "0");
  mergeRGB.setAttribute("k2", "1");
  mergeRGB.setAttribute("k3", "1");
  mergeRGB.setAttribute("k4", "0");
  mergeRGB.setAttribute("result", "refracted");
  filter.appendChild(mergeRGB);

  defs.appendChild(filter);
  return filter;
}

function dataUrlFromCanvas(canvas) {
  return canvas.toDataURL("image/png");
}

/**
 * @typedef {object} GlassOptions
 * @property {string} [preset]
 * @property {number} [radius]
 * @property {number} [scale]  feDisplacementMap scale (px)
 * @property {number} [blur]
 * @property {number} [ior]
 * @property {number} [bezel]
 * @property {boolean} [animate]
 * @property {string} [tint]  CSS color overlay
 */

export class LiquidGlass {
  /**
   * @param {HTMLElement} el
   * @param {GlassOptions} options
   */
  constructor(el, options = {}) {
    this.el = el;
    this.id = `lg-filter-${++filterSeq}`;
    this._seq = filterSeq;
    this.options = { animate: true, scale: 48, blur: 0.6, ...options };
    this.phase = Math.random() * Math.PI * 2;
    this._raf = 0;
    this._lastMap = 0;
    this._ro = null;
    this._mapUrl = "";

    el.classList.add("liquid-glass");
    el.dataset.glassId = this.id;

    // Structure: refraction surface + specular + content
    if (!el.querySelector(".lg-surface")) {
      const surface = document.createElement("div");
      surface.className = "lg-surface";
      surface.setAttribute("aria-hidden", "true");

      const specular = document.createElement("div");
      specular.className = "lg-specular";
      specular.setAttribute("aria-hidden", "true");

      const edge = document.createElement("div");
      edge.className = "lg-edge";
      edge.setAttribute("aria-hidden", "true");

      // Wrap existing children into content
      const content = document.createElement("div");
      content.className = "lg-content";
      while (el.firstChild) content.appendChild(el.firstChild);

      el.append(surface, specular, edge, content);
    }

    this.surface = el.querySelector(".lg-surface");
    this.specular = el.querySelector(".lg-specular");
    this.edge = el.querySelector(".lg-edge");

    if (this.options.tint) {
      el.style.setProperty("--lg-tint", this.options.tint);
    }

    this.rebuild();
    this._ro = new ResizeObserver(() => this.rebuild());
    this._ro.observe(el);

    if (this.options.animate !== false) {
      instances.add(this);
      startLoop();
    }
  }

  getPhysicsOpts() {
    const preset = PRESETS[this.options.preset] || PRESETS.crystal;
    const rect = this.el.getBoundingClientRect();
    const cs = getComputedStyle(this.el);
    const radius =
      this.options.radius ??
      parseFloat(cs.borderRadius) ||
      Math.min(rect.width, rect.height) * 0.22;

    return {
      ...preset,
      ...this.options,
      radius,
      liquidPhase: this.phase,
    };
  }

  rebuild() {
    const rect = this.el.getBoundingClientRect();
    const w = Math.max(2, Math.round(rect.width));
    const h = Math.max(2, Math.round(rect.height));
    if (w < 4 || h < 4) return;

    const phys = this.getPhysicsOpts();
    // Half-res maps: displacement is low-frequency; big win on CPU
    const mapScale = w * h > 90000 ? 0.45 : w * h > 40000 ? 0.55 : 0.7;
    const mw = Math.max(8, Math.round(w * mapScale));
    const mh = Math.max(8, Math.round(h * mapScale));

    const mapCanvas = generateDisplacementMap(mw, mh, {
      ...phys,
      // Keep bezel/radius proportional in map space
      radius: (phys.radius ?? 28) * mapScale,
      bezel: (phys.bezel ?? 18) * mapScale,
    });
    this._mapUrl = dataUrlFromCanvas(mapCanvas);

    const scale = this.options.scale ?? 48;
    const blur = this.options.blur ?? 0.6;

    buildFilter(this.id, this._mapUrl, scale, blur, w, h);

    // Specular at moderate res
    const sw = Math.max(8, Math.round(w * 0.6));
    const sh = Math.max(8, Math.round(h * 0.6));
    const specCanvas = generateSpecularOverlay(sw, sh, {
      radius: (phys.radius ?? 28) * 0.6,
      lightAngle: -0.7 + Math.sin(this.phase * 0.3) * 0.08,
    });
    this.specular.style.backgroundImage = `url(${dataUrlFromCanvas(specCanvas)})`;

    // Apply backdrop refraction
    if (CAN_URL_BACKDROP) {
      const url = `url(#${this.id})`;
      // Combine mild saturate with the displacement filter when supported
      this.surface.style.backdropFilter = url;
      this.surface.style.webkitBackdropFilter = url;
      this.el.classList.remove("lg-fallback");
    } else {
      this.el.classList.add("lg-fallback");
      this.surface.style.backdropFilter = `blur(${4 + blur}px) saturate(1.4)`;
      this.surface.style.webkitBackdropFilter = `blur(${4 + blur}px) saturate(1.4)`;
    }

    this.el.style.setProperty("--lg-bezel", `${phys.bezel ?? 18}px`);
    this.el.style.setProperty("--lg-ior", String(phys.ior ?? 1.52));
    if (phys.radius != null) {
      this.el.style.setProperty("--lg-radius", `${phys.radius}px`);
    }
  }

  /** Called by shared RAF loop */
  tick(time, dt) {
    if (this.options.animate === false) return;
    this.phase += dt * 0.0018;
    // Stagger rebuilds; ~6–7 fps is enough for liquid meniscus
    const interval = 140 + (this._seq % 5) * 25;
    if (time - this._lastMap > interval) {
      this._lastMap = time;
      this.rebuild();
    }
  }

  setPreset(name) {
    this.options.preset = name;
    this.rebuild();
  }

  setScale(s) {
    this.options.scale = s;
    this.rebuild();
  }

  destroy() {
    instances.delete(this);
    this._ro?.disconnect();
    const defs = getSvgHost();
    defs.querySelector(`#${this.id}`)?.remove();
  }
}

/* ---------- Shared animation loop ---------- */
let loopOn = false;
let lastT = 0;

function startLoop() {
  if (loopOn) return;
  loopOn = true;
  lastT = performance.now();
  const frame = (t) => {
    if (instances.size === 0) {
      loopOn = false;
      return;
    }
    const dt = Math.min(48, t - lastT);
    lastT = t;
    for (const inst of instances) inst.tick(t, dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/**
 * Auto-bind all [data-liquid-glass] elements.
 */
export function autoBind(root = document) {
  const nodes = root.querySelectorAll("[data-liquid-glass]");
  const list = [];
  nodes.forEach((el) => {
    if (el._liquidGlass) return;
    const opts = {};
    const preset = el.dataset.preset;
    if (preset) opts.preset = preset;
    if (el.dataset.scale) opts.scale = parseFloat(el.dataset.scale);
    if (el.dataset.radius) opts.radius = parseFloat(el.dataset.radius);
    if (el.dataset.animate === "false") opts.animate = false;
    if (el.dataset.tint) opts.tint = el.dataset.tint;
    if (el.dataset.blur) opts.blur = parseFloat(el.dataset.blur);
    el._liquidGlass = new LiquidGlass(el, opts);
    list.push(el._liquidGlass);
  });
  return list;
}

export { PRESETS, CAN_URL_BACKDROP };
