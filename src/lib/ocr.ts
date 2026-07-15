// Isolated behind this one file so swapping OCR providers later (quota exhaustion,
// moving to a paid tier) is a one-file change rather than a rewrite.

const GEMINI_MODEL = 'gemini-2.5-flash'

const DESCRIPTION_MAX_CHARS = 80

export interface ExtractedRow {
  description: string
  amount: number
}

export interface ExtractedReceipt {
  merchantName: string | null
  rows: ExtractedRow[]
  subtotal: number | null
  tax: number | null
  tip: number | null
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

// Keep the provider output focused on semantic bill data. The review UI shows extracted
// rows as a list alongside the original image, so no visual row grounding is required.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    merchantName: {
      type: 'STRING',
      description:
        'Merchant or restaurant name exactly as printed, or empty string if unclear.',
    },
    direction: {
      type: 'STRING',
      enum: ['ltr', 'rtl'],
      description:
        'Primary reading direction of the receipt text — "rtl" for Hebrew, Arabic, etc.',
    },
    rows: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          description: {
            type: 'STRING',
            description:
              'Item name/description as printed, without quantity or unit price when separable.',
          },
          amount: {
            type: 'NUMBER',
            description:
              'Line item total cost. Use the row total, not unit price.',
          },
        },
        required: ['description', 'amount'],
      },
      description:
        'Purchasable line items in printed order. Exclude taxes, tips, service charges, discounts, and total rows.',
    },
    subtotal: {
      type: 'NUMBER',
      description: 'Printed subtotal before tax/tip/service when visible.',
    },
    tax: { type: 'NUMBER', description: 'Printed tax amount when visible.' },
    tip: {
      type: 'NUMBER',
      description: 'Printed tip/service amount when visible.',
    },
    total: {
      type: 'NUMBER',
      description: 'Printed grand total when visible.',
    },
  },
  required: ['merchantName', 'rows', 'direction'],
}

const PROMPT = `Analyze this receipt image and extract structured bill data for later human review.
1. Determine the primary reading direction ("ltr" or "rtl" — Hebrew/Arabic receipts are "rtl").
2. Extract the merchant or restaurant name if visible.
3. Extract each purchasable line item in printed order:
   - "description": item name as printed. Keep it readable; remove quantity/unit-price fragments only when clearly separate.
   - "amount": that line's total cost. If quantity times unit price is printed, use the row total.
   Do not include tax, tip, service charge, discount, subtotal, or total lines as rows.
4. Extract printed subtotal, tax, tip/service, and grand total when visible. Leave uncertain numeric fields absent.
On a right-to-left receipt, amounts are often printed in the left column; identify amounts by numeric/currency formatting, not by assuming a side.
Respond with JSON only.`

export async function extractReceiptRows(
  imageUrl: string,
): Promise<ExtractedReceipt> {
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
    merchantName?: unknown
    rows?: unknown
    subtotal?: unknown
    tax?: unknown
    tip?: unknown
    total?: unknown
    direction?: unknown
  }

  const rawRows = Array.isArray(parsed.rows) ? parsed.rows : []
  const rows: ExtractedRow[] = rawRows
    .filter(
      (r): r is { description: unknown; amount: unknown } =>
        typeof r === 'object' && r !== null,
    )
    .map((r, i) => {
      const amount =
        typeof r.amount === 'number' && r.amount >= 0 ? r.amount : null
      const description =
        typeof r.description === 'string' && r.description.trim()
          ? r.description.trim().slice(0, DESCRIPTION_MAX_CHARS)
          : `Item ${i + 1}`
      return amount !== null ? { description, amount } : null
    })
    .filter((r): r is ExtractedRow => r !== null)

  const merchantName =
    typeof parsed.merchantName === 'string' && parsed.merchantName.trim()
      ? parsed.merchantName.trim().slice(0, 120)
      : null
  const subtotal = typeof parsed.subtotal === 'number' ? parsed.subtotal : null
  const tax = typeof parsed.tax === 'number' ? parsed.tax : null
  const tip = typeof parsed.tip === 'number' ? parsed.tip : null
  const total = typeof parsed.total === 'number' ? parsed.total : null
  const direction: 'ltr' | 'rtl' = parsed.direction === 'rtl' ? 'rtl' : 'ltr'

  return {
    merchantName,
    rows,
    subtotal,
    tax,
    tip,
    total,
    direction,
    raw: { parsed, provider: result },
  }
}
