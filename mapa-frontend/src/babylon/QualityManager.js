export class QualityManager {
  constructor(engine) { this.engine = engine; this.level = this.detect(); this.apply(); }
  detect() {
    if (matchMedia?.("(prefers-reduced-motion: reduce)").matches || innerWidth < 720) return "LOW";
    if ((navigator.hardwareConcurrency || 4) >= 8 && (navigator.deviceMemory || 4) >= 8) return "HIGH";
    return "MEDIUM";
  }
  set(level) { this.level = level; this.apply(); }
  apply() { this.engine.setHardwareScalingLevel(this.level === "HIGH" ? 1 : this.level === "MEDIUM" ? 1.35 : 1.8); }
  get particles() { return this.level === "HIGH" ? 12000 : this.level === "MEDIUM" ? 6500 : 2600; }
  get postProcess() { return this.level !== "LOW"; }
}
