import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const receiptId = searchParams.get('receiptId')
  const memberId = searchParams.get('memberId')

  if (!receiptId || !memberId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const receiptRows = await sql`
    SELECT r.id, r.image_url, r.parsed_total, r.direction, e.group_id
    FROM receipts r
    JOIN expenses e ON e.id = r.expense_id
    WHERE r.id = ${receiptId}
    LIMIT 1
  `
  const receipt = receiptRows[0]
  if (!receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }

  const memberRows = await sql`SELECT id FROM members WHERE id = ${memberId} AND group_id = ${receipt.group_id} LIMIT 1`
  if (memberRows.length === 0) {
    return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 })
  }

  const items = await sql`
    SELECT
      ri.id, ri.description, ri.amount, ri.sort_order, ri.y_center_pct,
      (SELECT count(*) FROM receipt_item_members rim WHERE rim.item_id = ri.id) AS member_count,
      EXISTS(SELECT 1 FROM receipt_item_members rim WHERE rim.item_id = ri.id AND rim.member_id = ${memberId}) AS included
    FROM receipt_items ri
    WHERE ri.receipt_id = ${receiptId}
    ORDER BY ri.sort_order
  `

  return NextResponse.json({
    id: receipt.id,
    imageUrl: receipt.image_url,
    parsedTotal: receipt.parsed_total,
    direction: receipt.direction === 'rtl' ? 'rtl' : 'ltr',
    items: items.map(it => ({
      id: it.id,
      description: it.description,
      amount: Number(it.amount),
      memberCount: Number(it.member_count),
      included: it.included,
      yCenterPct: it.y_center_pct !== null ? Number(it.y_center_pct) : null,
    })),
  })
}
