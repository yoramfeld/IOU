import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function POST(request: Request) {
  const { groupId, adminId } = await request.json()

  if (!groupId || !adminId) {
    return NextResponse.json({ error: 'Missing groupId or adminId' }, { status: 400 })
  }

  // Verify admin
  const adminRows = await sql`
    SELECT is_admin, group_id FROM members WHERE id = ${adminId} LIMIT 1
  `
  const admin = adminRows[0]

  if (!admin?.is_admin || admin.group_id !== groupId) {
    return NextResponse.json({ error: 'Only admins can repair balances' }, { status: 403 })
  }

  // Fetch all data
  const [members, payers, splits] = await Promise.all([
    sql`SELECT id, name, starting_balance FROM members WHERE group_id = ${groupId}`,
    sql`SELECT ep.member_id, ep.amount FROM expense_payers ep
        JOIN expenses e ON e.id = ep.expense_id
        WHERE e.group_id = ${groupId}`,
    sql`SELECT es.member_id, es.amount FROM expense_splits es
        JOIN expenses e ON e.id = es.expense_id
        WHERE e.group_id = ${groupId}`,
  ])

  // Compute balances from scratch
  const paid: Record<string, number> = {}
  const owed: Record<string, number> = {}

  for (const p of payers) {
    paid[p.member_id] = (paid[p.member_id] || 0) + Number(p.amount)
  }
  for (const s of splits) {
    owed[s.member_id] = (owed[s.member_id] || 0) + Number(s.amount)
  }

  const balances = (members as { id: string; name: string; starting_balance: string | number }[]).map(m => {
    const startBal = Number(m.starting_balance || 0)
    const paidAmt = paid[m.id] || 0
    const owedAmt = owed[m.id] || 0
    const balance = startBal + paidAmt + owedAmt
    return { id: m.id, name: m.name, starting_balance: startBal, paid: paidAmt, owed: owedAmt, balance }
  })

  // Check if sum is zero (within tolerance)
  const totalSum = balances.reduce((s, b) => s + b.balance, 0)
  const roundedSum = Math.round(totalSum * 100) / 100

  const formattedBalances = balances.map(b => ({ id: b.id, name: b.name, balance: Math.round(b.balance * 100) / 100 }))

  if (Math.abs(roundedSum) <= 0.01) {
    return NextResponse.json({
      discrepancy: 0,
      message: 'Balances are clean',
      balances: formattedBalances,
    })
  }

  return NextResponse.json({
    discrepancy: roundedSum,
    message: `Balance discrepancy of ${Math.abs(roundedSum).toFixed(2)} detected. Starting balances can only be adjusted by an admin.`,
    balances: formattedBalances,
  })
}
