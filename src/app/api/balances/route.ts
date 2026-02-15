import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const groupId = searchParams.get('groupId')

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('member_balances')
    .select('*')
    .eq('group_id', groupId)
    .order('balance', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch balances' }, { status: 500 })
  }

  return NextResponse.json(data)
}
