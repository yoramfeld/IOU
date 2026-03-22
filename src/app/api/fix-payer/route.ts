import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const groupId   = '8d7a947d-3774-4236-a129-a709a7fbb61b'
  const expenseId = 'fe4bf3e9-9db7-4235-9ff5-e7d6b1e05739'

  const [expenses, payers, splits] = await Promise.all([
    sql`SELECT id, group_id, paid_by, amount, description FROM expenses WHERE group_id = ${groupId}`,
    sql`SELECT ep.expense_id, ep.member_id, ep.amount FROM expense_payers ep JOIN expenses e ON e.id = ep.expense_id WHERE e.group_id = ${groupId}`,
    sql`SELECT es.expense_id, es.member_id, es.amount FROM expense_splits es JOIN expenses e ON e.id = es.expense_id WHERE e.group_id = ${groupId}`,
  ])

  const allPayers = await sql`SELECT * FROM expense_payers WHERE expense_id = ${expenseId}`

  return NextResponse.json({ expenses, payers, splits, allPayersForExpense: allPayers, dbUrl: process.env.DATABASE_URL?.replace(/:\/\/.*@/, '://***@') })
}
