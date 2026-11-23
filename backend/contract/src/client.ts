import type { z } from 'zod'
import { createHttp, type HttpOptions, type CallOptions } from './http.js'
import { PageQuery } from './primitives.js'
import * as s from './schemas.js'

export function createClient(baseUrl: string, options: Omit<HttpOptions, 'apiError'> = {}) {
  const http = createHttp(baseUrl, { ...options, apiError: s.ApiError })
  const id = encodeURIComponent
  return {
    health: (options?: CallOptions) => http.get('/health', s.Health, options),
    config: (options?: CallOptions) => http.get('/v1/config', s.Config, options),
    stats: (options?: CallOptions) => http.get('/v1/stats', s.Stats, options),
    home: (options?: CallOptions) => http.get('/v1/home', s.Home, options),
    models: (query: z.input<typeof s.ModelQuery> = {}, options?: CallOptions) => http.get('/v1/models', s.ModelsPage, { ...options, query }),
    model: (model: string, options?: CallOptions) => http.get(`/v1/models/${id(model)}`, s.Model, options),
    weights: (model: string, query: z.input<typeof s.WeightsRangeQuery> = {}, options?: CallOptions) => http.get(`/v1/models/${id(model)}/weights`, s.WeightsRange, { ...options, query }),
    modelEnclaves: (model: string, options?: CallOptions) => http.get(`/v1/models/${id(model)}/enclaves`, s.GrantedEnclaves, options),
    modelReceipts: (model: string, query: z.input<typeof PageQuery> = {}, options?: CallOptions) => http.get(`/v1/models/${id(model)}/receipts`, s.ReceiptsPage, { ...options, query }),
    quoteModel: (body: z.input<typeof s.ModelCostRequest>, options?: CallOptions) => http.post('/v1/models/quote', s.ModelCostQuote, body, options),
    createModel: (body: z.input<typeof s.CreateModelRequest>, options?: CallOptions) => http.post('/v1/models/build', s.Build, body, options),
    attachWeights: (model: string, body: z.input<typeof s.AttachWeightsRequest>, options?: CallOptions) => http.post(`/v1/models/${id(model)}/weights/attach/build`, s.Build, body, options),
    writeWeights: (model: string, body: z.input<typeof s.WriteWeightsRequest>, options?: CallOptions) => http.post(`/v1/models/${id(model)}/write/build`, s.Build, body, options),
    sealRange: (model: string, body: z.input<typeof s.SealRangeRequest>, options?: CallOptions) => http.post(`/v1/models/${id(model)}/seal-range/build`, s.Build, body, options),
    sealModel: (model: string, body: z.input<typeof s.SealModelRequest>, options?: CallOptions) => http.post(`/v1/models/${id(model)}/seal/build`, s.Build, body, options),
    setPrice: (model: string, body: z.input<typeof s.SetPriceRequest>, options?: CallOptions) => http.post(`/v1/models/${id(model)}/price/build`, s.Build, body, options),
    grantByOwner: (model: string, body: z.input<typeof s.GrantRequest>, options?: CallOptions) => http.post(`/v1/models/${id(model)}/grant/build`, s.Build, body, options),
    revokeGrant: (model: string, body: z.input<typeof s.RevokeGrantRequest>, options?: CallOptions) => http.post(`/v1/models/${id(model)}/revoke/build`, s.Build, body, options),
    retireModel: (model: string, body: z.input<typeof s.WalletRequest>, options?: CallOptions) => http.post(`/v1/models/${id(model)}/retire/build`, s.Build, body, options),
    modelPolicy: (model: string, options?: CallOptions) => http.get(`/v1/models/${id(model)}/policy`, s.ModelPolicy, options),
    setPolicy: (model: string, body: z.input<typeof s.SetPolicyRequest>, options?: CallOptions) => http.post(`/v1/models/${id(model)}/policy/build`, s.Build, body, options),
    clearPolicy: (model: string, body: z.input<typeof s.WalletRequest>, options?: CallOptions) => http.post(`/v1/models/${id(model)}/policy/clear/build`, s.Build, body, options),
    enclaves: (query: z.input<typeof PageQuery> = {}, options?: CallOptions) => http.get('/v1/enclaves', s.EnclavesPage, { ...options, query }),
    enclave: (key: string, options?: CallOptions) => http.get(`/v1/enclaves/${id(key)}`, s.EnclaveDetail, options),
    setQuote: (key: string, body: z.input<typeof s.SetQuoteRequest>, options?: CallOptions) => http.post(`/v1/enclaves/${id(key)}/quote/build`, s.Build, body, options),
    measurements: (query: z.input<typeof s.MeasurementQuery> = {}, options?: CallOptions) => http.get('/v1/measurements', s.MeasurementsPage, { ...options, query }),
    measurement: (digest: string, options?: CallOptions) => http.get(`/v1/measurements/${id(digest)}`, s.MeasurementRecord, options),
    publishMeasurement: (body: z.input<typeof s.PublishMeasurementRequest>, options?: CallOptions) => http.post('/v1/measurements/build', s.Build, body, options),
    deprecateMeasurement: (digest: string, body: z.input<typeof s.WalletRequest>, options?: CallOptions) => http.post(`/v1/measurements/${id(digest)}/deprecate/build`, s.Build, body, options),
    receipt: (receiptOrCallOrSignature: string, options?: CallOptions) => http.get(`/v1/receipts/${id(receiptOrCallOrSignature)}`, s.ReceiptView, options),
    account: (wallet: string, options?: CallOptions) => http.get(`/v1/accounts/${id(wallet)}`, s.Account, options),
    openCall: (body: z.input<typeof s.OpenCallRequest>, options?: CallOptions) => http.post('/v1/calls/build', s.Build, body, options),
    call: (call: string, options?: CallOptions) => http.get(`/v1/calls/${id(call)}`, s.Call, options),
    relayInput: (call: string, body: z.input<typeof s.RelayInputRequest>, options?: CallOptions) => http.post(`/v1/calls/${id(call)}/input`, s.RelayAccepted, body, options),
    answer: (call: string, options?: CallOptions) => http.get(`/v1/calls/${id(call)}/answer`, s.CallAnswer, options),
    callPieces: (call: string, options?: CallOptions) => http.get(`/v1/calls/${id(call)}/pieces`, s.CallPieces, options),
    stopCall: (call: string, body: z.input<typeof s.StopCallRequest>, options?: CallOptions) => http.post(`/v1/calls/${id(call)}/stop`, s.StopCallAccepted, body, options),
    settleCall: (call: string, body: z.input<typeof s.SettleCallRequest>, options?: CallOptions) => http.post(`/v1/calls/${id(call)}/settle/build`, s.Build, body, options),
    refundCall: (call: string, body: z.input<typeof s.WalletRequest>, options?: CallOptions) => http.post(`/v1/calls/${id(call)}/refund/build`, s.Build, body, options),
    bounties: (query: z.input<typeof s.BountyQuery> = {}, options?: CallOptions) => http.get('/v1/bounties', s.BountiesPage, { ...options, query }),
    bounty: (address: string, options?: CallOptions) => http.get(`/v1/bounties/${id(address)}`, s.BountyDetail, options),
    postBounty: (body: z.input<typeof s.PostBountyRequest>, options?: CallOptions) => http.post('/v1/bounties/build', s.Build, body, options),
    drawBounty: (address: string, body: z.input<typeof s.DrawBountyRequest>, options?: CallOptions) => http.post(`/v1/bounties/${id(address)}/draw/build`, s.Build, body, options),
    collectBounty: (address: string, body: z.input<typeof s.CollectBountyRequest>, options?: CallOptions) => http.post(`/v1/bounties/${id(address)}/collect/build`, s.Build, body, options),
    cancelBounty: (address: string, body: z.input<typeof s.WalletRequest>, options?: CallOptions) => http.post(`/v1/bounties/${id(address)}/cancel/build`, s.Build, body, options),
    submitTransaction: (body: z.input<typeof s.TxSubmission>, options?: CallOptions) => http.post('/v1/transactions/submit', s.TxStatus, body, options),
    transaction: (transaction: string, options?: CallOptions) => http.get(`/v1/transactions/${id(transaction)}`, s.TxStatus, options),
    eventsUrl: () => http.streamUrl('/v1/events'),
    callEventsUrl: (call: string) => http.streamUrl(`/v1/calls/${id(call)}/events`),
    callStreamUrl: (call: string, after?: number) => http.streamUrl(`/v1/calls/${id(call)}/stream`, after === undefined ? {} : { after }),
  }
}

export type VoynichClient = ReturnType<typeof createClient>
