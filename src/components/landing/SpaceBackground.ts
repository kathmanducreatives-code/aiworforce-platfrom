/* ═══════════════════════════════════════════════════════════════
   SpaceBackground — AI Fiesta Design System
   Deep dark canvas background: #030A0C base, #0F4450 mid-tone,
   #298799 teal glow accent. Bottom-right heavy glow + arc.
   ═══════════════════════════════════════════════════════════════ */

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ParticleSeed = {
  xRatio: number;
  yRatio: number;
  radius: number;
  alpha: number;
  tint: "white" | "teal";
};

type PulsingParticle = ParticleSeed & {
  minAlpha: number;
  maxAlpha: number;
  durationMs: number;
  phase: number;
};

type ArcSpark = {
  t: number;
  offset: number;
  radius: number;
  alpha: number;
};

type Point = {
  x: number;
  y: number;
};

/* ─── Design tokens ─── */
const BASE_COLOR    = "#030A0C";   // bg-galaxy-void
const TEAL_BRIGHT   = "41, 135, 153";  // #298799 — glow accent
const TEAL_MID      = "15, 68, 80";    // #0F4450 — mid depth
const GRID_SIZE     = 110;
const STAR_COUNT    = 300;
const PULSE_COUNT   = 18;
const ARC_SPARK_COUNT  = 48;
const ARC_PERIOD_MS    = 9000;
const ARC_DRIFT_AMPLITUDE = 5;
const MAX_DPR = 2;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const cubicPoint = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point => {
  const u = 1 - t;
  const u2 = u * u;
  const t2 = t * t;
  return {
    x: u2 * u * p0.x + 3 * u2 * t * p1.x + 3 * u * t2 * p2.x + t2 * t * p3.x,
    y: u2 * u * p0.y + 3 * u2 * t * p1.y + 3 * u * t2 * p2.y + t2 * t * p3.y,
  };
};

const cubicDerivative = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point => {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
};

class SpaceBackground {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sceneCanvas: HTMLCanvasElement;
  private readonly sceneCtx: CanvasRenderingContext2D;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly overlayCtx: CanvasRenderingContext2D;
  private readonly compositeCanvas: HTMLCanvasElement;
  private readonly compositeCtx: CanvasRenderingContext2D;

  private width = 0;
  private height = 0;
  private dpr = 1;
  private running = false;
  private animationFrame = 0;

  private staticParticles: ParticleSeed[] = [];
  private pulsingParticles: PulsingParticle[] = [];
  private arcSparks: ArcSpark[] = [];

  private previousPulseRects: Rect[] = [];
  private previousArcRect: Rect | null = null;

  private readonly handleResize = () => this.resize();
  private readonly animate = (time: number) => {
    if (!this.running) return;

    const previousRects = [
      ...this.previousPulseRects,
      ...(this.previousArcRect ? [this.previousArcRect] : []),
    ];

    previousRects.forEach((rect) => this.restoreRect(rect));

    const currentPulseRects = this.drawPulsingParticles(time);
    const currentArcRect    = this.drawArc(time);
    const currentRects = [
      ...currentPulseRects,
      ...(currentArcRect ? [currentArcRect] : []),
    ];

    currentRects.forEach((rect) => this.drawOverlayRect(rect));

    this.previousPulseRects = currentPulseRects;
    this.previousArcRect    = currentArcRect;
    this.animationFrame = window.requestAnimationFrame(this.animate);
  };

  constructor(canvasElement: HTMLCanvasElement) {
    const context = canvasElement.getContext("2d", { alpha: true });
    if (!context) throw new Error("SpaceBackground requires a 2D canvas context.");

    this.canvas = canvasElement;
    this.ctx    = context;

    this.sceneCanvas     = document.createElement("canvas");
    this.overlayCanvas   = document.createElement("canvas");
    this.compositeCanvas = document.createElement("canvas");

    const sceneContext     = this.sceneCanvas.getContext("2d",     { alpha: true });
    const overlayContext   = this.overlayCanvas.getContext("2d",   { alpha: true });
    const compositeContext = this.compositeCanvas.getContext("2d", { alpha: true });

    if (!sceneContext || !overlayContext || !compositeContext) {
      throw new Error("SpaceBackground could not initialize offscreen buffers.");
    }

    this.sceneCtx     = sceneContext;
    this.overlayCtx   = overlayContext;
    this.compositeCtx = compositeContext;
  }

  init() {
    if (this.running) return;
    this.configureCanvas();
    this.seedScene();
    this.resize();
    window.addEventListener("resize", this.handleResize, { passive: true });
    this.running = true;
    this.animationFrame = window.requestAnimationFrame(this.animate);
  }

  resize() {
    this.width  = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr    = Math.min(window.devicePixelRatio || 1, MAX_DPR);

    this.resizeCanvas(this.canvas,          this.ctx,          true);
    this.resizeCanvas(this.sceneCanvas,     this.sceneCtx);
    this.resizeCanvas(this.overlayCanvas,   this.overlayCtx);
    this.resizeCanvas(this.compositeCanvas, this.compositeCtx);

    this.drawStaticScene();
    this.drawOverlay();
    this.composeStaticBuffers();
    this.renderFullFrame();
  }

  destroy() {
    this.running = false;
    window.removeEventListener("resize", this.handleResize);
    if (this.animationFrame) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
  }

  /* ─── canvas setup ─── */
  private configureCanvas() {
    Object.assign(this.canvas.style, {
      position:      "fixed",
      top:           "0",
      left:          "0",
      width:         "100vw",
      height:        "100vh",
      pointerEvents: "none",
      zIndex:        "-1",
    });
    this.canvas.setAttribute("aria-hidden", "true");
  }

  private resizeCanvas(
    targetCanvas: HTMLCanvasElement,
    targetCtx: CanvasRenderingContext2D,
    applyDomSizing = false
  ) {
    targetCanvas.width  = Math.max(1, Math.floor(this.width  * this.dpr));
    targetCanvas.height = Math.max(1, Math.floor(this.height * this.dpr));
    if (applyDomSizing) {
      targetCanvas.style.width  = `${this.width}px`;
      targetCanvas.style.height = `${this.height}px`;
    }
    targetCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    targetCtx.imageSmoothingEnabled = true;
  }

  /* ─── particle seeding ─── */
  private seedScene() {
    if (this.staticParticles.length || this.pulsingParticles.length || this.arcSparks.length) return;

    const rng = mulberry32(20260326);
    const pulseIndices = new Set<number>();
    while (pulseIndices.size < PULSE_COUNT) {
      pulseIndices.add(Math.floor(rng() * STAR_COUNT));
    }

    for (let i = 0; i < STAR_COUNT; i++) {
      // weight more particles toward bottom-right to support the glow cluster
      const clusterRight = i >= 150;
      const xRatio = clusterRight ? 0.5 + rng() * 0.5 : rng();
      const yRatio = clusterRight ? 0.3 + rng() * 0.7  : rng();
      const particle: ParticleSeed = {
        xRatio,
        yRatio,
        radius: 0.28 + rng() * 0.85,
        alpha:  0.12 + rng() * 0.38,
        tint:   rng() > 0.65 ? "teal" : "white",
      };

      if (pulseIndices.has(i)) {
        this.pulsingParticles.push({
          ...particle,
          minAlpha:   0.08,
          maxAlpha:   0.22 + rng() * 0.24,
          durationMs: 2800 + rng() * 3200,
          phase:      rng() * Math.PI * 2,
        });
      } else {
        this.staticParticles.push(particle);
      }
    }

    for (let i = 0; i < ARC_SPARK_COUNT; i++) {
      this.arcSparks.push({
        t:      clamp(0.06 + (i / (ARC_SPARK_COUNT - 1)) * 0.9 + (rng() - 0.5) * 0.04, 0.03, 0.98),
        offset: (rng() - 0.5) * 20,
        radius: 0.5 + rng() * 1.1,
        alpha:  0.15 + rng() * 0.30,
      });
    }
  }

  /* ─── static scene ─── */
  private drawStaticScene() {
    this.sceneCtx.clearRect(0, 0, this.width, this.height);
    this.sceneCtx.fillStyle = BASE_COLOR;
    this.sceneCtx.fillRect(0, 0, this.width, this.height);

    this.drawGrid(this.sceneCtx);
    this.drawBottomRightGlow(this.sceneCtx);
    this.drawSecondaryNebula(this.sceneCtx);
    this.drawTopLeftGhost(this.sceneCtx);
    this.drawStaticParticles(this.sceneCtx);
  }

  /* ─── grid ─── */
  private drawGrid(ctx: CanvasRenderingContext2D) {
    ctx.save();
    // Use #298799 teal at very low opacity — matches design system
    ctx.strokeStyle = `rgba(${TEAL_BRIGHT}, 0.045)`;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = 0.5; x <= this.width; x += GRID_SIZE) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
    }
    for (let y = 0.5; y <= this.height; y += GRID_SIZE) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
    }

    ctx.stroke();
    ctx.restore();
  }

  /* ─── bottom-right primary glow ─── */
  private drawBottomRightGlow(ctx: CanvasRenderingContext2D) {
    // Main concentrated glow — bottom-right corner
    const cx = this.width  * 0.86;
    const cy = this.height * 0.84;
    const r  = clamp(Math.min(this.width, this.height) * 0.55, 320, 580);

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0,    `rgba(${TEAL_MID}, 0.55)`);
    gradient.addColorStop(0.25, `rgba(${TEAL_BRIGHT}, 0.18)`);
    gradient.addColorStop(0.55, `rgba(${TEAL_MID}, 0.07)`);
    gradient.addColorStop(1,    `rgba(${TEAL_MID}, 0)`);

    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();

    // Second, larger soft diffusion halo
    const hr  = clamp(Math.min(this.width, this.height) * 0.8, 480, 800);
    const hg  = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, hr);
    hg.addColorStop(0, `rgba(${TEAL_BRIGHT}, 0.06)`);
    hg.addColorStop(1, `rgba(${TEAL_MID}, 0)`);
    ctx.save();
    ctx.fillStyle = hg;
    ctx.fillRect(cx - hr, cy - hr, hr * 2, hr * 2);
    ctx.restore();
  }

  /* ─── secondary nebula (mid-right atmosphere) ─── */
  private drawSecondaryNebula(ctx: CanvasRenderingContext2D) {
    const cx = this.width  * 0.70;
    const cy = this.height * 0.52;
    const r  = clamp(Math.min(this.width, this.height) * 0.28, 180, 300);

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, `rgba(${TEAL_BRIGHT}, 0.06)`);
    gradient.addColorStop(1, `rgba(${TEAL_MID}, 0)`);

    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }

  /* ─── top-left atmospheric ghost ─── */
  private drawTopLeftGhost(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.filter = `blur(60px)`;
    ctx.fillStyle = `rgba(${TEAL_MID}, 0.08)`;
    ctx.fillRect(
      -this.width  * 0.03,
      -this.height * 0.03,
       this.width  * 0.22,
       this.height * 0.22
    );
    ctx.restore();
  }

  /* ─── static stars ─── */
  private drawStaticParticles(ctx: CanvasRenderingContext2D) {
    this.staticParticles.forEach((p) => {
      const x = p.xRatio * this.width;
      const y = p.yRatio * this.height;
      const color = p.tint === "teal"
        ? `rgba(${TEAL_BRIGHT}, ${p.alpha.toFixed(3)})`
        : `rgba(255, 255, 255, ${p.alpha.toFixed(3)})`;

      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(x, y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /* ─── vignette overlay ─── */
  private drawOverlay() {
    this.overlayCtx.clearRect(0, 0, this.width, this.height);

    const vignette = this.overlayCtx.createRadialGradient(
      this.width  * 0.5,
      this.height * 0.5,
      Math.min(this.width, this.height) * 0.15,
      this.width  * 0.5,
      this.height * 0.5,
      Math.max(this.width, this.height) * 0.82
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.48)");

    this.overlayCtx.fillStyle = vignette;
    this.overlayCtx.fillRect(0, 0, this.width, this.height);
  }

  /* ─── compose ─── */
  private composeStaticBuffers() {
    this.compositeCtx.clearRect(0, 0, this.width, this.height);
    this.compositeCtx.drawImage(
      this.sceneCanvas, 0, 0,
      this.sceneCanvas.width, this.sceneCanvas.height,
      0, 0, this.width, this.height
    );
    this.compositeCtx.drawImage(
      this.overlayCanvas, 0, 0,
      this.overlayCanvas.width, this.overlayCanvas.height,
      0, 0, this.width, this.height
    );
  }

  private renderFullFrame() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(
      this.compositeCanvas, 0, 0,
      this.compositeCanvas.width, this.compositeCanvas.height,
      0, 0, this.width, this.height
    );
    const now = performance.now();
    const pulseRects = this.drawPulsingParticles(now);
    const arcRect    = this.drawArc(now);
    const rects = [...pulseRects, ...(arcRect ? [arcRect] : [])];
    rects.forEach((r) => this.drawOverlayRect(r));
    this.previousPulseRects = pulseRects;
    this.previousArcRect    = arcRect;
  }

  /* ─── pulsing stars (animated) ─── */
  private drawPulsingParticles(time: number) {
    const bounds: Rect[] = [];

    this.pulsingParticles.forEach((p) => {
      const x  = p.xRatio * this.width;
      const y  = p.yRatio * this.height;
      const progress = ((time + p.phase * 1000) % p.durationMs) / p.durationMs;
      const eased    = (Math.sin(progress * Math.PI * 2) + 1) * 0.5;
      const alpha    = p.minAlpha + (p.maxAlpha - p.minAlpha) * eased;
      const color    = p.tint === "teal"
        ? `rgba(${TEAL_BRIGHT}, ${alpha.toFixed(3)})`
        : `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
      const drawR = Math.max(1.8, p.radius + 2.5);

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.fillStyle  = color;
      this.ctx.shadowBlur = p.tint === "teal" ? 9 : 4;
      this.ctx.shadowColor = p.tint === "teal"
        ? `rgba(${TEAL_BRIGHT}, 0.22)`
        : "rgba(255, 255, 255, 0.1)";
      this.ctx.arc(x, y, p.radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();

      bounds.push({ x: x - drawR, y: y - drawR, width: drawR * 2, height: drawR * 2 });
    });

    return bounds.map((r) => this.clipRect(r)).filter(Boolean) as Rect[];
  }

  /* ─── arc / curved light ray ─── */
  private drawArc(time: number) {
    const drift  = Math.sin((time / ARC_PERIOD_MS) * Math.PI * 2) * ARC_DRIFT_AMPLITUDE;
    const points = this.getArcPoints(drift);
    const path   = new Path2D();

    path.moveTo(points.start.x, points.start.y);
    path.bezierCurveTo(
      points.control1.x, points.control1.y,
      points.control2.x, points.control2.y,
      points.end.x,      points.end.y
    );

    // Outer soft bloom — #298799 teal
    const outerGrad = this.ctx.createLinearGradient(
      points.start.x, points.start.y, points.end.x, points.end.y
    );
    outerGrad.addColorStop(0,   `rgba(${TEAL_BRIGHT}, 0.18)`);
    outerGrad.addColorStop(0.4, `rgba(${TEAL_BRIGHT}, 0.08)`);
    outerGrad.addColorStop(1,   `rgba(${TEAL_MID}, 0)`);

    // Inner glow — slightly brighter teal
    const innerGrad = this.ctx.createLinearGradient(
      points.start.x, points.start.y, points.end.x, points.end.y
    );
    innerGrad.addColorStop(0,    `rgba(${TEAL_BRIGHT}, 0.45)`);
    innerGrad.addColorStop(0.35, `rgba(${TEAL_BRIGHT}, 0.18)`);
    innerGrad.addColorStop(1,    `rgba(${TEAL_MID}, 0)`);

    // Core line — crisp teal
    const coreGrad = this.ctx.createLinearGradient(
      points.start.x, points.start.y, points.end.x, points.end.y
    );
    coreGrad.addColorStop(0,    `rgba(80, 200, 220, 0.88)`);
    coreGrad.addColorStop(0.18, `rgba(${TEAL_BRIGHT}, 0.55)`);
    coreGrad.addColorStop(0.6,  `rgba(${TEAL_BRIGHT}, 0.08)`);
    coreGrad.addColorStop(1,    `rgba(${TEAL_MID}, 0)`);

    this.ctx.save();
    this.ctx.lineCap = "round";

    this.ctx.filter      = "blur(12px)";
    this.ctx.strokeStyle = outerGrad;
    this.ctx.lineWidth   = 22;
    this.ctx.stroke(path);

    this.ctx.filter      = "blur(4px)";
    this.ctx.strokeStyle = innerGrad;
    this.ctx.lineWidth   = 9;
    this.ctx.stroke(path);

    this.ctx.filter      = "none";
    this.ctx.strokeStyle = coreGrad;
    this.ctx.lineWidth   = 1.8;
    this.ctx.stroke(path);

    this.ctx.restore();

    this.drawArcSparks(points);
    return this.calculateArcBounds(points);
  }

  private drawArcSparks(points: ReturnType<SpaceBackground["getArcPoints"]>) {
    this.arcSparks.forEach((spark) => {
      const base    = cubicPoint(points.start, points.control1, points.control2, points.end, spark.t);
      const tangent = cubicDerivative(points.start, points.control1, points.control2, points.end, spark.t);
      const len     = Math.hypot(tangent.x, tangent.y) || 1;
      const nx      = -tangent.y / len;
      const ny      =  tangent.x / len;
      const x       = base.x + nx * spark.offset;
      const y       = base.y + ny * spark.offset;
      const fade    = 1 - spark.t * 0.85;
      const alpha   = clamp(spark.alpha * fade, 0.06, 0.38);

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.fillStyle   = `rgba(${TEAL_BRIGHT}, ${alpha.toFixed(3)})`;
      this.ctx.shadowBlur  = 10;
      this.ctx.shadowColor = `rgba(${TEAL_BRIGHT}, 0.2)`;
      this.ctx.arc(x, y, spark.radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    });
  }

  /* arc path: bottom-right corner → center-left */
  private getArcPoints(drift: number) {
    return {
      start:    { x: this.width * 0.96,  y: this.height * 1.0  + drift },
      control1: { x: this.width * 0.88,  y: this.height * 0.86 + drift * 0.92 },
      control2: { x: this.width * 0.70,  y: this.height * 0.60 + drift * 0.68 },
      end:      { x: this.width * 0.48,  y: this.height * 0.50 + drift * 0.42 },
    };
  }

  private calculateArcBounds(points: ReturnType<SpaceBackground["getArcPoints"]>) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let step = 0; step <= 28; step++) {
      const t = step / 28;
      const p = cubicPoint(points.start, points.control1, points.control2, points.end, t);
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const pad = 48;
    return this.clipRect({ x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 });
  }

  /* ─── dirty-rect helpers ─── */
  private restoreRect(rect: Rect) {
    const c = this.clipRect(rect);
    if (!c) return;
    this.ctx.drawImage(
      this.compositeCanvas,
      c.x * this.dpr, c.y * this.dpr, c.width * this.dpr, c.height * this.dpr,
      c.x, c.y, c.width, c.height
    );
  }

  private drawOverlayRect(rect: Rect) {
    const c = this.clipRect(rect);
    if (!c) return;
    this.ctx.drawImage(
      this.overlayCanvas,
      c.x * this.dpr, c.y * this.dpr, c.width * this.dpr, c.height * this.dpr,
      c.x, c.y, c.width, c.height
    );
  }

  private clipRect(rect: Rect | null): Rect | null {
    if (!rect) return null;
    const x      = clamp(Math.floor(rect.x), 0, this.width);
    const y      = clamp(Math.floor(rect.y), 0, this.height);
    const right  = clamp(Math.ceil(rect.x + rect.width),  0, this.width);
    const bottom = clamp(Math.ceil(rect.y + rect.height), 0, this.height);
    if (right <= x || bottom <= y) return null;
    return { x, y, width: right - x, height: bottom - y };
  }
}

export default SpaceBackground;
