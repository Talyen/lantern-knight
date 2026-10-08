import type { Clip } from '../assets/schema';
import { clipTime } from './animation';
export const animationTreatments = {
  original: {
    label: 'Original · held frames',
    description: 'Held drawings with the selected timing.',
  },
  guarded: {
    label: 'Guarded motion warp',
    description:
      'Registered guarded motion and rigid sword protection. Incompatible poses retain authored holds.',
    motion: true,
    guarded: true,
  },
} as const;
export type AnimationTreatment = keyof typeof animationTreatments;
export type TransitionTiming = {
  from: string;
  to: string;
  holdFraction?: number;
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'smoothstep';
};
export type FrameBlend = {
  from: string;
  to: string;
  mix: number;
  motion: boolean;
  guarded: boolean;
};
export function transitionMix(
  phase: number,
  timing?: Pick<TransitionTiming, 'holdFraction' | 'easing'>,
) {
  const hold = timing?.holdFraction ?? 0,
    t = Math.max(0, Math.min(1, (phase - hold) / (1 - hold)));
  switch (timing?.easing) {
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'smoothstep':
      return t * t * (3 - 2 * t);
    default:
      return t;
  }
}
export function sampleAnimation(
  clip: Clip,
  timeMs: number,
  mode: AnimationTreatment,
  transitions?: readonly TransitionTiming[],
): FrameBlend {
  const time = clipTime(clip, timeMs);
  const guarded = mode === 'guarded';
  let start = 0;
  for (let i = 0; i < clip.frames.length; i++) {
    const hold = clip.durationsMs[i]!;
    if (time < start + hold - 1e-7 || i === clip.frames.length - 1) {
      let mix = (time - start) / hold;
      const next = clip.loop
        ? (i + 1) % clip.frames.length
        : Math.min(i + 1, clip.frames.length - 1);
      mix =
        mode === 'original'
          ? 0
          : transitionMix(
              mix,
              transitions?.find((p) => p.from === clip.frames[i] && p.to === clip.frames[next]),
            );
      return { from: clip.frames[i]!, to: clip.frames[next]!, mix, motion: guarded, guarded };
    }
    start += hold;
  }
  throw new Error('walk blend requires a valid clip');
}
