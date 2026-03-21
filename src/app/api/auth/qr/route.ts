import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import crypto from 'crypto'

export async function POST(request: Request) {
  const { groupId, memberId } = await request.json()

  if (!groupId || !memberId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Verify memberId exists in groupId (only group members can generate)
  const memberRows = await sql`
    SELECT id FROM members WHERE id = ${memberId} AND group_id = ${groupId} LIMIT 1
  `
  if (memberRows.length === 0) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Cleanup: delete old tokens for the group (older than 10 min)
  await sql`
    DELETE FROM qr_tokens
    WHERE group_id = ${groupId}
    AND created_at < ${new Date(Date.now() - 10 * 60 * 1000).toISOString()}
  `

  const token = crypto.randomBytes(24).toString('base64url')

  const insertResult = await sql`
    INSERT INTO qr_tokens (group_id, token) VALUES (${groupId}, ${token})
  `

  if (!insertResult) {
    return NextResponse.json({ error: 'Failed to generate QR' }, { status: 500 })
  }

  const origin = request.headers.get('origin') || ''
  const qrUrl = `${origin}/qr?token=${token}`

  return NextResponse.json({
    token,
    qrUrl,
    expiresAt: Date.now() + 120_000,
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.json({ valid: false, reason: 'not_found' })
  }

  const rows = await sql`
    SELECT qt.created_at, g.id, g.name, g.code, g.currency
    FROM qr_tokens qt
    JOIN groups g ON g.id = qt.group_id
    WHERE qt.token = ${token}
    LIMIT 1
  `
  const qrToken = rows[0]

  if (!qrToken) {
    return NextResponse.json({ valid: false, reason: 'not_found' })
  }

  const age = Date.now() - new Date(qrToken.created_at).getTime()
  if (age > 120_000) {
    return NextResponse.json({ valid: false, reason: 'expired' })
  }

  return NextResponse.json({
    valid: true,
    groupName: qrToken.name,
    groupId: qrToken.id,
    groupCode: qrToken.code,
    currency: qrToken.currency,
  })
}
