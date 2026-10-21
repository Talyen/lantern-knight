import { z } from 'zod';

const point = z.strictObject({ x: z.number().finite(), z: z.number().finite() });
const heroAction = z.enum(['sword', 'lantern', 'dodge']);
export type HeroAction = z.infer<typeof heroAction>;

// One wire contract for input, simulation and recorded commands. Runtime callers
// already hold typed data; external recordings validate through this schema.
export const CommandSchema = z.strictObject({
  move: point,
  aim: point,
  actions: z.array(heroAction).readonly().optional(),
  generation: z.number().int().nonnegative().optional(),
  potion: z.boolean().optional(),
});
export type Command = z.infer<typeof CommandSchema>;
export type AcceptedCommand = Required<Omit<Command, 'generation'>>;

// Missing or stale commands cannot consume potions or buffer actions.
// Accepted commands are detached copies: callers retain editable drafts while
// simulation owns admitted data, and only known hero actions pass admission.
export function acceptCommand(
  command: Command | undefined,
  generation: number,
  fallbackAim: { x: number; z: number },
): AcceptedCommand {
  if (!command || (command.generation !== undefined && command.generation !== generation))
    return {
      move: { x: 0, z: 0 },
      aim: { x: fallbackAim.x, z: fallbackAim.z },
      actions: [],
      potion: false,
    };
  // Scale before measuring length: two finite components can have an infinite norm.
  const scale = Math.max(1, Math.abs(command.move.x), Math.abs(command.move.z));
  const actions = Array.isArray(command.actions)
    ? command.actions.filter(
        (action): action is HeroAction =>
          action === 'sword' || action === 'lantern' || action === 'dodge',
      )
    : [];
  return {
    move:
      Number.isFinite(command.move.x) && Number.isFinite(command.move.z)
        ? scale > 1
          ? { x: command.move.x / scale, z: command.move.z / scale }
          : { x: command.move.x, z: command.move.z }
        : { x: 0, z: 0 },
    aim:
      Number.isFinite(command.aim.x) && Number.isFinite(command.aim.z)
        ? { x: command.aim.x, z: command.aim.z }
        : { x: fallbackAim.x, z: fallbackAim.z },
    actions: [...actions],
    potion: command.potion === true,
  };
}
