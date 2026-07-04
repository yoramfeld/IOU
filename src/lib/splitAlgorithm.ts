import { sql } from '@/lib/db'

// Current paid-minus-owed balance per member, used to decide who absorbs leftover cents.
export async function fetchGroupBalances(groupId: string, memberIds: string[]): Promise<Record<string, number>> {
  const [groupPayers, groupSplits] = await Promise.all([
    sql`SELECT ep.member_id, ep.amount FROM expense_payers ep JOIN expenses e ON e.id = ep.expense_id WHERE e.group_id = ${groupId}`,
    sql`SELECT es.member_id, es.amount FROM expense_splits es JOIN expenses e ON e.id = es.expense_id WHERE e.group_id = ${groupId}`,
  ])

  const bal: Record<string, number> = {}
  for (const id of memberIds) bal[id] = 0
  for (const p of groupPayers) {
    if (p.member_id in bal) bal[p.member_id] += Number(p.amount)
  }
  for (const s of groupSplits) {
    if (s.member_id in bal) bal[s.member_id] += Number(s.amount)
  }
  return bal
}

// Ascending by balance (most negative/biggest debtor first), randomizing ties.
export function sortByDebtPriority(memberIds: string[], balances: Record<string, number>): string[] {
  const shuffled = [...memberIds].sort(() => Math.random() - 0.5)
  return shuffled.sort((a, b) => (balances[a] ?? 0) - (balances[b] ?? 0))
}

// Floors each member's raw cent share, then hands out the leftover 1-cent units to the
// front of priorityOrder (ties within a tied balance tier are randomized), so debt never
// silently drifts over time.
export function allocateCents(
  rawShareCents: Record<string, number>,
  totalCents: number,
  priorityOrder: string[],
): Record<string, number> {
  const floored: Record<string, number> = {}
  let flooredSum = 0
  for (const id of priorityOrder) {
    const f = Math.floor(rawShareCents[id] ?? 0)
    floored[id] = f
    flooredSum += f
  }
  const remainder = totalCents - flooredSum

  // priorityOrder is pre-shuffled then sorted by debt (sortByDebtPriority), so ties in
  // balance are already in random relative order — handing the remainder to the front
  // `remainder` entries reproduces the original tier-boundary random tie-break exactly:
  // members in strictly-lower-balance tiers always land ahead of the cutoff regardless
  // of intra-tier order, and only the boundary tier's members depend on (already-random) order.
  const remainderSet = new Set(priorityOrder.slice(0, Math.max(0, remainder)))

  const result: Record<string, number> = {}
  for (const id of priorityOrder) {
    result[id] = floored[id] + (remainderSet.has(id) ? 1 : 0)
  }
  return result
}

export function computeEqualSplitCents(
  totalCents: number,
  memberIds: string[],
  priorityOrder: string[],
): Record<string, number> {
  const n = memberIds.length
  const baseCents = Math.floor(totalCents / n)
  const rawShareCents: Record<string, number> = {}
  for (const id of memberIds) rawShareCents[id] = baseCents
  // allocateCents floors again (no-op here) and distributes totalCents - n*baseCents leftover
  return allocateCents(rawShareCents, totalCents, priorityOrder)
}

export function computeItemizedSplitCents(params: {
  totalCents: number
  items: { amountCents: number; memberIds: string[] }[]
  priorityOrder: string[]
}): Record<string, number> {
  const { totalCents, items, priorityOrder } = params

  const itemsTotalCents = items.reduce((s, it) => s + it.amountCents, 0)
  const sharedCents = totalCents - itemsTotalCents

  const rawShare: Record<string, number> = {}
  for (const id of priorityOrder) rawShare[id] = 0

  for (const item of items) {
    if (item.memberIds.length === 0) continue
    const perMember = item.amountCents / item.memberIds.length
    for (const id of item.memberIds) {
      rawShare[id] = (rawShare[id] ?? 0) + perMember
    }
  }

  if (itemsTotalCents > 0) {
    for (const id of priorityOrder) {
      rawShare[id] += sharedCents * ((rawShare[id] ?? 0) / itemsTotalCents)
    }
  }

  return allocateCents(rawShare, totalCents, priorityOrder)
}
