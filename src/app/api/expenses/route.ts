import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const groupId = searchParams.get('groupId')

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('expenses')
    .select('*, splits:expense_splits(*), payers:expense_payers(*)')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const { groupId, paidBy, amount, description, splitAmong, customSplits, enteredBy, payers, deviationDelta } = await request.json()

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

  const supabase = createServiceClient()

  // Verify enteredBy is a valid member of the group
  if (enteredBy !== paidBy) {
    const { data: enterer } = await supabase
      .from('members')
      .select('id, group_id')
      .eq('id', enteredBy)
      .eq('group_id', groupId)
      .single()
    if (!enterer) {
      return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 })
    }
  }

  // Create expense (paid_by = primary payer for display)
  const { data: expense, error: expErr } = await supabase
    .from('expenses')
    .insert({
      group_id: groupId,
      paid_by: resolvedPayers[0].memberId,
      amount: Number(amount),
      description: description.trim(),
      entered_by: enteredBy,
      rounding_deviation: deviationDelta && Object.keys(deviationDelta).length > 0 ? deviationDelta : null,
    })
    .select('id')
    .single()

  if (expErr) {
    return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 })
  }

  // Insert payers
  const payerRows = resolvedPayers.map(p => ({
    expense_id: expense.id,
    member_id: p.memberId,
    amount: Math.round(p.amount * 100) / 100,
  }))

  const { error: payerErr } = await supabase.from('expense_payers').insert(payerRows)

  if (payerErr) {
    await supabase.from('expenses').delete().eq('id', expense.id)
    return NextResponse.json({ error: 'Failed to create payers' }, { status: 500 })
  }

  // Create splits
  let splits: { expense_id: string; member_id: string; amount: number }[]

  if (hasCustom) {
    splits = customSplits.map(({ memberId, amount: a }: { memberId: string; amount: number }) => ({
      expense_id: expense.id,
      member_id: memberId,
      amount: -Math.round(a * 100) / 100,
    }))
  } else {
    const totalCents = Math.round(Number(amount) * 100)
    const n = splitAmong.length
    const baseCents = Math.floor(totalCents / n)
    const remainder = totalCents - baseCents * n

    // Determine which members absorb the remainder cents.
    // Give each extra cent to whoever currently owes the most to the group.
    // Randomize within a tied tier.
    const remainderSet = new Set<string>()
    if (remainder > 0) {
      const { data: groupExpenses } = await supabase
        .from('expenses')
        .select('expense_payers(member_id, amount), expense_splits(member_id, amount)')
        .eq('group_id', groupId)

      const bal: Record<string, number> = {}
      for (const id of splitAmong) bal[id] = 0
      for (const e of (groupExpenses ?? []) as { expense_payers: { member_id: string; amount: number }[]; expense_splits: { member_id: string; amount: number }[] }[]) {
        for (const p of e.expense_payers) {
          if (p.member_id in bal) bal[p.member_id] += Number(p.amount)
        }
        for (const s of e.expense_splits) {
          if (s.member_id in bal) bal[s.member_id] += Number(s.amount)
        }
      }

      // Sort ascending: most negative balance = owes most
      const sorted = [...splitAmong].sort((a, b) => bal[a] - bal[b])

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
      expense_id: expense.id,
      member_id: memberId,
      amount: -(baseCents + (remainderSet.has(memberId) ? 1 : 0)) / 100,
    }))
  }

  const { error: splitErr } = await supabase
    .from('expense_splits')
    .insert(splits)

  if (splitErr) {
    // Rollback expense (cascade deletes payers too)
    await supabase.from('expenses').delete().eq('id', expense.id)
    return NextResponse.json({ error: 'Failed to create splits' }, { status: 500 })
  }

  // Update group's cumulative rounding balances
  if (deviationDelta && Object.keys(deviationDelta).length > 0) {
    const { data: grp } = await supabase
      .from('groups')
      .select('rounding_balances')
      .eq('id', groupId)
      .single()
    const current: Record<string, number> = grp?.rounding_balances ?? {}
    const updated: Record<string, number> = { ...current }
    for (const [id, delta] of Object.entries(deviationDelta as Record<string, number>)) {
      updated[id] = Math.round(((updated[id] ?? 0) + delta) * 1000) / 1000
    }
    await supabase.from('groups').update({ rounding_balances: updated }).eq('id', groupId)
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const { expenseId, groupId, adminId, resetAll } = await request.json()

  if (!adminId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Verify admin
  const { data: admin } = await supabase
    .from('members')
    .select('is_admin')
    .eq('id', adminId)
    .single()

  if (!admin?.is_admin) {
    return NextResponse.json({ error: 'Only admins can delete expenses' }, { status: 403 })
  }

  // Reset all expenses for a group
  if (resetAll && groupId) {
    const { error } = await supabase
      .from('expenses')
      .delete()
      .eq('group_id', groupId)

    if (error) {
      return NextResponse.json({ error: 'Failed to reset transactions' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  }

  // Delete single expense
  if (!expenseId) {
    return NextResponse.json({ error: 'Missing expenseId' }, { status: 400 })
  }

  // Fetch expense's stored deviation and group_id before deleting
  const { data: expRow } = await supabase
    .from('expenses')
    .select('group_id, rounding_deviation')
    .eq('id', expenseId)
    .single()

  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', expenseId)

  if (error) {
    return NextResponse.json({ error: 'Failed to delete expense' }, { status: 500 })
  }

  // Reverse rounding deviation
  if (expRow?.rounding_deviation && expRow.group_id) {
    const delta = expRow.rounding_deviation as Record<string, number>
    const { data: grp } = await supabase
      .from('groups')
      .select('rounding_balances')
      .eq('id', expRow.group_id)
      .single()
    const current: Record<string, number> = grp?.rounding_balances ?? {}
    const updated: Record<string, number> = { ...current }
    for (const [id, d] of Object.entries(delta)) {
      updated[id] = Math.round(((updated[id] ?? 0) - d) * 1000) / 1000
    }
    await supabase.from('groups').update({ rounding_balances: updated }).eq('id', expRow.group_id)
  }

  return NextResponse.json({ ok: true })
}
