import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { extractReceiptRows, OcrRateLimitError } from '@/lib/ocr'

export const dynamic = 'force-dynamic'
// Gemini's vision+thinking response can take several seconds on a real (larger, more
// detailed) photo, plus the time to fetch and base64-encode the image server-side —
// comfortably past Vercel's 10s default function timeout. Raise it explicitly.
export const maxDuration = 60

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
    const items = rows.map(row => ({ description: row.description, amount: row.amount, yCenterPct: row.yCenterPct }))
    return NextResponse.json({ items, total, direction, raw })
  } catch (err) {
    if (err instanceof OcrRateLimitError) {
      return NextResponse.json(
        { error: "Receipt scanning hit today's free-tier limit — try again tomorrow, or add items manually." },
        { status: 429 },
      )
    }
    console.error('OCR failed:', err)
    return NextResponse.json({ error: 'Could not scan receipt — try again, or add items manually.' }, { status: 502 })
  }
}
