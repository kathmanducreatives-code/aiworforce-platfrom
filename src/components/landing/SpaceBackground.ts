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

const BASE_COLOR = "#050708";
const GRID_SIZE = 130;
const STAR_COUNT = 280;
const PULSE_COUNT = 15;
const ARC_SPARK_COUNT = 46;
const ARC_PERIOD_MS = 8000;
const ARC_DRIFT_AMPLITUDE = 6;
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
  const oneMinusT = 1 - t;
  const oneMinusTSquared = oneMinusT * oneMinusT;
  const tSquared = t * t;

  return {
    x:
      oneMinusTSquared * oneMinusT * p0.x +
      3 * oneMinusTSquared * t * p1.x +
      3 * oneMinusT * tSquared * p2.x +
      tSquared * t * p3.x,
    y:
      oneMinusTSquared * oneMinusT * p0.y +
      3 * oneMinusTSquared * t * p1.y +
      3 * oneMinusT * tSquared * p2.y +
      tSquared * t * p3.y,
  };
};

const cubicDerivative = (
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number
): Point => {
  const oneMinusT = 1 - t;

  return {
    x:
      3 * oneMinusT * oneMinusT * (p1.x - p0.x) +
      6 * oneMinusT * t * (p2.x - p1.x) +
      3 * t * t * (p3.x - p2.x),
    y:
      3 * oneMinusT * oneMinusT * (p1.y - p0.y) +
      6 * oneMinusT * t * (p2.y - p1.y) +
      3 * t * t * (p3.y - p2.y),
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
    const currentArcRect = this.drawArc(time);
    const currentRects = [
      ...currentPulseRects,
      ...(currentArcRect ? [currentArcRect] : []),
    ];

    currentRects.forEach((rect) => this.drawOverlayRect(rect));

    this.previousPulseRects = currentPulseRects;
    this.previousArcRect = currentArcRect;
    this.animationFrame = window.requestAnimationFrame(this.animate);
  };

  constructor(canvasElement: HTMLCanvasElement) {
    const context = canvasElement.getContext("2d", { alpha: true });

    if (!context) {
      throw new Error("SpaceBackground requires a 2D canvas context.");
    }

    this.canvas = canvasElement;
    this.ctx = context;

    this.sceneCanvas = document.createElement("canvas");
    this.overlayCanvas = document.createElement("canvas");
    this.compositeCanvas = document.createElement("canvas");

    const sceneContext = this.sceneCanvas.getContext("2d", { alpha: true });
    const overlayContext = this.overlayCanvas.getContext("2d", { alpha: true });
    const compositeContext = this.compositeCanvas.getContext("2d", { alpha: true });

    if (!sceneContext || !overlayContext || !compositeContext) {
      throw new Error("SpaceBackground could not initialize offscreen buffers.");
    }

    this.sceneCtx = sceneContext;
    this.overlayCtx = overlayContext;
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
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

    this.resizeCanvas(this.canvas, this.ctx, true);
    this.resizeCanvas(this.sceneCanvas, this.sceneCtx);
    this.resizeCanvas(this.overlayCanvas, this.overlayCtx);
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

  private configureCanvas() {
    Object.assign(this.canvas.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      pointerEvents: "none",
      zIndex: "-1",
    });

    this.canvas.setAttribute("aria-hidden", "true");
  }

  private resizeCanvas(
    targetCanvas: HTMLCanvasElement,
    targetCtx: CanvasRenderingContext2D,
    applyDomSizing = false
  ) {
    targetCanvas.width = Math.max(1, Math.floor(this.width * this.dpr));
    targetCanvas.height = Math.max(1, Math.floor(this.height * this.dpr));

    if (applyDomSizing) {
      targetCanvas.style.width = `${this.width}px`;
      targetCanvas.style.height = `${this.height}px`;
    }

    targetCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    targetCtx.imageSmoothingEnabled = true;
  }

  private seedScene() {
    if (this.staticParticles.length || this.pulsingParticles.length || this.arcSparks.length) {
      return;
    }

    const rng = mulberry32(20260326);
    const pulseIndices = new Set<number>();

    while (pulseIndices.size < PULSE_COUNT) {
      pulseIndices.add(Math.floor(rng() * STAR_COUNT));
    }

    for (let index = 0; index < STAR_COUNT; index += 1) {
      const centerRightWeighted = index >= 170;
      const xRatio = centerRightWeighted ? 0.44 + rng() * 0.5 : rng();
      const yRatio = centerRightWeighted ? 0.14 + rng() * 0.62 : rng();
      const particle: ParticleSeed = {
        xRatio,
        yRatio,
        radius: 0.3 + rng() * 0.9,
        alpha: 0.15 + rng() * 0.4,
        tint: rng() > 0.68 ? "teal" : "white",
      };

      if (pulseIndices.has(index)) {
        this.pulsingParticles.push({
          ...particle,
          minAlpha: 0.1,
          maxAlpha: 0.24 + rng() * 0.26,
          durationMs: 3000 + rng() * 3000,
          phase: rng() * Math.PI * 2,
        });
      } else {
        this.staticParticles.push(particle);
      }
    }

    for (let index = 0; index < ARC_SPARK_COUNT; index += 1) {
      this.arcSparks.push({
        t: clamp(0.08 + (index / (ARC_SPARK_COUNT - 1)) * 0.88 + (rng() - 0.5) * 0.03, 0.04, 0.98),
        offset: (rng() - 0.5) * 18,
        radius: 0.55 + rng() * 1.05,
        alpha: 0.18 + rng() * 0.28,
      });
    }
  }

  private drawStaticScene() {
    this.sceneCtx.clearRect(0, 0, this.width, this.height);
    this.sceneCtx.fillStyle = BASE_COLOR;
    this.sceneCtx.fillRect(0, 0, this.width, this.height);

    this.drawGrid(this.sceneCtx);
    this.drawNebula(this.sceneCtx);
    this.drawTopLeftGhost(this.sceneCtx);
    this.drawStaticParticles(this.sceneCtx);
  }

  private drawOverlay() {
    this.overlayCtx.clearRect(0, 0, this.width, this.height);

    const vignette = this.overlayCtx.createRadialGradient(
      this.width * 0.5,
      this.height * 0.5,
      Math.min(this.width, this.height) * 0.18,
      this.width * 0.5,
      this.height * 0.5,
      Math.max(this.width, this.height) * 0.78
    );

    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.5)");

    this.overlayCtx.fillStyle = vignette;
    this.overlayCtx.fillRect(0, 0, this.width, this.height);
  }

  private composeStaticBuffers() {
    this.compositeCtx.clearRect(0, 0, this.width, this.height);
    this.compositeCtx.drawImage(
      this.sceneCanvas,
      0,
      0,
      this.sceneCanvas.width,
      this.sceneCanvas.height,
      0,
      0,
      this.width,
      this.height
    );
    this.compositeCtx.drawImage(
      this.overlayCanvas,
      0,
      0,
      this.overlayCanvas.width,
      this.overlayCanvas.height,
      0,
      0,
      this.width,
      this.height
    );
  }

  private renderFullFrame() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(
      this.compositeCanvas,
      0,
      0,
      this.compositeCanvas.width,
      this.compositeCanvas.height,
      0,
      0,
      this.width,
      this.height
    );

    const now = performance.now();
    const pulseRects = this.drawPulsingParticles(now);
    const arcRect = this.drawArc(now);
    const currentRects = [
      ...pulseRects,
      ...(arcRect ? [arcRect] : []),
    ];

    currentRects.forEach((rect) => this.drawOverlayRect(rect));
    this.previousPulseRects = pulseRects;
    this.previousArcRect = arcRect;
  }

  private drawGrid(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.strokeStyle = "rgba(16, 185, 129, 0.04)";
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

  private drawStaticParticles(ctx: CanvasRenderingContext2D) {
    this.staticParticles.forEach((particle) => {
      const x = particle.xRatio * this.width;
      const y = particle.yRatio * this.height;
      const color =
        particle.tint === "teal"
          ? `rgba(52, 211, 153, ${particle.alpha.toFixed(3)})`
          : `rgba(255, 255, 255, ${particle.alpha.toFixed(3)})`;

      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(x, y, particle.radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private drawNebula(ctx: CanvasRenderingContext2D) {
    const centerX = this.width * 0.68;
    const centerY = this.height * 0.45;
    const radius = clamp(Math.min(this.width, this.height) * 0.3, 240, 320);
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);

    gradient.addColorStop(0, "rgba(16, 185, 129, 0.10)");
    gradient.addColorStop(1, "rgba(5, 150, 105, 0)");

    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    ctx.restore();
  }

  private drawTopLeftGhost(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.filter = "blur(54px)";
    ctx.fillStyle = "rgba(5, 150, 105, 0.07)";
    ctx.fillRect(-this.width * 0.02, -this.height * 0.02, this.width * 0.17, this.height * 0.17);
    ctx.restore();
  }

  private drawPulsingParticles(time: number) {
    const bounds: Rect[] = [];

    this.pulsingParticles.forEach((particle) => {
      const x = particle.xRatio * this.width;
      const y = particle.yRatio * this.height;
      const progress = ((time + particle.phase * 1000) % particle.durationMs) / particle.durationMs;
      const eased = (Math.sin(progress * Math.PI * 2) + 1) * 0.5;
      const alpha = particle.minAlpha + (particle.maxAlpha - particle.minAlpha) * eased;
      const color =
        particle.tint === "teal"
          ? `rgba(52, 211, 153, ${alpha.toFixed(3)})`
          : `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
      const radius = Math.max(1.8, particle.radius + 2.5);

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.fillStyle = color;
      this.ctx.shadowBlur = particle.tint === "teal" ? 8 : 4;
      this.ctx.shadowColor =
        particle.tint === "teal"
          ? "rgba(16, 185, 129, 0.22)"
          : "rgba(255, 255, 255, 0.1)";
      this.ctx.arc(x, y, particle.radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();

      bounds.push({
        x: x - radius,
        y: y - radius,
        width: radius * 2,
        height: radius * 2,
      });
    });

    return bounds.map((rect) => this.clipRect(rect)).filter(Boolean) as Rect[];
  }

  private drawArc(time: number) {
    const drift = Math.sin((time / ARC_PERIOD_MS) * Math.PI * 2) * ARC_DRIFT_AMPLITUDE;
    const points = this.getArcPoints(drift);
    const path = new Path2D();

    path.moveTo(points.start.x, points.start.y);
    path.bezierCurveTo(
      points.control1.x,
      points.control1.y,
      points.control2.x,
      points.control2.y,
      points.end.x,
      points.end.y
    );

    const outerGradient = this.ctx.createLinearGradient(
      points.start.x,
      points.start.y,
      points.end.x,
      points.end.y
    );
    outerGradient.addColorStop(0, "rgba(16, 185, 129, 0.18)");
    outerGradient.addColorStop(0.4, "rgba(5, 150, 105, 0.08)");
    outerGradient.addColorStop(1, "rgba(5, 150, 105, 0)");

    const innerGradient = this.ctx.createLinearGradient(
      points.start.x,
      points.start.y,
      points.end.x,
      points.end.y
    );
    innerGradient.addColorStop(0, "rgba(16, 185, 129, 0.45)");
    innerGradient.addColorStop(0.35, "rgba(16, 185, 129, 0.16)");
    innerGradient.addColorStop(1, "rgba(5, 150, 105, 0)");

    const coreGradient = this.ctx.createLinearGradient(
      points.start.x,
      points.start.y,
      points.end.x,
      points.end.y
    );
    coreGradient.addColorStop(0, "rgba(52, 211, 153, 0.95)");
    coreGradient.addColorStop(0.18, "rgba(16, 185, 129, 0.60)");
    coreGradient.addColorStop(0.6, "rgba(5, 150, 105, 0.08)");
    coreGradient.addColorStop(1, "rgba(5, 150, 105, 0)");

    this.ctx.save();
    this.ctx.lineCap = "round";

    this.ctx.filter = "blur(10px)";
    this.ctx.strokeStyle = outerGradient;
    this.ctx.lineWidth = 20;
    this.ctx.stroke(path);

    this.ctx.filter = "blur(4px)";
    this.ctx.strokeStyle = innerGradient;
    this.ctx.lineWidth = 8;
    this.ctx.stroke(path);

    this.ctx.filter = "none";
    this.ctx.strokeStyle = coreGradient;
    this.ctx.lineWidth = 2;
    this.ctx.stroke(path);
    this.ctx.restore();

    this.drawArcSparks(points);

    return this.calculateArcBounds(points);
  }

  private drawArcSparks(points: ReturnType<SpaceBackground["getArcPoints"]>) {
    this.arcSparks.forEach((spark) => {
      const basePoint = cubicPoint(
        points.start,
        points.control1,
        points.control2,
        points.end,
        spark.t
      );
      const tangent = cubicDerivative(
        points.start,
        points.control1,
        points.control2,
        points.end,
        spark.t
      );
      const tangentLength = Math.hypot(tangent.x, tangent.y) || 1;
      const normalX = -tangent.y / tangentLength;
      const normalY = tangent.x / tangentLength;
      const x = basePoint.x + normalX * spark.offset;
      const y = basePoint.y + normalY * spark.offset;
      const fade = 1 - spark.t * 0.88;
      const alpha = clamp(spark.alpha * fade, 0.08, 0.42);

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.fillStyle = `rgba(167, 243, 208, ${alpha.toFixed(3)})`;
      this.ctx.shadowBlur = 10;
      this.ctx.shadowColor = "rgba(16, 185, 129, 0.22)";
      this.ctx.arc(x, y, spark.radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    });
  }

  private getArcPoints(drift: number) {
    return {
      start: { x: this.width * 0.95, y: this.height * 1.0 + drift },
      control1: { x: this.width * 0.9, y: this.height * 0.88 + drift * 0.95 },
      control2: { x: this.width * 0.73, y: this.height * 0.62 + drift * 0.7 },
      end: { x: this.width * 0.55, y: this.height * 0.55 + drift * 0.45 },
    };
  }

  private calculateArcBounds(points: ReturnType<SpaceBackground["getArcPoints"]>) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let step = 0; step <= 28; step += 1) {
      const t = step / 28;
      const point = cubicPoint(points.start, points.control1, points.control2, points.end, t);
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }

    const padding = 46;

    return this.clipRect({
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    });
  }

  private restoreRect(rect: Rect) {
    const clipped = this.clipRect(rect);

    if (!clipped) return;

    this.ctx.drawImage(
      this.compositeCanvas,
      clipped.x * this.dpr,
      clipped.y * this.dpr,
      clipped.width * this.dpr,
      clipped.height * this.dpr,
      clipped.x,
      clipped.y,
      clipped.width,
      clipped.height
    );
  }

  private drawOverlayRect(rect: Rect) {
    const clipped = this.clipRect(rect);

    if (!clipped) return;

    this.ctx.drawImage(
      this.overlayCanvas,
      clipped.x * this.dpr,
      clipped.y * this.dpr,
      clipped.width * this.dpr,
      clipped.height * this.dpr,
      clipped.x,
      clipped.y,
      clipped.width,
      clipped.height
    );
  }

  private clipRect(rect: Rect | null) {
    if (!rect) return null;

    const x = clamp(Math.floor(rect.x), 0, this.width);
    const y = clamp(Math.floor(rect.y), 0, this.height);
    const right = clamp(Math.ceil(rect.x + rect.width), 0, this.width);
    const bottom = clamp(Math.ceil(rect.y + rect.height), 0, this.height);

    if (right <= x || bottom <= y) {
      return null;
    }

    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
    };
  }
}

export default SpaceBackground;
