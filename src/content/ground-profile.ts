import { z } from 'zod';
import { GroundInteractionSchema, resizeGroundInteraction } from './ground-interaction';

export const GroundProfileSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1).max(80),
    floor: z
      .object({
        width: z.number().positive().max(100).finite(),
        depth: z.number().positive().max(100).finite(),
      })
      .strict(),
    interaction: GroundInteractionSchema,
  })
  .strict();
export type GroundProfile = z.infer<typeof GroundProfileSchema>;

/** Reassignment is explicit; changed images need an alignment review. */
export function restoreGroundProfile(
  profile: GroundProfile,
  identity: Pick<GroundProfile['interaction'], 'asset' | 'frame' | 'hash' | 'dimensions'>,
  floor: GroundProfile['floor'],
  reviewed: boolean,
) {
  const sameArtwork =
    profile.interaction.hash === identity.hash &&
    profile.interaction.dimensions.every((n, i) => n === identity.dimensions[i]);
  if (!sameArtwork && !reviewed)
    throw new Error('Artwork changed. Enable alignment review before reassigning this profile.');
  const interaction = structuredClone(profile.interaction);
  if (profile.floor.width !== floor.width || profile.floor.depth !== floor.depth)
    resizeGroundInteraction(interaction, profile.floor, floor);
  interaction.asset = identity.asset;
  interaction.frame = identity.frame;
  interaction.hash = identity.hash;
  interaction.dimensions = [...identity.dimensions];
  return interaction;
}
