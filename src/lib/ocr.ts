// Isolated behind this one file so swapping OCR providers later (quota exhaustion,
// moving to a paid tier) is a one-file change rather than a rewrite.

const GEMINI_MODEL = 'gemini-2.5-flash'

const DESCRIPTION_MAX_CHARS = 15

export interface ExtractedRow {
  description: string
  amount: number
  yCenterPct: number | null // 0-100, vertical center of this row on the receipt image; null if ungrounded
}

export interface ExtractedReceipt {
  rows: ExtractedRow[]
  total: number | null
  direction: 'ltr' | 'rtl'
  raw: unknown
}

// Distinct from other OCR failures so the API route can show a clear, actionable message
// instead of a raw HTTP status — Gemini's free tier is quota-limited per day, not just
// per minute, so "try again in a few seconds" would be misleading advice for this one.
export class OcrRateLimitError extends Error {
  constructor() {
    super('Gemini free-tier daily quota exceeded')
    this.name = 'OcrRateLimitError'
  }
}

// Only the vertical position is used (checkbox alignment) — horizontal bounding-box
// accuracy isn't needed, so we accept Gemini's native box_2d grounding format but only
// ever read ymin/ymax out of it.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    direction: {
      type: 'STRING',
      enum: ['ltr', 'rtl'],
      description: 'Primary reading direction of the receipt text — "rtl" for Hebrew, Arabic, etc.',
    },
    rows: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          description: { type: 'STRING', description: 'Short item name/description as printed, no quantity or unit price.' },
          amount: { type: 'NUMBER', description: 'Pre-tax cost of this line item.' },
          box_2d: {
            type: 'ARRAY',
            items: { type: 'INTEGER' },
            description: 'Bounding box around this line, as [ymin, xmin, ymax, xmax] normalized 0-1000.',
          },
        },
        required: ['description', 'amount', 'box_2d'],
      },
      description: 'Line items in the order they are printed, top to bottom.',
    },
    total: {
      type: 'NUMBER',
      description: 'The printed grand total (or subtotal if no grand total is visible).',
    },
  },
  required: ['rows', 'total', 'direction'],
}

const PROMPT = `Analyze this receipt image.
1. Determine the primary reading direction ("ltr" or "rtl" — Hebrew/Arabic receipts are "rtl").
2. For each pre-tax line item (in printed order, top to bottom), extract:
   - "description": a short item name as printed (just the name — ignore quantity and unit price, we only need the name and the line's total cost).
   - "amount": the line's total pre-tax cost.
   - "box_2d": a bounding box as [ymin, xmin, ymax, xmax] normalized 0-1000. The box must tightly bound ONLY the visible text glyphs of that specific line (top of its tallest character to the bottom/baseline of its lowest character) — do not include surrounding whitespace, line spacing, or any part of adjacent lines. Line items are typically only 15-25 units tall in this normalized scale; be precise about the exact vertical extent of the glyphs themselves.
   Do not include tax, tip, service charge, or the total line as a row.
3. Read the printed grand total (or subtotal if no total is visible) into "total".
On a right-to-left receipt, amounts are typically printed in the left column rather than the right — identify amounts by numeric/currency formatting, not by assuming a side.
Respond with JSON only.`

export async function extractReceiptRows(imageUrl: string): Promise<ExtractedReceipt> {
  const apiKey = process.env.GEMINI_API_KEY!

  const imageResponse = await fetch(imageUrl)
  if (!imageResponse.ok) {
    throw new Error('Failed to fetch receipt image')
  }
  const arrayBuffer = await imageResponse.arrayBuffer()
  const base64Image = Buffer.from(arrayBuffer).toString('base64')
  const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg'

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              { inlineData: { mimeType, data: base64Image } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    },
  )

  if (response.status === 429) {
    throw new OcrRateLimitError()
  }
  if (!response.ok) {
    throw new Error(`Gemini OCR request failed: ${response.status}`)
  }

  const result = await response.json()
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!rawText) {
    throw new Error('Gemini OCR returned no content')
  }

  const parsed = JSON.parse(rawText) as {
    rows?: unknown
    total?: unknown
    direction?: unknown
  }

  const rawRows = Array.isArray(parsed.rows) ? parsed.rows : []
  const rows: ExtractedRow[] = rawRows
    .filter((r): r is { description: unknown; amount: unknown; box_2d: unknown } => typeof r === 'object' && r !== null)
    .map((r, i) => {
      const amount = typeof r.amount === 'number' && r.amount >= 0 ? r.amount : null
      const description = typeof r.description === 'string' && r.description.trim()
        ? r.description.trim().slice(0, DESCRIPTION_MAX_CHARS)
        : `Row ${i + 1}`
      const box = Array.isArray(r.box_2d) && r.box_2d.length === 4 && r.box_2d.every(n => typeof n === 'number')
        ? (r.box_2d as number[])
        : null
      const yCenterPct = box ? ((box[0] + box[2]) / 2 / 1000) * 100 : null
      return amount !== null ? { description, amount, yCenterPct } : null
    })
    .filter((r): r is ExtractedRow => r !== null)

  const total = typeof parsed.total === 'number' ? parsed.total : null
  const direction: 'ltr' | 'rtl' = parsed.direction === 'rtl' ? 'rtl' : 'ltr'

  return { rows, total, direction, raw: result }
}
