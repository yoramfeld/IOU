import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { extractReceiptRows } from '@/lib/ocr'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const { groupId, memberId, imageUrl } = await request.json()

  if (!groupId || !memberId || !imageUrl) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const memberRows = await sql`SELECT id FROM members WHERE id = ${memberId} AND group_id = ${groupId} LIMIT 1`
  if (memberRows.length === 0) {
    return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 })
  }

  try {
    const { rows, total, direction, raw } = await extractReceiptRows(imageUrl)
    const items = rows.map((row, i) => ({ description: `Row ${i + 1}`, amount: row.amount, yCenterPct: row.yCenterPct }))
    return NextResponse.json({ items, total, direction, raw })
  } catch {
    return NextResponse.json({ error: 'OCR failed' }, { status: 502 })
  }
}
