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
  payers?: ExpensePayer[]
  receipt_id?: string | null
  has_receipt?: boolean
  review_pending?: boolean
  receipt_ocr_status?: string | null
}

export interface ReceiptItem {
  id: string
  description: string
  amount: number
  memberCount: number
  included: boolean
  yCenterPct: number | null
}

export interface ReceiptDetail {
  id: string
  imageUrl: string
  merchantName: string | null
  parsedTotal: number | null
  subtotal: number | null
  tax: number | null
  tip: number | null
  ocrStatus: string
  direction: 'ltr' | 'rtl'
  items: ReceiptItem[]
}

export interface ExpenseSplit {
  id: string
  expense_id: string
  member_id: string
  amount: number
}

export interface ExpensePayer {
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

export interface NameCollisionData {
  groupName: string
  memberName: string
}

export interface Transfer {
  from: string
  fromName: string
  to: string
  toName: string
  amount: number
}
