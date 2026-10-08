import type { Simulation } from './core/simulation';
import type { Presentation, Mode } from './presentation/scene';
import type { Manifest } from './assets/schema';
import type { GameSession } from './core/session';
import type { Persistence } from './core/persistence';
import type { PresentationEvent } from './core/events';
import type { GameSave } from './core/save';
export type Stats = ReturnType<Presentation['stats']>;
export type BenchmarkResult = {
  frames: number[];
  stats: Stats;
  droppedMs: number;
  simulatedTicks: number;
};
export interface FoundationInspection {
  readonly session: GameSession;
  readonly persistence: Persistence;
  readonly eventHistory: readonly PresentationEvent[];
  readonly ready: boolean;
  readonly sim: Simulation;
  readonly presentation: Presentation;
  readonly manifest: Manifest;
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
