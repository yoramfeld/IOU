import type { MemberBalance, Transfer } from '@/types'

export function calculateSettlements(balances: MemberBalance[]): Transfer[] {
  // Split into debtors (negative balance) and creditors (positive balance)
  const debtors = balances
    .filter(b => b.balance < -0.01)
    .map(b => ({ id: b.id, name: b.name, amount: Math.abs(b.balance) }))
    .sort((a, b) => b.amount - a.amount) // biggest debt first

  const creditors = balances
    .filter(b => b.balance > 0.01)
    .map(b => ({ id: b.id, name: b.name, amount: b.balance }))
    .sort((a, b) => b.amount - a.amount) // biggest credit first

  const transfers: Transfer[] = []
  let di = 0
  let ci = 0

  while (di < debtors.length && ci < creditors.length) {
    const debtor = debtors[di]
    const creditor = creditors[ci]
    const transfer = Math.min(debtor.amount, creditor.amount)

    if (transfer > 0.01) {
      transfers.push({
        from: debtor.id,
        fromName: debtor.name,
        to: creditor.id,
        toName: creditor.name,
        amount: Math.round(transfer * 100) / 100,
      })
    }

    debtor.amount -= transfer
    creditor.amount -= transfer

    if (debtor.amount < 0.01) di++
    if (creditor.amount < 0.01) ci++
  }

  return transfers
}
