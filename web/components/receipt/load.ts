// One receipt with what its page needs beside it: the model (its name, the unit of its price) and the API's config for the checks.

import type { Config, MeasurementRecord, Model, ReceiptView, VoynichClient } from '@voynich/contract'
import { read, type Read } from '@/lib/api'

export type ReceiptBundle = { view: ReceiptView; model: Model | null; config: Config | null; measurement?: MeasurementRecord | null }

export async function loadReceipt(client: VoynichClient, id: string): Promise<Read<ReceiptBundle>> {
  const r = await read(client.receipt(id))
  if (!r.ok) return r
  const [model, config, meas] = await Promise.all([
    read(client.model(r.data.receipt.model)),
    read(client.config()),
    read(client.measurement(r.data.attestationRecord.measurement)),
  ])
  return {
    ok: true,
    data: {
      view: r.data,
      model: model.ok ? model.data : null,
      config: config.ok ? config.data : null,
      measurement: meas.ok ? meas.data : null,
    },
  }
}

// An id the API has nothing under, or that is not an id at all.
export const isNotFound = (code: string) => code === 'RECEIPT_NOT_FOUND' || code === 'NOT_FOUND' || code === 'VALIDATION_ERROR'
