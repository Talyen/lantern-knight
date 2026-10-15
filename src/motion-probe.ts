export type MotionSample = {
  ms: number;
  tick: number;
  steps: number;
  alpha: number;
  heroX: number;
  heroZ: number;
  cameraX: number;
  cameraZ: number;
  landmarkX: number;
  landmarkY: number;
};
// Opt-in development recording; bounded and absent from normal frame work.
export class MotionProbe {
  private samples: MotionSample[] = [];
  record(sample: MotionSample) {
    this.samples.push(sample);
    if (this.samples.length > 1800) this.samples.shift();
  }
  snapshot() {
    const samples = this.samples.map((s) => ({ ...s }));
    const times = samples.map((s) => s.ms).sort((a, b) => a - b);
    const percentile = (p: number) =>
      times[Math.min(times.length - 1, Math.floor(times.length * p))] ?? 0;
    const elapsed = samples.reduce((sum, s) => sum + s.ms, 0);
    return {
      frames: samples.length,
      fps: elapsed ? (samples.length * 1000) / elapsed : 0,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      samples,
    };
  }
}
