'use client'

import { useState, Fragment } from 'react'
import type { Member } from '@/types'

interface Props {
  members: Member[]
  currentMemberId: string
  isAdmin: boolean
  currency: string
  onSubmit: (data: {
    paidBy: string
    amount: number
    description: string
    splitAmong: string[]
    customSplits?: { memberId: string; amount: number }[]
    payers: { memberId: string; amount: number }[]
  }) => Promise<void>
  onClose: () => void
}

const TIP_OPTIONS = [0, 10, 12, 15]

function readSavedTip(): number {
  try { return parseInt(localStorage.getItem('iou_tip_pct') || '0', 10) || 0 } catch { return 0 }
}

export default function AddExpenseModal({ members, currentMemberId, isAdmin, currency, onSubmit, onClose }: Props) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [tipPct, setTipPct] = useState(readSavedTip)
  const [roundUp, setRoundUp] = useState(true)
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
  const [paidAmounts, setPaidAmounts] = useState<Record<string, string>>({})
  const [calcOpen, setCalcOpen] = useState<string | null>(null)
  const [calcExpr, setCalcExpr] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function fmt(n: number) {
    return n.toFixed(2).replace(/\.?0+$/, '')
  }

  function selectAll(e: React.FocusEvent<HTMLInputElement>) {
    const el = e.target
    setTimeout(() => el.select(), 0)
  }

  function handleTipChange(pct: number) {
    setTipPct(pct)
    try { localStorage.setItem('iou_tip_pct', String(pct)) } catch {}
  }

  // When bill changes, recalculate equal Ordered shares; clear when empty
  function parseSum(expr: string): number {
    return expr.split('+').reduce((s, v) => s + (parseFloat(v.trim()) || 0), 0)
  }

  function handleBillChange(value: string) {
    setAmount(value)
    const billVal = parseFloat(value) || 0
    if (billVal > 0) {
      const share = Math.round((billVal / members.length) * 100) / 100
      const newAmounts: Record<string, string> = {}
      for (const m of members) newAmounts[m.id] = fmt(share)
      setCustomAmounts(newAmounts)
    } else {
      setCustomAmounts({})
    }
  }

  // --- Totals ---
  const subtotal = Object.values(customAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  const totalAmount = Math.round(subtotal * (1 + tipPct / 100) * 100) / 100
  const tipAmount = Math.round((totalAmount - subtotal) * 100) / 100
  const finalTotal = roundUp ? Math.ceil(totalAmount) : totalAmount
  const roundUpDelta = Math.round((finalTotal - totalAmount) * 100) / 100
  const scaleFactor = totalAmount > 0 ? finalTotal / totalAmount : 1

  // --- Split ---
  const computedCustomSplits = Object.entries(customAmounts)
    .filter(([, v]) => parseFloat(v) > 0)
    .map(([memberId, v]) => ({
      memberId,
      amount: Math.round(parseFloat(v) * (1 + tipPct / 100) * scaleFactor * 100) / 100,
    }))

  // --- Paid ---
  const totalPaid = members.reduce((s, m) => s + (parseFloat(paidAmounts[m.id]) || 0), 0)
  const unassigned = Math.round((finalTotal - totalPaid) * 100) / 100

  const payers = members
    .filter(m => (parseFloat(paidAmounts[m.id]) || 0) > 0)
    .map(m => ({ memberId: m.id, amount: Math.round(parseFloat(paidAmounts[m.id]) * 100) / 100 }))

  const paidBy = payers[0]?.memberId ?? currentMemberId

  async function handleSubmit() {
    if (!description.trim()) { setError('Enter a description'); return }
    if (computedCustomSplits.length === 0) { setError('Enter at least one ordered amount'); return }
    if (payers.length === 0) { setError('Enter who paid'); return }
    if (Math.abs(unassigned) >= 0.01) {
      setError(unassigned > 0
        ? `${currency}${unassigned.toFixed(2)} still unassigned`
        : `Paid exceeds total by ${currency}${Math.abs(unassigned).toFixed(2)}`)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onSubmit({
        paidBy,
        amount: finalTotal,
        description: description.trim(),
        splitAmong: computedCustomSplits.map(s => s.memberId),
        customSplits: computedCustomSplits,
        payers,
      })
      onClose()
    } catch {
      setError('Failed to add expense')
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center">
      <div className="bg-white rounded-t-2xl w-full max-w-sm max-h-[90dvh] overflow-y-auto p-5 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Add expense</h2>
          <button onClick={onClose} className="text-ink-muted text-xl leading-none">&times;</button>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-ink-soft block mb-2">Description</label>
          <input
            className="input"
            placeholder="What was it for?"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onFocus={selectAll}
            autoFocus
          />
        </div>

        {/* Bill | Tip | Total+Roundup */}
        <div className="flex gap-2 items-end">
          <div className="w-[30%]">
            <label className="text-xs font-medium text-ink-soft block mb-2">Bill</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted text-xs">{currency}</span>
              <input
                className="input pl-5 pr-1"
                type="number"
                step="any"
                min="0"
                placeholder="0"
                value={amount}
                onFocus={selectAll}
                onChange={e => handleBillChange(e.target.value)}
              />
            </div>
          </div>
          <div className="w-1/5">
            <label className="text-xs font-medium text-ink-soft block mb-2">Tip</label>
            <select
              className="input px-2"
              value={tipPct}
              onChange={e => handleTipChange(Number(e.target.value))}
            >
              {TIP_OPTIONS.map(pct => (
                <option key={pct} value={pct}>{pct}%</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs font-medium text-ink-soft">Total</span>
              <button
                type="button"
                onClick={() => setRoundUp(r => !r)}
                title={roundUp ? 'Round up on' : 'Round up off'}
                className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  roundUp ? 'bg-accent border-accent' : 'border-ink-muted bg-white'
                }`}
              >
                {roundUp && <span className="w-1.5 h-1.5 rounded-full bg-white block" />}
              </button>
            </div>
            <div className="input py-3 text-sm font-semibold text-right">
              {finalTotal > 0 ? `${currency}${fmt(finalTotal)}` : ''}
            </div>
          </div>
        </div>

        {/* Tip breakdown (compact, only when tip or roundup is active) */}
        {subtotal > 0 && (tipPct > 0 || roundUpDelta > 0) && (
          <p className="text-xs text-ink-muted -mt-2">
            {tipPct > 0 && `Subtotal ${currency}${fmt(subtotal)} · Tip ${tipPct}% ${currency}${fmt(tipAmount)}`}
            {roundUpDelta > 0 && `${tipPct > 0 ? ' · ' : ''}Rounded up +${currency}${fmt(roundUpDelta)}`}
          </p>
        )}

        {/* Member table: Ordered | Owes | Paid */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="flex-1" />
            <span className="w-5 shrink-0" />
            <span className="w-16 shrink-0 text-xs font-medium text-ink-soft text-center">Ordered</span>
            <span className="w-16 shrink-0 text-xs font-medium text-ink-soft text-center">Total</span>
            <span className="w-16 shrink-0 text-xs font-medium text-ink-soft text-center">Paid</span>
          </div>

          <div className="space-y-2">
            {members.map(m => {
              const label = m.name + (m.id === currentMemberId ? ' (you)' : '')
              const share = parseFloat(customAmounts[m.id] || '0')
              const owes = share > 0 ? Math.round(share * (1 + tipPct / 100) * scaleFactor * 100) / 100 : 0
              const isCalcOpen = calcOpen === m.id
              const calcSum = parseSum(calcExpr)
              return (
                <Fragment key={m.id}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm flex-1 truncate min-w-0">{label}</span>

                    {/* Calc toggle */}
                    <button
                      type="button"
                      title="Calculator"
                      onClick={() => { setCalcOpen(isCalcOpen ? null : m.id); setCalcExpr('') }}
                      className={`w-5 h-5 shrink-0 rounded text-sm flex items-center justify-center transition-colors ${
                        isCalcOpen ? 'text-accent' : 'text-ink-muted hover:text-ink-soft'
                      }`}
                    >
                      ∑
                    </button>

                    {/* Ordered */}
                    <div className="relative w-16 shrink-0">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted text-xs">{currency}</span>
                      <input
                        className="input pl-5 py-1.5 text-sm w-full"
                        type="number"
                        step="any"
                        min="0"
                        placeholder="0"
                        value={customAmounts[m.id] ?? ''}
                        onFocus={e => {
                          const ref = parseFloat(amount) || 0
                          const others = Object.entries(customAmounts)
                            .filter(([id]) => id !== m.id)
                            .reduce((s, [, v]) => s + (parseFloat(v) || 0), 0)
                          const remaining = Math.max(0, Math.round((ref - others) * 100) / 100)
                          if (remaining > 0) setCustomAmounts(prev => ({ ...prev, [m.id]: fmt(remaining) }))
                          selectAll(e)
                        }}
                        onChange={e => setCustomAmounts(prev => ({ ...prev, [m.id]: e.target.value }))}
                      />
                    </div>

                    {/* Total (read-only) */}
                    <div className="relative w-16 shrink-0">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted text-xs">{currency}</span>
                      <input
                        className="input pl-5 py-1.5 text-sm w-full bg-surface text-ink-muted"
                        type="text"
                        readOnly
                        value={owes > 0 ? fmt(owes) : ''}
                        placeholder="0"
                      />
                    </div>

                    {/* Paid */}
                    <div className="relative w-16 shrink-0">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted text-xs">{currency}</span>
                      <input
                        className="input pl-5 py-1.5 text-sm w-full"
                        type="number"
                        step="any"
                        min="0"
                        placeholder="0"
                        value={paidAmounts[m.id] ?? ''}
                        onFocus={e => {
                          if (unassigned > 0) setPaidAmounts(prev => ({ ...prev, [m.id]: fmt(unassigned) }))
                          selectAll(e)
                        }}
                        onChange={e => setPaidAmounts(prev => ({ ...prev, [m.id]: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* Inline calculator row */}
                  {isCalcOpen && (
                    <div className="flex items-center gap-1.5">
                      <span className="flex-1 min-w-0" />
                      <span className="w-5 shrink-0" />
                      <input
                        className="input py-1 text-sm w-16 shrink-0 text-center"
                        type="text"
                        placeholder="a+b+c"
                        value={calcExpr}
                        autoFocus
                        onChange={e => setCalcExpr(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && calcSum > 0) {
                            setCustomAmounts(prev => ({ ...prev, [m.id]: fmt(calcSum) }))
                            setCalcOpen(null); setCalcExpr('')
                          }
                          if (e.key === 'Escape') { setCalcOpen(null); setCalcExpr('') }
                        }}
                      />
                      <button
                        type="button"
                        disabled={calcSum <= 0}
                        className="w-16 shrink-0 text-xs text-center text-accent font-semibold py-1 disabled:opacity-40"
                        onClick={() => {
                          if (calcSum > 0) setCustomAmounts(prev => ({ ...prev, [m.id]: fmt(calcSum) }))
                          setCalcOpen(null); setCalcExpr('')
                        }}
                      >
                        {calcSum > 0 ? `= ${fmt(calcSum)}` : '='}
                      </button>
                      <span className="w-16 shrink-0" />
                    </div>
                  )}
                </Fragment>
              )
            })}
          </div>

          {/* Unassigned indicator — only shown when there's a mismatch */}
          {finalTotal > 0 && Math.abs(unassigned) >= 0.01 && (
            <div className="flex justify-end mt-2">
              <span className="text-xs font-medium text-ink-muted">
                {unassigned > 0
                  ? `${currency}${unassigned.toFixed(2)} unassigned`
                  : `Over by ${currency}${Math.abs(unassigned).toFixed(2)}`}
              </span>
            </div>
          )}
        </div>

        {error && <p className="text-red text-sm">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className={`btn ${
            payers.length > 0 && Math.abs(unassigned) >= 0.01
              ? 'btn-danger'
              : description.trim() && computedCustomSplits.length > 0 && payers.length > 0
                ? 'btn-success'
                : 'btn-primary'
          }`}
        >
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </div>
  )
}
