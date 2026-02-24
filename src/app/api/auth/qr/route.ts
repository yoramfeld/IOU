import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import crypto from 'crypto'

export async function POST(request: Request) {
  const { groupId, memberId } = await request.json()

  if (!groupId || !memberId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Verify memberId exists in groupId (only group members can generate)
  const { data: member } = await supabase
    .from('members')
    .select('id')
    .eq('id', memberId)
    .eq('group_id', groupId)
    .single()

  if (!member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Cleanup: delete old tokens for the group (older than 10 min)
  await supabase
    .from('qr_tokens')
    .delete()
    .eq('group_id', groupId)
    .lt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())

  const token = crypto.randomBytes(24).toString('base64url')

  const { error: insertError } = await supabase
    .from('qr_tokens')
    .insert({ group_id: groupId, token })

  if (insertError) {
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

  const supabase = createServiceClient()

  const { data: qrToken } = await supabase
    .from('qr_tokens')
    .select('created_at, groups(id, name, code, currency)')
    .eq('token', token)
    .single()

  if (!qrToken) {
    return NextResponse.json({ valid: false, reason: 'not_found' })
  }

  const age = Date.now() - new Date(qrToken.created_at).getTime()
  if (age > 120_000) {
    return NextResponse.json({ valid: false, reason: 'expired' })
  }

  const group = qrToken.groups as { id: string; name: string; code: string; currency: string }

  return NextResponse.json({
    valid: true,
    groupName: group.name,
    groupId: group.id,
    groupCode: group.code,
    currency: group.currency,
  })
}
