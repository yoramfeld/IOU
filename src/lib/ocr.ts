// Isolated behind this one file so swapping OCR providers later (quota exhaustion,
// moving to a paid tier) is a one-file change rather than a rewrite.

const GEMINI_MODEL = 'gemini-2.5-flash'

export interface ExtractedReceipt {
  rows: number[]
  total: number | null
  raw: unknown
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    rows: {
      type: 'ARRAY',
      items: { type: 'NUMBER' },
      description: 'Pre-tax line-item totals from the receipt, in the order they are printed.',
    },
    total: {
      type: 'NUMBER',
      description: 'The printed grand total (or subtotal if no grand total is visible).',
    },
  },
  required: ['rows', 'total'],
}

const PROMPT = `Analyze this receipt image. Extract the pre-tax cost of each line item into the "rows" array, in the order they're printed. Do not include tax, tip, service charge, or the total line itself in "rows". Also read the printed grand total (or subtotal if no total is visible) into "total". If the receipt is in Hebrew or another right-to-left language, note that amounts are typically printed in the left column rather than the right — identify each amount by its numeric/currency formatting, not by assuming it's on a particular side. Respond with JSON only.`

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

  if (!response.ok) {
    throw new Error(`Gemini OCR request failed: ${response.status}`)
  }

  const result = await response.json()
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!rawText) {
    throw new Error('Gemini OCR returned no content')
  }

  const parsed = JSON.parse(rawText) as { rows?: unknown; total?: unknown }
  const rows = Array.isArray(parsed.rows) ? parsed.rows.filter((r): r is number => typeof r === 'number' && r >= 0) : []
  const total = typeof parsed.total === 'number' ? parsed.total : null

  return { rows, total, raw: result }
}
