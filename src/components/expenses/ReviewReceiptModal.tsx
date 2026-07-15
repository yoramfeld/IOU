'use client'

import { useState, useEffect } from 'react'
import type { ReceiptDetail } from '@/types'

interface Props {
  receiptId: string
  memberId: string
  currency: string
  onClose: () => void
  onSubmitted: () => void
}

export default function ReviewReceiptModal({
  receiptId,
  memberId,
  currency,
  onClose,
  onSubmitted,
}: Props) {
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null)
  const [included, setIncluded] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/receipts?receiptId=${receiptId}&memberId=${memberId}`)
      .then((res) => res.json())
      .then((data: ReceiptDetail) => {
        setReceipt(data)
        const initial: Record<string, boolean> = {}
        for (const item of data.items) initial[item.id] = item.included
        setIncluded(initial)
      })
      .finally(() => setLoading(false))
  }, [receiptId, memberId])

  function toggle(itemId: string) {
    setIncluded((prev) => ({ ...prev, [itemId]: !prev[itemId] }))
  }

  // Can't uncheck yourself as the sole remaining consumer of an item.
  function isLastMember(item: ReceiptDetail['items'][number]) {
    return included[item.id] && item.memberCount <= 1
  }

  const yourTotal = receipt
    ? receipt.items.reduce((sum, item) => {
        if (!included[item.id]) return sum
        // Best-effort client preview: count myself among however many are currently
        // included in this item on the server, plus/minus my own toggle.
        const othersIncluded = item.included
          ? item.memberCount - 1
          : item.memberCount
        const nowIncludedCount = othersIncluded + 1
        return sum + item.amount / Math.max(1, nowIncludedCount)
      }, 0)
    : 0

  async function handleSubmit() {
    if (!receipt) return
    setSubmitting(true)
    setError('')
    try {
      const itemStates = receipt.items.map((item) => ({
        itemId: item.id,
        included: !!included[item.id],
      }))
      const res = await fetch('/api/receipts/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptId, memberId, itemStates }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed')
      }
      onSubmitted()
    } catch {
      setError('Could not save — try again')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center">
      <div className="bg-white rounded-t-2xl w-full max-w-sm max-h-[90dvh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Review receipt</h2>
          <button
            onClick={onClose}
            className="text-ink-muted text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {loading || !receipt ? (
          <p className="text-center text-ink-muted py-8">Loading...</p>
        ) : (
          <>
            <p className="text-xs text-ink-soft">
              Uncheck anything you didn't have. Tax/tip are split proportionally
              among what you keep.
            </p>

            {receipt.merchantName && (
              <p className="text-sm font-semibold">{receipt.merchantName}</p>
            )}

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={receipt.imageUrl}
              alt="Receipt"
              className="w-full rounded-lg border border-border"
            />

            {receipt.items.length === 0 ? (
              <p className="text-sm text-ink-muted text-center py-4">
                {receipt.ocrStatus === 'pending' ||
                receipt.ocrStatus === 'processing'
                  ? 'Receipt items are still being extracted.'
                  : receipt.ocrStatus === 'error'
                    ? 'Receipt scan failed. Use the image to review this bill for now.'
                    : 'No line items were extracted from this receipt.'}
              </p>
            ) : (
              <div className="space-y-2" dir={receipt.direction}>
                {receipt.items.map((item) => {
                  const disabled = isLastMember(item)
                  return (
                    <label
                      key={item.id}
                      className={`flex items-center gap-2.5 py-1 ${disabled ? 'opacity-60' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={!!included[item.id]}
                        disabled={disabled}
                        onChange={() => toggle(item.id)}
                        className="w-4 h-4 shrink-0"
                      />
                      <span className="flex-1 text-sm truncate">
                        {item.description}
                      </span>
                      <span className="text-sm text-ink-muted">
                        {currency}
                        {item.amount}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            {(receipt.subtotal !== null ||
              receipt.tax !== null ||
              receipt.tip !== null ||
              receipt.parsedTotal !== null) && (
              <div className="text-xs text-ink-muted border-t border-border pt-2 space-y-1">
                {receipt.subtotal !== null && (
                  <div className="flex justify-between">
                    <span>OCR subtotal</span>
                    <span>
                      {currency}
                      {receipt.subtotal}
                    </span>
                  </div>
                )}
                {receipt.tax !== null && (
                  <div className="flex justify-between">
                    <span>OCR tax</span>
                    <span>
                      {currency}
                      {receipt.tax}
                    </span>
                  </div>
                )}
                {receipt.tip !== null && (
                  <div className="flex justify-between">
                    <span>OCR tip/service</span>
                    <span>
                      {currency}
                      {receipt.tip}
                    </span>
                  </div>
                )}
                {receipt.parsedTotal !== null && (
                  <div className="flex justify-between">
                    <span>OCR total</span>
                    <span>
                      {currency}
                      {receipt.parsedTotal}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-sm font-medium">Your total</span>
              <span className="text-lg font-bold">
                {currency}
                {Math.round(yourTotal * 100) / 100}
              </span>
            </div>

            {error && <p className="text-red text-sm">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={submitting || receipt.items.length === 0}
              className="btn btn-primary"
            >
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
