'use client'

import { useState, useRef } from 'react'
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
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  function parseSum(expr: string): number {
    return expr.split('+').reduce((s, v) => s + (parseFloat(v.trim()) || 0), 0)
  }

  // Cascade ceiled distribution starting at pivotIdx; members before pivot untouched
  function handleOrderedChange(pivotIdx: number, pivotMemberId: string, rawValue: string) {
    const val = parseFloat(rawValue) || 0
    const ceiled = val > 0 ? Math.ceil(val) : 0
    const bRef = parseFloat(amount) || 0

    setCustomAmounts(prev => {
      const result: Record<string, string> = { ...prev, [pivotMemberId]: ceiled > 0 ? String(ceiled) : '' }
      if (bRef <= 0) return result   // no bill to cascade against
      const fixedSum = members.slice(0, pivotIdx).reduce((s, m) => s + (parseFloat(prev[m.id]) || 0), 0)
      let remaining = bRef - fixedSum - ceiled
      const following = members.slice(pivotIdx + 1)
      for (let i = 0; i < following.length; i++) {
        if (remaining <= 0) {
          result[following[i].id] = ''
        } else {
          const share = Math.ceil(remaining / (following.length - i))
          result[following[i].id] = String(share)
          remaining -= share
        }
      }
      return result
    })
  }

  function handleBillChange(value: string) {
    setAmount(value)
    const billRef = parseFloat(value) || 0
    if (billRef > 0) {
      const newAmounts: Record<string, string> = {}
      let remaining = billRef
      for (let i = 0; i < members.length; i++) {
        if (remaining <= 0) { newAmounts[members[i].id] = ''; continue }
        const share = Math.ceil(remaining / (members.length - i))
        newAmounts[members[i].id] = String(share)
        remaining -= share
      }
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

  // --- Ordered unassigned (vs bill) ---
  const billVal = parseFloat(amount) || 0
  const orderedUnassigned = billVal > 0 ? Math.round((billVal - subtotal) * 100) / 100 : 0

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
          <div className="flex-1">
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
          <div className="w-[22%]">
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
              <span className="text-xs font-medium text-ink-soft">Grand Total</span>
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
            <input
              className="input py-3 text-sm font-semibold text-right bg-surface"
              type="text"
              readOnly
              value={finalTotal > 0 ? `${currency}${fmt(finalTotal)}` : ''}
              placeholder=""
            />
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
            <span className="w-16 shrink-0 text-xs font-medium text-ink-soft text-center">Ordered</span>
            <span className="w-16 shrink-0 text-xs font-medium text-ink-soft text-center">Total</span>
            <span className="w-16 shrink-0 text-xs font-medium text-ink-soft text-center">Paid</span>
          </div>

          <div className="space-y-2">
            {members.map((m, memberIdx) => {
              const label = m.name + (m.id === currentMemberId ? ' (you)' : '')
              const share = parseFloat(customAmounts[m.id] || '0')
              const owes = share > 0 ? Math.ceil(share * (1 + tipPct / 100) * scaleFactor) : 0
              function openCalc() { setCalcOpen(m.id); setCalcExpr('') }
              return (
                <div key={m.id} className="flex items-center gap-1.5">
                  <span className="text-sm flex-1 truncate min-w-0">{label}</span>

                  {/* Ordered — ceil on change; cascade to following members; double-click/long-press opens calc */}
                  <div className="relative w-16 shrink-0">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted text-xs">{currency}</span>
                    <input
                      className="input pl-5 py-1.5 text-sm w-full"
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0"
                      value={customAmounts[m.id] ?? ''}
                      onFocus={selectAll}
                      onChange={e => handleOrderedChange(memberIdx, m.id, e.target.value)}
                      onDoubleClick={openCalc}
                      onPointerDown={() => { longPressTimer.current = setTimeout(openCalc, 500) }}
                      onPointerUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current) }}
                      onPointerCancel={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current) }}
                    />
                  </div>

                  {/* Total (read-only, ceiled) */}
                  <div className="relative w-16 shrink-0">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted text-xs">{currency}</span>
                    <input
                      className="input pl-5 py-1.5 text-sm w-full bg-surface text-ink-muted"
                      type="text"
                      readOnly
                      value={owes > 0 ? String(owes) : ''}
                      placeholder="0"
                    />
                  </div>

                  {/* Paid — ceil on blur; snap to ceil(unassigned) on focus */}
                  <div className="relative w-16 shrink-0">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted text-xs">{currency}</span>
                    <input
                      className="input pl-5 py-1.5 text-sm w-full"
                      type="number"
                      step="1"
                      min="0"
                      placeholder="0"
                      value={paidAmounts[m.id] ?? ''}
                      onFocus={e => {
                        if (unassigned > 0) setPaidAmounts(prev => ({ ...prev, [m.id]: String(Math.ceil(unassigned)) }))
                        selectAll(e)
                      }}
                      onChange={e => setPaidAmounts(prev => ({ ...prev, [m.id]: e.target.value }))}
                      onBlur={e => {
                        const val = parseFloat(e.target.value)
                        if (val > 0) setPaidAmounts(prev => ({ ...prev, [m.id]: String(Math.ceil(val)) }))
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Unassigned indicators */}
          {(Math.abs(orderedUnassigned) >= 0.01 || (finalTotal > 0 && Math.abs(unassigned) >= 0.01)) && (
            <div className="flex justify-end mt-2 gap-2">
              {Math.abs(orderedUnassigned) >= 0.01 && (
                <span className="text-xs font-medium text-ink-muted w-16 text-center">
                  {orderedUnassigned > 0
                    ? `${currency}${orderedUnassigned.toFixed(2)} left`
                    : `+${currency}${Math.abs(orderedUnassigned).toFixed(2)}`}
                </span>
              )}
              {Math.abs(orderedUnassigned) < 0.01 && finalTotal > 0 && Math.abs(unassigned) >= 0.01 && (
                <span className="w-16" />
              )}
              {finalTotal > 0 && Math.abs(unassigned) >= 0.01 && (
                <>
                  <span className="w-16" />
                  <span className="text-xs font-medium text-ink-muted w-16 text-center">
                    {unassigned > 0
                      ? `${currency}${unassigned.toFixed(2)} left`
                      : `+${currency}${Math.abs(unassigned).toFixed(2)}`}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-red text-sm">{error}</p>}

        {/* Calculator modal */}
        {calcOpen && (() => {
          const calcSum = parseSum(calcExpr)
          const calcMemberIdx = members.findIndex(m => m.id === calcOpen)
          const memberName = members[calcMemberIdx]?.name ?? ''
          function applyCalc() {
            if (calcSum > 0) handleOrderedChange(calcMemberIdx, calcOpen!, String(calcSum))
            setCalcOpen(null); setCalcExpr('')
          }
          return (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
              onClick={() => { setCalcOpen(null); setCalcExpr('') }}
            >
              <div className="bg-white rounded-2xl p-5 w-72 shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
                <p className="text-sm font-semibold">{memberName} — Ordered</p>
                <input
                  className="input text-center text-base"
                  type="text"
                  placeholder="15 + 8 + 12"
                  value={calcExpr}
                  autoFocus
                  onChange={e => setCalcExpr(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') applyCalc()
                    if (e.key === 'Escape') { setCalcOpen(null); setCalcExpr('') }
                  }}
                />
                {calcExpr && (
                  <p className="text-center text-2xl font-bold text-accent">
                    {calcSum > 0 ? `${currency}${fmt(calcSum)}` : '—'}
                  </p>
                )}
                <div className="flex gap-2">
                  <button className="btn btn-outline btn-sm flex-1" onClick={() => { setCalcOpen(null); setCalcExpr('') }}>Cancel</button>
                  <button className="btn btn-primary btn-sm flex-1" disabled={calcSum <= 0} onClick={applyCalc}>Use {calcSum > 0 ? fmt(calcSum) : ''}</button>
                </div>
              </div>
            </div>
          )
        })()}

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
