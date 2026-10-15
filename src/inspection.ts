import type { SimulationView } from './core/simulation-view';
import type { Presentation, Mode } from './presentation/scene';
import type { Manifest } from './assets/schema';
import type { SessionView } from './core/session';
import type { Persistence } from './persistence';
import type { PresentationEvent } from './core/events';
import type { GameSave } from './core/save';
type Stats = ReturnType<Presentation['stats']>;
type BenchmarkResult = {
  frames: number[];
  stats: Stats;
  droppedMs: number;
  simulatedTicks: number;
};
interface FoundationInspection {
  readonly session: SessionView;
  readonly persistence: Persistence['view'];
  readonly eventHistory: readonly PresentationEvent[];
  readonly ready: boolean;
  readonly sim: SimulationView;
  readonly presentation: Presentation;
  readonly manifest: Manifest;
  editPreview(work: (sim: import('./core/simulation').Simulation) => undefined): void;
  fixture(area: string): Promise<void>;
  mode(mode: Mode): void;
  pause(value: boolean): void;
  reset(): Promise<void>;
  stats(): Stats;
  saveValue(): GameSave;
  startBenchmark(stress?: boolean): Promise<void>;
  beginBenchmarkMeasurement(): void;
  finishBenchmark(restoreSession?: boolean): Promise<BenchmarkResult>;
  dispose(): void;
}
declare global {
  interface Window {
    foundation: FoundationInspection;
  }
}
