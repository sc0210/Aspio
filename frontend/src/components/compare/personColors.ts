/**
 * One colour per person across Savings: the members row, the Compare cards and
 * the Compare chart. Each used to pick by its own list position, so 小明 was
 * blue in the members row and green in Compare.
 *
 * You are always the first colour; partners follow sorted by user id, which
 * every surface knows and which doesn't shift when a list is reordered.
 */
export const PERSON_COLORS = [
  { hex: '#3b82f6', avatar: 'bg-primary-600' }, // blue (you)
  { hex: '#10b981', avatar: 'bg-success-600' }, // green
  { hex: '#f97316', avatar: 'bg-orange-500' }, // orange
  { hex: '#a855f7', avatar: 'bg-purple-600' }, // purple
  { hex: '#ec4899', avatar: 'bg-pink-600' }, // pink
] as const;

const PARTNER_COLORS = PERSON_COLORS.length - 1;

export type PersonColor = (typeof PERSON_COLORS)[number];

/** user id → colour; `selfId` (when known) takes the first. */
export function personColors(userIds: string[], selfId?: string): Map<string, PersonColor> {
  const peers = [...new Set(userIds)].filter((id) => id !== selfId).sort();
  const out = new Map<string, PersonColor>();
  if (selfId) out.set(selfId, PERSON_COLORS[0]);
  // Partners cycle through the partner colours only: never back onto yours.
  peers.forEach((id, i) => out.set(id, PERSON_COLORS[1 + (i % PARTNER_COLORS)]));
  return out;
}
