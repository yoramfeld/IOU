import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const groupId = searchParams.get('groupId')

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })
  }

  const rows = await sql`
    SELECT id, name, starting_balance FROM members WHERE group_id = ${groupId} ORDER BY name
  `

  return NextResponse.json(rows, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}

export async function PUT(request: Request) {
  const { groupId, adminId, balances } = await request.json()

  if (!groupId || !adminId || !Array.isArray(balances)) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Verify admin
  const adminRows = await sql`
    SELECT is_admin, group_id FROM members WHERE id = ${adminId} LIMIT 1
  `
  const admin = adminRows[0]

  if (!admin?.is_admin || admin.group_id !== groupId) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  // Zero-sum validation
  const sum = balances.reduce((acc: number, b: { amount: number }) => acc + Number(b.amount), 0)
  if (Math.abs(sum) > 0.01) {
    return NextResponse.json({ error: 'Balances must sum to zero' }, { status: 400 })
  }

  // Update each member's starting_balance
  for (const b of balances) {
    await sql`
      UPDATE members SET starting_balance = ${Number(b.amount)}
      WHERE id = ${b.memberId} AND group_id = ${groupId}
    `
  }

  return NextResponse.json({ ok: true })
}
