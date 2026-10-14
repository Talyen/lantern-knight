import type { SimulationView } from './core/simulation-view';
import type { SessionView } from './core/session';
import type { Lesson } from './core/onboarding';
const openingHook = 'Beyond the abandoned orchard, another fire still burns. Find the forest path.';
export function openingGuidance(sim: SimulationView, session: SessionView) {
  const orchard = sim.area === 'abandoned-orchard',
    clearing = sim.area === 'forest-gathering-clearing';
  if (!orchard && !clearing) return { objective: '', hint: undefined };
  const fire = sim.areaDefinition.campfires?.[0];
  const chest = sim.areaDefinition.interactables?.find((o) => o.kind === 'container');
  const foundFire = !!fire && session.discovered.has(sim.area + '/' + fire.id);
  const explored =
    !!chest && sim.claimedObjects.has(chest.id) && !sim.drops.some((d) => d.source === chest.id);
  const objective = orchard
    ? 'Find the forest path.'
    : !foundFire
      ? 'Discover the clearing campfire.'
      : !explored
        ? 'Explore the ruins.'
        : 'Return to a campfire to rest or travel.';
  const available = (id: Lesson) =>
    !session.onboarding.completed.includes(id) && !session.onboarding.dismissed.includes(id);
  const near = (p: { x: number; z: number }, radius: number) =>
    Math.hypot(p.x - sim.hero.x, p.z - sim.hero.z) <= radius;
  const hint = (id: Lesson, text: string) => ({ id, text });
  if (sim.hero.health <= 0) return { objective, hint: undefined };
  if (
    available('potion') &&
    (session.inventory['health-potion'] ?? 0) > 0 &&
    sim.maxHealth - sim.hero.health >= 40
  )
    return { objective, hint: hint('potion', 'Q · Drink a Health Potion to restore 40 health.') };
  if (available('inventory') && (session.inventory['orchard-ring'] ?? 0) > 0 && !sim.inCombat)
    return {
      objective,
      hint: hint(
        'inventory',
        'I · Equip the Orchard Ring for +10 maximum health. Equipping does not heal.',
      ),
    };
  const enemies = sim.enemies.filter((a) => a.health > 0 && near(a, 4));
  if (available('lantern') && enemies.length >= 2)
    return {
      objective,
      hint: hint(
        'lantern',
        'RMB · Lift the lantern to burst around you. Stagger creates space; Burn keeps dealing damage.',
      ),
    };
  if (available('dodge') && enemies.length > 0)
    return {
      objective,
      hint: hint(
        'dodge',
        'Watch the enemy windup. Shift · Dodge. Your own strike finishes before a queued dodge starts.',
      ),
    };
  if (
    available('sword') &&
    sim.areaDefinition.interactables?.some(
      (o) => o.kind === 'breakable' && !sim.claimedObjects.has(o.id) && near(o, 3),
    )
  )
    return {
      objective,
      hint: hint(
        'sword',
        'Mouse · Aim at the crate. LMB · Sword. E · Collect the supplies it drops.',
      ),
    };
  if (orchard && available('hook') && !sim.inCombat)
    return { objective, hint: hint('hook', openingHook + ' WASD · Move.') };
  if (fire && near(fire, 2) && available('campfire') && !sim.inCombat)
    return {
      objective,
      hint: hint(
        'campfire',
        'E · Visit the campfire. Rest heals and resets enemies; collected loot stays yours. Potions do not refill.',
      ),
    };
  if (available('travel') && session.discovered.size > 1 && fire && near(fire, 2) && !sim.inCombat)
    return {
      objective,
      hint: hint('travel', 'E · Visit the campfire to travel between discovered fires.'),
    };
  return { objective, hint: undefined };
}
