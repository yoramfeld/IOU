import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { extractReceiptRows, OcrRateLimitError } from '@/lib/ocr'

export const dynamic = 'force-dynamic'
// Vision extraction can take several seconds on a real receipt photo, plus image fetch time.
export const maxDuration = 60

export async function POST(request: Request) {
  const { receiptId, groupId, memberId, imageUrl } = await request.json()

  if (!memberId || (!receiptId && (!groupId || !imageUrl))) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  try {
    if (receiptId) {
      const receiptRows = await sql`
        SELECT r.id, r.image_url, r.expense_id, e.group_id
        FROM receipts r
        JOIN expenses e ON e.id = r.expense_id
        WHERE r.id = ${receiptId}
        LIMIT 1
      `
      const receipt = receiptRows[0]
      if (!receipt) {
        return NextResponse.json(
          { error: 'Receipt not found' },
          { status: 404 },
        )
      }

      const memberRows =
        await sql`SELECT id FROM members WHERE id = ${memberId} AND group_id = ${receipt.group_id} LIMIT 1`
      if (memberRows.length === 0) {
        return NextResponse.json(
          { error: 'Not a member of this group' },
          { status: 403 },
        )
      }

      await sql`UPDATE receipts SET ocr_status = 'processing' WHERE id = ${receiptId}`

      const extracted = await extractReceiptRows(receipt.image_url)
      const items = extracted.rows.map((row) => ({
        description: row.description,
        amount: row.amount,
        yCenterPct: null,
      }))
      const status = items.length > 0 ? 'ok' : 'no_items'

      await sql`DELETE FROM receipt_items WHERE receipt_id = ${receiptId}`
      await sql`DELETE FROM receipt_reviews WHERE receipt_id = ${receiptId}`
      await sql`
        UPDATE receipts
        SET raw_ocr_json = ${JSON.stringify(extracted.raw)},
            parsed_total = ${extracted.total ?? null},
            direction = ${extracted.direction},
            ocr_status = ${status}
        WHERE id = ${receiptId}
      `

      if (items.length > 0) {
        const participantRows = await sql`
          SELECT member_id
          FROM expense_splits
          WHERE expense_id = ${receipt.expense_id}
          ORDER BY id
        `
        const participantIds: string[] = participantRows.map((r) => r.member_id)

        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          const itemRows = await sql`
            INSERT INTO receipt_items (receipt_id, description, amount, sort_order, y_center_pct)
            VALUES (${receiptId}, ${item.description}, ${Math.round(item.amount * 100) / 100}, ${i}, null)
            RETURNING id
          `
          const itemId = itemRows[0]?.id
          if (!itemId) continue
          for (const id of participantIds) {
            await sql`INSERT INTO receipt_item_members (item_id, member_id) VALUES (${itemId}, ${id}) ON CONFLICT DO NOTHING`
          }
        }

        for (const id of participantIds) {
          await sql`INSERT INTO receipt_reviews (receipt_id, member_id) VALUES (${receiptId}, ${id}) ON CONFLICT DO NOTHING`
        }
      }

      return NextResponse.json({
        items,
        total: extracted.total,
        direction: extracted.direction,
        raw: extracted.raw,
      })
    }

    const memberRows =
      await sql`SELECT id FROM members WHERE id = ${memberId} AND group_id = ${groupId} LIMIT 1`
    if (memberRows.length === 0) {
      return NextResponse.json(
        { error: 'Not a member of this group' },
        { status: 403 },
      )
    }

    const extracted = await extractReceiptRows(imageUrl)
    const items = extracted.rows.map((row) => ({
      description: row.description,
      amount: row.amount,
      yCenterPct: null,
    }))
    return NextResponse.json({
      items,
      total: extracted.total,
      direction: extracted.direction,
      raw: extracted.raw,
    })
  } catch (err) {
    if (receiptId) {
      await sql`UPDATE receipts SET ocr_status = 'error' WHERE id = ${receiptId}`.catch(
        () => null,
      )
    }
    if (err instanceof OcrRateLimitError) {
      return NextResponse.json(
        {
          error:
            "Receipt scanning hit today's free-tier limit — try again tomorrow.",
        },
        { status: 429 },
      )
    }
    console.error('OCR failed:', err)
    return NextResponse.json(
      { error: 'Could not scan receipt.' },
      { status: 502 },
    )
  }
}
