import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const groupId = searchParams.get('groupId')

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })
  }

  const data = await sql`
    SELECT
      e.*,
      COALESCE((SELECT json_agg(ep.*) FROM expense_payers ep WHERE ep.expense_id = e.id), '[]'::json) AS payers,
      COALESCE((SELECT json_agg(es.*) FROM expense_splits es WHERE es.expense_id = e.id), '[]'::json) AS splits
    FROM expenses e
    WHERE e.group_id = ${groupId}
    ORDER BY e.created_at DESC
  `

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}

export async function POST(request: Request) {
  const { groupId, paidBy, amount, description, splitAmong, customSplits, enteredBy, payers } = await request.json()

  const hasCustom = Array.isArray(customSplits) && customSplits.length > 0
  if (!groupId || !paidBy || !amount || !description?.trim() || !enteredBy) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (!hasCustom && !splitAmong?.length) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  if (amount <= 0) {
    return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })
  }

  // Validate payers if provided
  const resolvedPayers: { memberId: string; amount: number }[] = Array.isArray(payers) && payers.length > 0
    ? payers
    : [{ memberId: paidBy, amount: Number(amount) }]

  if (resolvedPayers.some(p => p.amount <= 0)) {
    return NextResponse.json({ error: 'Payer amounts must be positive' }, { status: 400 })
  }

  // Verify enteredBy is a valid member of the group
  if (enteredBy !== paidBy) {
    const entererRows = await sql`
      SELECT id FROM members WHERE id = ${enteredBy} AND group_id = ${groupId} LIMIT 1
    `
    if (entererRows.length === 0) {
      return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 })
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
    return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 })
  }

  // Insert payers
  for (const p of resolvedPayers) {
    const payerResult = await sql`
      INSERT INTO expense_payers (expense_id, member_id, amount)
      VALUES (${expense.id}, ${p.memberId}, ${Math.round(p.amount * 100) / 100})
    `
    if (!payerResult) {
      await sql`DELETE FROM expenses WHERE id = ${expense.id}`
      return NextResponse.json({ error: 'Failed to create payers' }, { status: 500 })
    }
  }

  // Create splits
  let splits: { memberId: string; amount: number }[]

  if (hasCustom) {
    splits = customSplits.map(({ memberId, amount: a }: { memberId: string; amount: number }) => ({
      memberId,
      amount: -Math.round(a * 100) / 100,
    }))
  } else {
    const totalCents = Math.round(Number(amount) * 100)
    const n = splitAmong.length
    const baseCents = Math.floor(totalCents / n)
    const remainder = totalCents - baseCents * n

    // Determine which members absorb the remainder cents.
    const remainderSet = new Set<string>()
    if (remainder > 0) {
      const [groupPayers, groupSplits, groupMembers] = await Promise.all([
        sql`SELECT ep.member_id, ep.amount FROM expense_payers ep JOIN expenses e ON e.id = ep.expense_id WHERE e.group_id = ${groupId}`,
        sql`SELECT es.member_id, es.amount FROM expense_splits es JOIN expenses e ON e.id = es.expense_id WHERE e.group_id = ${groupId}`,
        sql`SELECT id, starting_balance FROM members WHERE group_id = ${groupId}`,
      ])

      const startBals: Record<string, number> = {}
      for (const m of groupMembers) startBals[m.id] = Number(m.starting_balance || 0)

      const bal: Record<string, number> = {}
      for (const id of splitAmong) bal[id] = startBals[id] || 0
      for (const p of groupPayers) {
        if (p.member_id in bal) bal[p.member_id] += Number(p.amount)
      }
      for (const s of groupSplits) {
        if (s.member_id in bal) bal[s.member_id] += Number(s.amount)
      }

      // Sort ascending: most negative balance = owes most
      const sorted = [...splitAmong].sort((a: string, b: string) => bal[a] - bal[b])

      let assigned = 0
      let i = 0
      while (assigned < remainder && i < sorted.length) {
        const tierBal = bal[sorted[i]]
        let j = i
        while (j < sorted.length && bal[sorted[j]] === tierBal) j++
        const tier = sorted.slice(i, j)
        const needed = remainder - assigned
        if (tier.length <= needed) {
          for (const id of tier) remainderSet.add(id)
          assigned += tier.length
        } else {
          // Randomize within the tied tier
          const shuffled = [...tier].sort(() => Math.random() - 0.5)
          for (const id of shuffled.slice(0, needed)) remainderSet.add(id)
          assigned = remainder
        }
        i = j
      }
    }

    splits = splitAmong.map((memberId: string) => ({
      memberId,
      amount: -(baseCents + (remainderSet.has(memberId) ? 1 : 0)) / 100,
    }))
  }

  for (const s of splits) {
    const splitResult = await sql`
      INSERT INTO expense_splits (expense_id, member_id, amount)
      VALUES (${expense.id}, ${s.memberId}, ${s.amount})
    `
    if (!splitResult) {
      await sql`DELETE FROM expenses WHERE id = ${expense.id}`
      return NextResponse.json({ error: 'Failed to create splits' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

export async function PUT(request: Request) {
  const { expenseId, adminId, description, amount, payers, splitAmong, customSplits } = await request.json()

  if (!expenseId || !adminId || !description?.trim() || !amount) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (amount <= 0) {
    return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })
  }

  // Verify admin
  const adminRows = await sql`SELECT is_admin, group_id FROM members WHERE id = ${adminId} LIMIT 1`
  const admin = adminRows[0]
  if (!admin?.is_admin) {
    return NextResponse.json({ error: 'Only admins can edit expenses' }, { status: 403 })
  }

  // Verify expense exists and belongs to the same group
  const expenseRows = await sql`SELECT id, group_id FROM expenses WHERE id = ${expenseId} LIMIT 1`
  const expense = expenseRows[0]
  if (!expense || expense.group_id !== admin.group_id) {
    return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  }

  const groupId = expense.group_id

  const resolvedPayers: { memberId: string; amount: number }[] = Array.isArray(payers) && payers.length > 0
    ? payers
    : [{ memberId: adminId, amount: Number(amount) }]

  if (resolvedPayers.some((p: { memberId: string; amount: number }) => p.amount <= 0)) {
    return NextResponse.json({ error: 'Payer amounts must be positive' }, { status: 400 })
  }

  // Update the expense row
  await sql`
    UPDATE expenses SET description = ${description.trim()}, amount = ${Number(amount)}, paid_by = ${resolvedPayers[0].memberId}
    WHERE id = ${expenseId}
  `

  // Delete old payers and splits, re-insert
  await sql`DELETE FROM expense_payers WHERE expense_id = ${expenseId}`
  await sql`DELETE FROM expense_splits WHERE expense_id = ${expenseId}`

  // Insert payers
  for (const p of resolvedPayers) {
    await sql`
      INSERT INTO expense_payers (expense_id, member_id, amount)
      VALUES (${expenseId}, ${p.memberId}, ${Math.round(p.amount * 100) / 100})
    `
  }

  // Create splits
  const hasCustom = Array.isArray(customSplits) && customSplits.length > 0
  let splits: { memberId: string; amount: number }[]

  if (hasCustom) {
    splits = customSplits.map(({ memberId, amount: a }: { memberId: string; amount: number }) => ({
      memberId,
      amount: -Math.round(a * 100) / 100,
    }))
  } else {
    const totalCents = Math.round(Number(amount) * 100)
    const n = splitAmong.length
    const baseCents = Math.floor(totalCents / n)
    const remainder = totalCents - baseCents * n

    const remainderSet = new Set<string>()
    if (remainder > 0) {
      const [groupPayers, groupSplits, groupMembers] = await Promise.all([
        sql`SELECT ep.member_id, ep.amount FROM expense_payers ep JOIN expenses e ON e.id = ep.expense_id WHERE e.group_id = ${groupId}`,
        sql`SELECT es.member_id, es.amount FROM expense_splits es JOIN expenses e ON e.id = es.expense_id WHERE e.group_id = ${groupId}`,
        sql`SELECT id, starting_balance FROM members WHERE group_id = ${groupId}`,
      ])

      const startBals: Record<string, number> = {}
      for (const m of groupMembers) startBals[m.id] = Number(m.starting_balance || 0)

      const bal: Record<string, number> = {}
      for (const id of splitAmong) bal[id] = startBals[id] || 0
      for (const p of groupPayers) {
        if (p.member_id in bal) bal[p.member_id] += Number(p.amount)
      }
      for (const s of groupSplits) {
        if (s.member_id in bal) bal[s.member_id] += Number(s.amount)
      }

      const sorted = [...splitAmong].sort((a: string, b: string) => bal[a] - bal[b])

      let assigned = 0
      let i = 0
      while (assigned < remainder && i < sorted.length) {
        const tierBal = bal[sorted[i]]
        let j = i
        while (j < sorted.length && bal[sorted[j]] === tierBal) j++
        const tier = sorted.slice(i, j)
        const needed = remainder - assigned
        if (tier.length <= needed) {
          for (const id of tier) remainderSet.add(id)
          assigned += tier.length
        } else {
          const shuffled = [...tier].sort(() => Math.random() - 0.5)
          for (const id of shuffled.slice(0, needed)) remainderSet.add(id)
          assigned = remainder
        }
        i = j
      }
    }

    splits = splitAmong.map((memberId: string) => ({
      memberId,
      amount: -(baseCents + (remainderSet.has(memberId) ? 1 : 0)) / 100,
    }))
  }

  for (const s of splits) {
    await sql`
      INSERT INTO expense_splits (expense_id, member_id, amount)
      VALUES (${expenseId}, ${s.memberId}, ${s.amount})
    `
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const { expenseId, groupId, adminId, resetAll } = await request.json()

  if (!adminId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Verify admin
  const adminRows = await sql`SELECT is_admin FROM members WHERE id = ${adminId} LIMIT 1`
  const admin = adminRows[0]

  if (!admin?.is_admin) {
    return NextResponse.json({ error: 'Only admins can delete expenses' }, { status: 403 })
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
