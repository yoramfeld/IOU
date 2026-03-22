import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

// One-time repair: insert missing payer record for "Test" expense (Eyal paid 224)
export async function GET() {
  const expenseId = 'fe4bf3e9-9db7-4235-9ff5-e7d6b1e05739'
  const memberId  = 'aeb17f30-662e-4679-ab4a-be4a7529f8aa' // Eyal
  const amount    = 224

  const existing = await sql`
    SELECT id FROM expense_payers WHERE expense_id = ${expenseId} AND member_id = ${memberId}
  `
  if (existing.length > 0) {
    return NextResponse.json({ status: 'already exists', row: existing[0] })
  }

  await sql`
    INSERT INTO expense_payers (expense_id, member_id, amount)
    VALUES (${expenseId}, ${memberId}, ${amount})
  `

  const verify = await sql`
    SELECT ep.member_id, ep.amount, m.name
    FROM expense_payers ep
    JOIN members m ON m.id = ep.member_id
    WHERE ep.expense_id = ${expenseId}
  `
  return NextResponse.json({ status: 'inserted', payers: verify })
}
