import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const { groupId, memberId } = await request.json()

  if (!groupId || !memberId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const memberRows = await sql`SELECT id FROM members WHERE id = ${memberId} AND group_id = ${groupId} LIMIT 1`
  if (memberRows.length === 0) {
    return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 })
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const folder = `iou/${groupId}`
  const apiSecret = process.env.CLOUDINARY_API_SECRET!

  const signature = crypto
    .createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex')

  return NextResponse.json({
    signature,
    timestamp,
    folder,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  })
}
