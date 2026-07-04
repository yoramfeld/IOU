import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { fetchGroupBalances, sortByDebtPriority, computeItemizedSplitCents } from '@/lib/splitAlgorithm'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const { receiptId, memberId, itemStates } = await request.json() as {
    receiptId: string
    memberId: string
    itemStates: { itemId: string; included: boolean }[]
  }

  if (!receiptId || !memberId || !Array.isArray(itemStates)) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const receiptRows = await sql`
    SELECT r.id, e.id AS expense_id, e.amount, e.group_id
    FROM receipts r
    JOIN expenses e ON e.id = r.expense_id
    WHERE r.id = ${receiptId}
    LIMIT 1
  `
  const receipt = receiptRows[0]
  if (!receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }

  const reviewRows = await sql`
    SELECT id FROM receipt_reviews WHERE receipt_id = ${receiptId} AND member_id = ${memberId} LIMIT 1
  `
  if (reviewRows.length === 0) {
    return NextResponse.json({ error: 'Not a participant on this receipt' }, { status: 403 })
  }

  // Every participant on the expense, seeded into receipt_reviews at creation time.
  const participantRows = await sql`SELECT member_id FROM receipt_reviews WHERE receipt_id = ${receiptId}`
  const participantIds: string[] = participantRows.map(r => r.member_id)

  const currentMemberRows = await sql`
    SELECT rim.item_id, rim.member_id
    FROM receipt_item_members rim
    JOIN receipt_items ri ON ri.id = rim.item_id
    WHERE ri.receipt_id = ${receiptId}
  `
  const membersByItem = new Map<string, Set<string>>()
  for (const row of currentMemberRows) {
    if (!membersByItem.has(row.item_id)) membersByItem.set(row.item_id, new Set())
    membersByItem.get(row.item_id)!.add(row.member_id)
  }

  // Apply this member's requested diff in memory first, so we can validate before writing.
  for (const state of itemStates) {
    const set = membersByItem.get(state.itemId) ?? new Set<string>()
    if (state.included) set.add(memberId)
    else set.delete(memberId)
    membersByItem.set(state.itemId, set)
  }

  for (const [itemId, members] of Array.from(membersByItem.entries())) {
    if (members.size === 0) {
      return NextResponse.json({ error: `Cannot remove the last member from an item (${itemId})` }, { status: 400 })
    }
  }

  // Persist the diff.
  for (const state of itemStates) {
    if (state.included) {
      await sql`
        INSERT INTO receipt_item_members (item_id, member_id)
        VALUES (${state.itemId}, ${memberId})
        ON CONFLICT (item_id, member_id) DO NOTHING
      `
    } else {
      await sql`DELETE FROM receipt_item_members WHERE item_id = ${state.itemId} AND member_id = ${memberId}`
    }
  }

  // Recompute the expense's splits from the updated item/member state.
  const itemRows = await sql`SELECT id, amount FROM receipt_items WHERE receipt_id = ${receiptId}`
  const items = itemRows.map(row => ({
    amountCents: Math.round(Number(row.amount) * 100),
    memberIds: Array.from(membersByItem.get(row.id) ?? []),
  }))

  const totalCents = Math.round(Number(receipt.amount) * 100)
  const balances = await fetchGroupBalances(receipt.group_id, participantIds)
  const priorityOrder = sortByDebtPriority(participantIds, balances)
  const cents = computeItemizedSplitCents({ totalCents, items, priorityOrder })

  for (const id of participantIds) {
    await sql`
      UPDATE expense_splits SET amount = ${-cents[id] / 100}
      WHERE expense_id = ${receipt.expense_id} AND member_id = ${id}
    `
  }

  await sql`
    UPDATE receipt_reviews SET reviewed_at = now()
    WHERE receipt_id = ${receiptId} AND member_id = ${memberId}
  `

  return NextResponse.json({ ok: true })
}
