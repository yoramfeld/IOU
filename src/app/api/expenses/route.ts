import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import {
  fetchGroupBalances,
  sortByDebtPriority,
  computeEqualSplitCents,
} from '@/lib/splitAlgorithm'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const groupId = searchParams.get('groupId')
  const memberId = searchParams.get('memberId')

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })
  }

  const data = await sql`
    SELECT
      e.*,
      COALESCE((SELECT json_agg(ep.*) FROM expense_payers ep WHERE ep.expense_id = e.id), '[]'::json) AS payers,
      COALESCE((SELECT json_agg(es.*) FROM expense_splits es WHERE es.expense_id = e.id), '[]'::json) AS splits,
      r.id AS receipt_id,
      r.ocr_status AS receipt_ocr_status,
      (r.id IS NOT NULL) AS has_receipt,
      CASE WHEN ${memberId}::uuid IS NULL THEN false ELSE EXISTS (
        SELECT 1 FROM receipt_reviews rr
        WHERE rr.receipt_id = r.id AND rr.member_id = ${memberId} AND rr.reviewed_at IS NULL
      ) END AS review_pending
    FROM expenses e
    LEFT JOIN receipts r ON r.expense_id = e.id
    WHERE e.group_id = ${groupId}
    ORDER BY e.created_at DESC
  `

  return NextResponse.json(data)
}

interface ReceiptInput {
  imageUrl: string
  cloudinaryPublicId: string
  itemize?: boolean
}

export async function POST(request: Request) {
  const {
    groupId,
    paidBy,
    amount,
    description,
    splitAmong,
    customSplits,
    enteredBy,
    payers,
    receipt,
  } = (await request.json()) as {
    groupId: string
    paidBy: string
    amount: number
    description: string
    splitAmong?: string[]
    customSplits?: { memberId: string; amount: number }[]
    enteredBy: string
    payers?: { memberId: string; amount: number }[]
    receipt?: ReceiptInput
  }

  const hasCustom = Array.isArray(customSplits) && customSplits.length > 0
  if (!groupId || !paidBy || !amount || !description?.trim() || !enteredBy) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (!hasCustom && !splitAmong?.length) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  if (amount <= 0) {
    return NextResponse.json(
      { error: 'Amount must be positive' },
      { status: 400 },
    )
  }

  // Validate payers if provided
  const resolvedPayers: { memberId: string; amount: number }[] =
    Array.isArray(payers) && payers.length > 0
      ? payers
      : [{ memberId: paidBy, amount: Number(amount) }]

  if (resolvedPayers.some((p) => p.amount <= 0)) {
    return NextResponse.json(
      { error: 'Payer amounts must be positive' },
      { status: 400 },
    )
  }

  // Verify enteredBy is a valid member of the group
  if (enteredBy !== paidBy) {
    const entererRows = await sql`
      SELECT id FROM members WHERE id = ${enteredBy} AND group_id = ${groupId} LIMIT 1
    `
    if (entererRows.length === 0) {
      return NextResponse.json(
        { error: 'Not a member of this group' },
        { status: 403 },
      )
    }
  }

  // Create expense (paid_by = primary payer for display)
  const expenseRows = await sql`
    INSERT INTO expenses (group_id, paid_by, amount, description, entered_by)
    VALUES (${groupId}, ${resolvedPayers[0].memberId}, ${Number(amount)}, ${description.trim()}, ${enteredBy})
    RETURNING id
  `
  const expense = expenseRows[0]

  if (!expense) {
    return NextResponse.json(
      { error: 'Failed to create expense' },
      { status: 500 },
    )
  }

  // Insert payers
  for (const p of resolvedPayers) {
    const payerResult = await sql`
      INSERT INTO expense_payers (expense_id, member_id, amount)
      VALUES (${expense.id}, ${p.memberId}, ${Math.round(p.amount * 100) / 100})
    `
    if (!payerResult) {
      await sql`DELETE FROM expenses WHERE id = ${expense.id}`
      return NextResponse.json(
        { error: 'Failed to create payers' },
        { status: 500 },
      )
    }
  }

  // Create splits
  let splits: { memberId: string; amount: number }[]
  const memberIds: string[] = hasCustom
    ? customSplits!.map((s) => s.memberId)
    : splitAmong!

  if (hasCustom) {
    splits = customSplits!.map(({ memberId, amount: a }) => ({
      memberId,
      amount: -Math.round(a * 100) / 100,
    }))
  } else {
    const totalCents = Math.round(Number(amount) * 100)
    const balances = await fetchGroupBalances(groupId, memberIds)
    const priorityOrder = sortByDebtPriority(memberIds, balances)
    const cents = computeEqualSplitCents(totalCents, memberIds, priorityOrder)
    splits = memberIds.map((memberId) => ({
      memberId,
      amount: -cents[memberId] / 100,
    }))
  }

  for (const s of splits) {
    const splitResult = await sql`
      INSERT INTO expense_splits (expense_id, member_id, amount)
      VALUES (${expense.id}, ${s.memberId}, ${s.amount})
    `
    if (!splitResult) {
      await sql`DELETE FROM expenses WHERE id = ${expense.id}`
      return NextResponse.json(
        { error: 'Failed to create splits' },
        { status: 500 },
      )
    }
  }

  let receiptId: string | null = null
  let receiptOcrPending = false

  // Attach the image immediately and let OCR fill items asynchronously after creation.
  // The expense amount and initial split above stay based on the payer-entered total.
  if (receipt) {
    receiptOcrPending = receipt.itemize !== false
    const receiptRows = await sql`
      INSERT INTO receipts (expense_id, image_url, cloudinary_public_id, ocr_status)
      VALUES (${expense.id}, ${receipt.imageUrl}, ${receipt.cloudinaryPublicId}, ${receiptOcrPending ? 'pending' : 'no_items'})
      RETURNING id
    `
    receiptId = receiptRows[0]?.id ?? null
  }

  return NextResponse.json({
    ok: true,
    expenseId: expense.id,
    receiptId,
    receiptOcrPending,
  })
}

export async function DELETE(request: Request) {
  const { expenseId, groupId, adminId, resetAll } = await request.json()

  if (!adminId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Verify admin
  const adminRows =
    await sql`SELECT is_admin FROM members WHERE id = ${adminId} LIMIT 1`
  const admin = adminRows[0]

  if (!admin?.is_admin) {
    return NextResponse.json(
      { error: 'Only admins can delete expenses' },
      { status: 403 },
    )
  }

  // Reset all expenses for a group
  if (resetAll && groupId) {
    await sql`DELETE FROM expenses WHERE group_id = ${groupId}`
    return NextResponse.json({ ok: true })
  }

  // Delete single expense
  if (!expenseId) {
    return NextResponse.json({ error: 'Missing expenseId' }, { status: 400 })
  }

  await sql`DELETE FROM expenses WHERE id = ${expenseId}`

  return NextResponse.json({ ok: true })
}
