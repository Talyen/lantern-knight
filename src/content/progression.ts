export const forgeChoices = {
  sword: { name: 'Temper Sword', attribute: 'Edge' },
  lantern: { name: 'Rekindle Lantern', attribute: 'Ember' },
} as const;
export type ForgeUpgrade = keyof typeof forgeChoices;
export const forgeCost = { gold: 20, iron: 4, 'workshop-temper': 1 } as const;
export function kitAttributes(upgrade?: ForgeUpgrade) {
  return { edge: upgrade === 'sword' ? 200 : 100, ember: upgrade === 'lantern' ? 200 : 100 };
}
export function scaledDamage(base: number, percent: number) {
  return Math.max(1, Math.round((base * percent) / 100));
}
