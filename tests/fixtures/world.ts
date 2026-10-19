import type { AuthoredGameplay } from '../../src/content/authored-gameplay';
import type { PropDefinition } from '../../src/content/world';

type Interactable = NonNullable<AuthoredGameplay['interactables']>[number];

// Collision scenarios specify their geometry; unrelated wall rendering defaults
// stay stable when production scenery changes.
export function boxProp(
  fields: Required<Pick<PropDefinition, 'id' | 'size'>> & Partial<PropDefinition>,
): PropDefinition {
  return { kind: 'wall', shape: 'box', x: 0, z: 0, radius: 0.1, height: 1, ...fields };
}

export function interactable(
  fields: Pick<Interactable, 'id' | 'object'> & Partial<Interactable>,
): Interactable {
  return {
    kind: 'container',
    x: 0,
    z: 0,
    rewards: [],
    idle: 'idle',
    action: 'open',
    spent: 'looted',
    ...fields,
  };
}
