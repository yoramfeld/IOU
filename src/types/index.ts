export interface Group {
  id: string
  name: string
  code: string
  currency: string
  created_by: string | null
  created_at: string
}

export interface Member {
  id: string
  group_id: string
  name: string
  is_admin: boolean
  created_at: string
}

export interface Expense {
  id: string
  group_id: string
  paid_by: string
  amount: number
  description: string
  entered_by: string
  created_at: string
}

export interface ExpenseSplit {
  id: string
  expense_id: string
  member_id: string
  amount: number
}

export interface MemberBalance {
  id: string
  name: string
  is_admin: boolean
  group_id: string
  total_paid: number
  total_owed: number
  balance: number
}

export interface MemberSession {
  groupId: string
  groupName: string
  groupCode: string
  currency: string
  memberId: string
  name: string
  isAdmin: boolean
}

export interface Transfer {
  from: string
  fromName: string
  to: string
  toName: string
  amount: number
}
