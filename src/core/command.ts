import { z } from 'zod';

const point = z.strictObject({ x: z.number().finite(), z: z.number().finite() });
const heroAction = z.enum(['sword', 'lantern', 'dodge']);
export type HeroAction = z.infer<typeof heroAction>;

// One wire contract for input, simulation and recorded commands. Runtime callers
// already hold typed data; external recordings validate through this schema.
export const CommandSchema = z.strictObject({
  move: point,
  aim: point,
  attack: z.boolean().optional(),
  dodge: z.boolean().optional(),
  ability: z.boolean().optional(),
  actions: z.array(heroAction).optional(),
  generation: z.number().int().nonnegative().optional(),
  potion: z.boolean().optional(),
});
export type Command = Omit<z.infer<typeof CommandSchema>, 'actions'> & {
  actions?: readonly HeroAction[];
};
export type AcceptedCommand = {
  move: { x: number; z: number };
  aim: { x: number; z: number };
  actions: readonly HeroAction[];
  potion: boolean;
};

// Adapt legacy action flags exactly once. An explicit ordered action list wins,
// including an empty list; stale commands cannot consume potions or buffer actions.
export function acceptCommand(
  command: Command | undefined,
  generation: number,
  fallbackAim: { x: number; z: number },
): AcceptedCommand {
  if (!command || (command.generation !== undefined && command.generation !== generation))
    return { move: { x: 0, z: 0 }, aim: fallbackAim, actions: [], potion: false };
  return {
    move:
      Number.isFinite(command.move.x) && Number.isFinite(command.move.z)
        ? command.move
        : { x: 0, z: 0 },
    aim:
      Number.isFinite(command.aim.x) && Number.isFinite(command.aim.z) ? command.aim : fallbackAim,
    actions: command.actions ?? [
      ...(command.attack ? ['sword' as const] : []),
      ...(command.ability ? ['lantern' as const] : []),
      ...(command.dodge ? ['dodge' as const] : []),
    ],
    potion: command.potion ?? false,
  };
}
