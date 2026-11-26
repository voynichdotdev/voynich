import type { Prisma, PrismaClient } from '@prisma/client'
import { PublicKey, type Connection } from '@solana/web3.js'
import { decodeManifest, type AccountPasses, type AttestationRecord, type BenchmarkQuery, type BenchmarkRecord, type Bounty, type BountyAttempt, type BountyDetail, type BountyQuery, type Call, type Enclave, type Grant, type MeasurementQuery, type MeasurementRecord, type Model, type ModelBase, type ModelPolicy, type ModelSplit, type Money, type OperatorBond, type Pass, type PassPlan, type Receipt, type ModelQuery } from '@voynich/contract'
import { toBase64 } from 'voynich/crypto'
import { fail } from './errors.js'

type ModelRow = Prisma.ModelGetPayload<{ include: { weights: true } }>
type EnclaveRow = Prisma.EnclaveGetPayload<{ include: { attestationRecord: true; bond: true } }>
type GrantRow = Prisma.GrantGetPayload<{ include: { model: true; enclave: { include: { attestationRecord: true; bond: true } } } }>
type ReceiptRow = Prisma.ReceiptGetPayload<{ include: { call: { select: { caller: true; callerIsProgram: true } }; model: true; payments: true; attestationRecord: true } }>
const callInclude = { receipt: true, model: { select: { name: true } } } as const
type CallRow = Prisma.CallGetPayload<{ include: typeof callInclude }>
type Page = { limit: number; cursor?: string }
const enclaveInclude = { attestationRecord: true, bond: true } as const
const grantInclude = { model: true, enclave: { include: enclaveInclude } } as const
const receiptInclude = { call: { select: { caller: true, callerIsProgram: true } }, model: true, payments: true, attestationRecord: true } as const
const page = <T>(rows: T[], query: Page) => ({ items: rows.slice(0, query.limit), page: { nextCursor: rows.length > query.limit ? String(Number(query.cursor ?? 0) + query.limit) : null, hasMore: rows.length > query.limit }, asOf: new Date().toISOString() })
const enclaveRank = (enclave: Enclave) => (enclave.status === 'live' ? 2 : 0) + Number(enclave.reachable)
const rankEnclaves = (left: Enclave, right: Enclave) => enclaveRank(right) - enclaveRank(left) || left.address.localeCompare(right.address)

export class ReadModel {
  constructor(readonly db: PrismaClient, readonly connection: Connection, readonly programId: PublicKey, readonly attestProgramId: PublicKey) {}

  protocol() { return this.db.sharedProtocolState.findUnique({ where: { id: 'protocol' } }) }
  async config() {
    const value = (await this.protocol())?.config ?? null
    return value as { feeRecipient: string; protocolShareBps: number; callDeadlineSlots: string; maxOpenAnswerBytes?: number; attestationRecordLayoutVersion: number; attestationProgramId: string } | null
  }
  async currentSlot() { return (await this.protocol())?.currentSlot ?? 0n }
  async uploadTransactions(model: string) {
    const facts = JSON.stringify({ events: [{ name: 'weightswritten', data: { model } }] })
    const rows = await this.db.$queryRaw<{ count: string }[]>`SELECT count(*)::text AS count FROM indexed_transactions WHERE failed = false AND applied_at IS NOT NULL AND facts @> ${facts}::jsonb`
    return Number(rows[0]!.count)
  }
  async money(amount: string, mint: string | null): Promise<Money> {
    if (!mint) return { amount, mint: null, decimals: 9, symbol: 'SOL' }
    const row = await this.db.tokenMint.findUnique({ where: { mint } })
    if (!row) fail('UPSTREAM_UNAVAILABLE', 'This token mint has not been indexed yet.', { retryable: true })
    return { amount, mint, decimals: row.decimals, symbol: row.symbol }
  }
  async modelRow(row: ModelRow): Promise<Model> {
    const [slot, config] = await Promise.all([this.currentSlot(), this.config()])
    const sizeBytes = Number(row.ciphertextSize)
    const weights = row.weights.sort((a, b) => a.index - b.index).map(item => ({ address: item.address, model: item.modelAddress, index: item.index, offset: Number(item.offset), sizeBytes: Number(item.size), writtenRanges: item.writtenRanges as { offset: number; length: number }[] }))
    const enclavesHolding = row.allowedMeasurements.length === 0
      ? 0
      : await this.db.grant.count({
          where: {
            modelAddress: row.address,
            revokedSlot: null,
            enclave: {
              attestationRecord: {
                expiresAtSlot: { gt: slot },
                measurement: { in: row.allowedMeasurements },
              },
            },
          },
        })
    return {
      address: row.address, name: row.name, owner: row.owner, createdSlot: String(row.createdSlot), sealedSlot: row.sealedSlot === null ? null : String(row.sealedSlot),
      sizeBytes, plaintextSizeBytes: Number(row.plaintextSize), ciphertextSha256: row.ciphertextSha256,
      hashVersion: row.hashVersion, sealedChunks: row.sealedChunks,
      base: row.baseSha256 && row.baseSizeBytes !== null && row.baseFormat && row.baseSource
        ? { sha256: row.baseSha256, sizeBytes: Number(row.baseSizeBytes), format: row.baseFormat as NonNullable<Model['base']>['format'], source: row.baseSource }
        : null,
      cipher: { id: 'xchacha20poly1305-64k-v1', chunkSizeBytes: 65536, noncePrefix: toBase64(row.noncePrefix) }, allowedMeasurements: row.allowedMeasurements,
      price: await this.money(row.price.toFixed(0), row.priceMint), priceUnit: row.priceUnit, operatorShareBps: row.operatorShareBps, protocolShareBps: config?.protocolShareBps ?? null,
      status: row.status, manifest: decodeManifest(row.manifest), weights, enclavesHolding, callsSettled: String(row.callsSettled),
      currentVersion: row.currentVersion ?? 1,
      hasSplit: row.hasSplit ?? false,
      upload: row.uploadKey ? { uploadKey: row.uploadKey, uploadKeys: row.uploadKeys.length ? row.uploadKeys : [row.uploadKey], bytesWritten: row.weights.reduce((total, weight) => total + Number(weight.bytesWritten), 0), transactionsWritten: await this.uploadTransactions(row.address), writtenRanges: weights.flatMap(weight => weight.writtenRanges.map(range => ({ offset: range.offset + weight.offset, length: range.length }))), closed: row.status !== 'uploading' } : null,
    }
  }
  async modelVersions(id: string) {
    const model = await this.model(id)
    const rows = await this.db.modelVersion.findMany({
      where: { modelAddress: model.address },
      orderBy: { version: 'desc' },
    })
    const items = rows.length > 0
      ? rows.map(row => ({
          model: row.modelAddress,
          version: row.version,
          address: row.address,
          status: row.status,
          sizeBytes: Number(row.sizeBytes),
          ciphertextSha256: row.ciphertextSha256,
          base: row.baseSha256 && row.baseSizeBytes !== null && row.baseFormat && row.baseSource
            ? { sha256: row.baseSha256, sizeBytes: Number(row.baseSizeBytes), format: row.baseFormat as NonNullable<Model['base']>['format'], source: row.baseSource }
            : null,
          manifest: row.manifest ? decodeManifest(row.manifest) : null,
          publishedSlot: row.publishedSlot === null ? null : String(row.publishedSlot),
        }))
      : [{
          model: model.address,
          version: 1,
          address: null,
          status: model.status === 'uploading' ? 'uploading' as const : 'live' as const,
          sizeBytes: model.sizeBytes,
          ciphertextSha256: model.ciphertextSha256,
          base: model.base,
          manifest: model.manifest,
          publishedSlot: model.sealedSlot,
        }]
    return { items, currentVersion: model.currentVersion ?? 1 }
  }
  private async sessionRow(row: { address: string; caller: string; delegate: string; nonce: string; mint: string | null; modelAddress: string | null; budget: Prisma.Decimal; spent: Prisma.Decimal; callsOpened: bigint; openedSlot: bigint; expiresAtSlot: bigint; closedSlot: bigint | null; returnedAmount: Prisma.Decimal | null; status: 'open' | 'closed' }) {
    const budgetBig = BigInt(row.budget.toFixed(0))
    const spentBig = BigInt(row.spent.toFixed(0))
    const remainingBig = budgetBig > spentBig ? budgetBig - spentBig : 0n
    return {
      address: row.address,
      caller: row.caller,
      delegate: row.delegate,
      nonce: row.nonce,
      mint: row.mint,
      model: row.modelAddress,
      budget: await this.money(row.budget.toFixed(0), row.mint),
      spent: String(spentBig),
      remaining: String(remainingBig),
      callsOpened: String(row.callsOpened),
      openedSlot: String(row.openedSlot),
      expiresAtSlot: String(row.expiresAtSlot),
      closedSlot: row.closedSlot === null ? null : String(row.closedSlot),
      returnedAmount: row.returnedAmount === null ? null : row.returnedAmount.toFixed(0),
      status: row.status,
    }
  }
  async session(address: string) {
    const row = await this.db.session.findUnique({ where: { address } })
    if (!row) fail('SESSION_NOT_FOUND', 'This session was not found.')
    return this.sessionRow(row)
  }
  async accountSessions(wallet: string) {
    const rows = await this.db.session.findMany({
      where: { caller: wallet },
      orderBy: [{ openedSlot: 'desc' }, { address: 'asc' }],
    })
    return { items: await Promise.all(rows.map(row => this.sessionRow(row))), asOf: new Date().toISOString() }
  }
  async model(id: string) {
    const row = await this.db.model.findFirst({ where: { OR: [{ address: id }, { name: id }] }, include: { weights: true } })
    if (!row) fail('MODEL_NOT_FOUND', 'This model was not found.')
    if (row.indexingIssue) fail('PROGRAM_REFUSED', row.indexingIssue)
    return this.modelRow(row)
  }
  async models(query: ModelQuery) {
    const orderBy = query.sort === 'price' ? { price: 'asc' as const } : query.sort === 'newest' ? { createdSlot: 'desc' as const } : { callsSettled: 'desc' as const }
    const rows = await this.db.model.findMany({ where: { indexingIssue: null }, orderBy: [orderBy, { address: 'asc' }], include: { weights: true }, skip: Number(query.cursor ?? 0), take: query.limit + 1 })
    return page(await Promise.all(rows.map(row => this.modelRow(row))), query)
  }
  attestationRow(row: EnclaveRow['attestationRecord'], encryptionKey: Uint8Array): AttestationRecord {
    return { address: row.address, signingKey: row.signingKey, encryptionKey: toBase64(encryptionKey), hardwareType: row.hardwareType === 'sev_snp' ? 'sev-snp' : row.hardwareType, measurement: row.measurement, recordedSlot: String(row.recordedSlot), expiresAtSlot: String(row.expiresAtSlot), layoutVersion: row.layoutVersion }
  }
  async enclaveRow(row: EnclaveRow): Promise<Enclave> {
    const slot = await this.currentSlot()
    return {
      address: row.address, signingKey: row.signingKey, encryptionKey: toBase64(row.encryptionKey), operator: row.operator, endpoint: row.endpoint, relayPath: '/v1/calls/{call}/input', hardwareType: row.attestationRecord.hardwareType === 'sev_snp' ? 'sev-snp' : row.attestationRecord.hardwareType, measurement: row.attestationRecord.measurement, expiresAtSlot: String(row.attestationRecord.expiresAtSlot), status: row.attestationRecord.expiresAtSlot > slot ? 'live' : 'expired', reachable: row.reachable, lastSeen: row.lastSeen?.toISOString() ?? null, callsSettled: String(row.callsSettled), modelsHeld: await this.db.grant.count({ where: { enclaveAddress: row.address, revokedSlot: null } }), attestation: this.attestationRow(row.attestationRecord, row.encryptionKey),
      ...(row.bond ? { bondedLamports: row.bond.bondedLamports.toFixed(0), missedCalls: String(row.bond.missedCalls), slashedTotal: row.bond.slashedTotal.toFixed(0) } : {}),
    }
  }
  async grantRow(row: GrantRow): Promise<Grant> {
    return { address: row.address, model: row.modelAddress, modelName: row.model.name, enclave: row.enclaveAddress, wrappedKey: toBase64(row.wrappedKey), grantedBy: row.grantedBy, grantedSlot: String(row.grantedSlot), status: row.revokedSlot !== null ? 'revoked' : row.enclave.attestationRecord.expiresAtSlot <= await this.currentSlot() ? 'expired' : 'live', quotedOperatorShareBps: row.quotedOperatorShareBps ?? null, medianAnswerMs: row.medianAnswerMs ?? null }
  }
  async enclaves(query: Page) {
    const slot = await this.currentSlot()
    const keys = await this.db.$queryRaw<{ address: string }[]>`SELECT e.address FROM enclaves e
      JOIN attestation_records a ON a.address = e."attestationRecordAddress" AND a."recordedSlot" = e."attestationRecordedSlot"
      ORDER BY (a."expiresAtSlot" > ${slot} AND e.reachable) DESC, (a."expiresAtSlot" > ${slot}) DESC, e.reachable DESC, e.address ASC
      OFFSET ${Number(query.cursor ?? 0)} LIMIT ${query.limit + 1}`
    const rows = await this.db.enclave.findMany({ where: { address: { in: keys.map(item => item.address) } }, include: enclaveInclude })
    const byAddress = new Map(rows.map(row => [row.address, row]))
    return page(await Promise.all(keys.map(item => this.enclaveRow(byAddress.get(item.address)!))), query)
  }
  async enclave(key: string) {
    const row = await this.db.enclave.findFirst({ where: { OR: [{ address: key }, { signingKey: key }] }, include: enclaveInclude })
    if (!row) fail('ENCLAVE_NOT_FOUND', 'This enclave was not found.')
    const [grants, receipts, earnings] = await Promise.all([this.db.grant.findMany({ where: { enclaveAddress: row.address }, include: grantInclude }), this.db.receipt.findMany({ where: { enclaveAddress: row.address }, orderBy: { slot: 'desc' }, take: 20, include: receiptInclude }), this.earnings('operator', undefined, row.address)])
    return { enclave: await this.enclaveRow(row), grants: await Promise.all(grants.map(item => this.grantRow(item))), receipts: await Promise.all(receipts.map(item => this.receiptRow(item))), earnings }
  }
  async modelEnclaves(id: string) {
    const model = await this.model(id)
    const rows = await this.db.grant.findMany({ where: { modelAddress: model.address }, include: grantInclude })
    const allowed = new Set(model.allowedMeasurements)
    const items = await Promise.all(rows.map(async row => ({ grant: await this.grantRow(row), enclave: await this.enclaveRow(row.enclave) })))
    const eligible = items.filter(item => item.grant.status === 'live' && item.enclave.status === 'live' && allowed.has(item.enclave.measurement))
    eligible.sort((left, right) => rankEnclaves(left.enclave, right.enclave))
    return { items: eligible, asOf: new Date().toISOString() }
  }
  async receiptRow(row: ReceiptRow): Promise<Receipt> {
    const payment = (role: 'owner' | 'operator' | 'protocol') => { const value = row.payments.find(item => item.role === role)!; return { recipient: value.recipient, amount: value.amount.toFixed(0) } }
    const total = row.payments.reduce((sum, item) => sum + BigInt(item.amount.toFixed(0)), 0n)
    return { address: row.address, call: row.callAddress, caller: row.call.caller, callerIsProgram: row.callerIsProgram || row.call.callerIsProgram, model: row.modelAddress, modelName: row.model.name, enclave: row.enclaveAddress, inputHash: row.inputHash, outputHash: row.outputHash, signature: toBase64(row.enclaveSignature), answerMode: row.answerMode, openAnswer: row.openAnswer ? toBase64(row.openAnswer) : null, deliveredCount: row.deliveredCount === null ? null : String(row.deliveredCount), returnedAmount: row.returnedAmount === null ? null : row.returnedAmount.toFixed(0), slot: String(row.slot), transactionSignature: row.transactionSignature, payments: { mint: row.payments[0]!.mint, total: String(total), owner: payment('owner'), operator: payment('operator'), protocol: payment('protocol') } }
  }
  async receipt(id: string) {
    const row = await this.db.receipt.findFirst({ where: { OR: [{ address: id }, { callAddress: id }, { transactionSignature: id }] }, include: receiptInclude })
    if (!row) fail('RECEIPT_NOT_FOUND', 'This receipt was not found.')
    const enclave = await this.db.enclave.findUniqueOrThrow({ where: { address: row.enclaveAddress } })
    const modelBase: ModelBase | null = row.model.baseSha256 && row.model.baseSizeBytes !== null && row.model.baseFormat && row.model.baseSource
      ? { sha256: row.model.baseSha256, sizeBytes: Number(row.model.baseSizeBytes), format: row.model.baseFormat as ModelBase['format'], source: row.model.baseSource }
      : null
    return { receipt: await this.receiptRow(row), enclaveSigningKey: row.attestationRecord.signingKey, attestationRecord: this.attestationRow(row.attestationRecord, enclave.encryptionKey), attestationProgramId: row.attestationRecord.programId, recordLayoutVersion: row.attestationRecord.layoutVersion, modelBase }
  }
  async modelReceipts(id: string, query: Page) {
    const model = await this.model(id)
    const rows = await this.db.receipt.findMany({ where: { modelAddress: model.address }, orderBy: [{ slot: 'desc' }, { address: 'asc' }], include: receiptInclude, skip: Number(query.cursor ?? 0), take: query.limit + 1 })
    return page(await Promise.all(rows.map(row => this.receiptRow(row))), query)
  }
  async callRow(row: CallRow): Promise<Call> {
    const refundable = row.status === 'open' && row.deadlineSlot < await this.currentSlot()
    const escrow = await this.money(row.escrowAmount.toFixed(0), row.priceMint)
    const unitPrice = row.unitPrice === null ? escrow : await this.money(row.unitPrice.toFixed(0), row.priceMint)
    const ceiling = row.priceUnit === 'token' ? escrow : null
    return { address: row.address, caller: row.caller, callerIsProgram: row.callerIsProgram, model: row.modelAddress, modelName: row.model.name, enclave: row.enclaveAddress, inputHash: row.inputHash, answerMode: row.answerMode, price: escrow, priceUnit: row.priceUnit, unitPrice, ceiling, openedSlot: String(row.openedSlot), deadlineSlot: String(row.deadlineSlot), status: refundable ? 'refundable' : row.status, receipt: row.receipt?.address ?? null, failure: refundable ? { code: 'CALL_DEADLINE_PASSED', message: 'The call passed its settlement deadline.', refundState: 'refundable' } : row.status === 'refunded' ? { code: 'CALL_DEADLINE_PASSED', message: 'The call was refunded in full.', refundState: 'refunded' } : null }
  }
  async call(id: string) {
    const row = await this.db.call.findUnique({ where: { address: id }, include: callInclude })
    if (!row) fail('CALL_NOT_FOUND', 'This call was not found.')
    return this.callRow(row)
  }
  async earnings(role: 'owner' | 'operator', recipient?: string, enclaveAddress?: string) {
    const rows = await this.db.payment.groupBy({ by: ['mint'], where: { role, ...(recipient ? { recipient } : {}), ...(enclaveAddress ? { receipt: { enclaveAddress } } : {}) }, _sum: { amount: true } })
    return Promise.all(rows.map(row => this.money(row._sum.amount!.toFixed(0), row.mint)))
  }
  async account(wallet: string) {
    const [models, enclaves, calls, ownerEarnings, operatorEarnings] = await Promise.all([this.db.model.findMany({ where: { owner: wallet, indexingIssue: null }, include: { weights: true } }), this.db.enclave.findMany({ where: { operator: wallet }, include: enclaveInclude }), this.db.call.findMany({ where: { caller: wallet }, orderBy: { openedSlot: 'desc' }, include: callInclude }), this.earnings('owner', wallet), this.earnings('operator', wallet)])
    return { wallet, models: await Promise.all(models.map(row => this.modelRow(row))), enclaves: (await Promise.all(enclaves.map(row => this.enclaveRow(row)))).sort(rankEnclaves), calls: await Promise.all(calls.map(row => this.callRow(row))), ownerEarnings, operatorEarnings }
  }
  async stats() {
    const slot = await this.currentSlot()
    const [models, enclaves, receipts, programCalls, operatorEarnings] = await Promise.all([
      this.db.model.count(),
      this.db.enclave.count({ where: { attestationRecord: { expiresAtSlot: { gt: slot } } } }),
      this.db.receipt.count(),
      this.db.call.count({ where: { callerIsProgram: true } }),
      this.earnings('operator'),
    ])
    return { models, enclaves, receipts: String(receipts), callsSettled: String(receipts), programCalls: String(programCalls), operatorEarnings, currentSlot: String(slot), asOf: new Date().toISOString() }
  }
  async bountyRow(row: Prisma.BountyGetPayload<Record<string, never>>, modelName: string | null): Promise<Bounty> {
    return {
      address: row.address,
      creator: row.creator,
      nonce: row.nonce.toFixed(0),
      model: row.modelAddress,
      modelName,
      targetLabel: row.targetLabel,
      reward: await this.money(row.amount.toFixed(0), row.mint),
      status: row.status,
      winner: row.winner,
      winningCall: row.winningCall,
      winningReceipt: row.winningReceipt,
      createdSlot: String(row.createdSlot),
      claimedSlot: row.claimedSlot === null ? null : String(row.claimedSlot),
      attempts: String(row.attemptsCount),
    }
  }
  async bounties(query: BountyQuery) {
    let modelAddress: string | undefined
    if (query.model) {
      const resolved = await this.db.model.findFirst({ where: { OR: [{ address: query.model }, { name: query.model }] }, select: { address: true } })
      modelAddress = resolved?.address ?? query.model
    }
    const rows = await this.db.bounty.findMany({
      where: { ...(query.status ? { status: query.status } : {}), ...(modelAddress ? { modelAddress } : {}) },
      orderBy: [{ createdSlot: 'desc' }, { address: 'asc' }],
      skip: Number(query.cursor ?? 0),
      take: query.limit + 1,
    })
    const modelIds = [...new Set(rows.map(item => item.modelAddress))]
    const models = modelIds.length ? await this.db.model.findMany({ where: { address: { in: modelIds } }, select: { address: true, name: true } }) : []
    const names = new Map(models.map(item => [item.address, item.name]))
    return page(await Promise.all(rows.map(row => this.bountyRow(row, names.get(row.modelAddress) ?? null))), query)
  }
  async bounty(address: string): Promise<BountyDetail> {
    const row = await this.db.bounty.findUnique({ where: { address }, include: { attempts: { orderBy: { createdSlot: 'desc' } } } })
    if (!row) fail('BOUNTY_NOT_FOUND', 'This bounty was not found.')
    const modelRow = await this.db.model.findUnique({ where: { address: row.modelAddress }, select: { name: true } })
    const attempts: BountyAttempt[] = row.attempts.map(item => ({
      address: item.address,
      bounty: item.bountyAddress,
      drawer: item.drawer,
      call: item.callAddress,
      createdSlot: String(item.createdSlot),
      refunded: item.refunded,
    }))
    return { bounty: await this.bountyRow(row, modelRow?.name ?? null), attempts }
  }
  measurementRow(row: Prisma.MeasurementGetPayload<Record<string, never>>): MeasurementRecord {
    return {
      address: row.address,
      digest: row.digest,
      publisher: row.publisher,
      sourceRepo: row.sourceRepo,
      commitSha: row.commitSha,
      recipeHash: row.recipeHash,
      version: row.version,
      createdSlot: String(row.createdSlot),
      status: row.status,
    }
  }
  async measurements(query: MeasurementQuery) {
    const rows = await this.db.measurement.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: [{ createdSlot: 'desc' }, { address: 'asc' }],
      skip: Number(query.cursor ?? 0),
      take: query.limit + 1,
    })
    return page(rows.map(row => this.measurementRow(row)), query)
  }
  async measurement(digest: string): Promise<MeasurementRecord> {
    const row = await this.db.measurement.findUnique({ where: { digest } })
    if (!row) fail('MEASUREMENT_NOT_FOUND', 'This measurement was not found.')
    return this.measurementRow(row)
  }
  policyRow(row: Prisma.ModelPolicyGetPayload<Record<string, never>>): ModelPolicy {
    return {
      address: row.address,
      model: row.modelAddress,
      allowListEnabled: row.allowListEnabled,
      allowedCallers: row.allowedCallers,
      maxCallsPerCallerPerWindow: row.maxCallsPerCallerPerWindow,
      windowSlots: String(row.windowSlots),
      allowedOperators: row.allowedOperators,
      allowedRegions: row.allowedRegions,
      updatedSlot: String(row.updatedSlot),
    }
  }
  async modelPolicy(id: string): Promise<ModelPolicy> {
    const resolved = await this.db.model.findFirst({ where: { OR: [{ address: id }, { name: id }] }, select: { address: true } })
    if (!resolved) fail('MODEL_NOT_FOUND', 'This model was not found.')
    const row = await this.db.modelPolicy.findUnique({ where: { modelAddress: resolved.address } })
    if (!row) fail('POLICY_NOT_FOUND', 'No policy is configured for this model.')
    return this.policyRow(row)
  }
  splitRow(row: Prisma.SplitGetPayload<Record<string, never>>): ModelSplit {
    const raw = (row.recipients as { wallet: string; shareBps: number; accrued: string; claimed: string }[]) ?? []
    return {
      address: row.address,
      model: row.modelAddress,
      authority: row.authority,
      mint: row.mint,
      active: row.active,
      totalReceived: row.totalReceived.toFixed(0),
      recipients: raw.map(r => {
        const accrued = BigInt(r.accrued)
        const claimed = BigInt(r.claimed)
        const claimable = accrued > claimed ? accrued - claimed : 0n
        return {
          wallet: r.wallet,
          shareBps: Number(r.shareBps),
          accrued: String(accrued),
          claimed: String(claimed),
          claimable: String(claimable),
        }
      }),
      updatedSlot: String(row.updatedSlot),
    }
  }
  async modelSplit(id: string): Promise<ModelSplit> {
    const resolved = await this.db.model.findFirst({ where: { OR: [{ address: id }, { name: id }] }, select: { address: true } })
    if (!resolved) fail('MODEL_NOT_FOUND', 'This model was not found.')
    const row = await this.db.split.findUnique({ where: { modelAddress: resolved.address } })
    if (!row) fail('SPLIT_NOT_FOUND', 'No revenue split is configured for this model.')
    return this.splitRow(row)
  }
  bondRow(row: Prisma.BondGetPayload<Record<string, never>>): OperatorBond {
    return {
      address: row.address,
      enclave: row.enclaveAddress,
      operator: row.operator,
      bondedLamports: row.bondedLamports.toFixed(0),
      slashedTotal: row.slashedTotal.toFixed(0),
      missedCalls: String(row.missedCalls),
      slashBps: row.slashBps,
      updatedSlot: String(row.updatedSlot),
    }
  }
  async enclaveBond(key: string): Promise<OperatorBond> {
    const resolved = await this.db.enclave.findFirst({ where: { OR: [{ address: key }, { signingKey: key }] }, select: { address: true } })
    if (!resolved) fail('ENCLAVE_NOT_FOUND', 'This enclave was not found.')
    const row = await this.db.bond.findUnique({ where: { enclaveAddress: resolved.address } })
    if (!row) fail('BOND_NOT_FOUND', 'No operator bond is configured for this enclave.')
    return this.bondRow(row)
  }
  benchmarkRow(row: Prisma.BenchmarkGetPayload<{ include: { model: { select: { name: true } } } }>): BenchmarkRecord {
    return {
      address: row.address,
      model: row.modelAddress,
      modelName: row.model.name,
      publisher: row.publisher,
      name: row.name,
      modelVersion: row.modelVersion,
      datasetSha256: row.datasetSha256,
      datasetUri: row.datasetUri,
      sampleCount: row.sampleCount,
      passedCount: row.passedCount,
      scoreBps: row.scoreBps,
      receipts: (row.receipts as string[]) ?? [],
      publishedSlot: String(row.publishedSlot),
    }
  }
  async benchmark(address: string): Promise<BenchmarkRecord> {
    const row = await this.db.benchmark.findUnique({ where: { address }, include: { model: { select: { name: true } } } })
    if (!row) fail('BENCHMARK_NOT_FOUND', 'This benchmark was not found.')
    return this.benchmarkRow(row)
  }
  async benchmarks(query: BenchmarkQuery) {
    let modelAddress: string | undefined
    if (query.model) {
      const resolved = await this.db.model.findFirst({ where: { OR: [{ address: query.model }, { name: query.model }] }, select: { address: true } })
      modelAddress = resolved?.address ?? query.model
    }
    const rows = await this.db.benchmark.findMany({
      where: { ...(modelAddress ? { modelAddress } : {}), ...(query.name ? { name: query.name } : {}) },
      orderBy: [{ scoreBps: 'desc' }, { publishedSlot: 'desc' }, { address: 'asc' }],
      include: { model: { select: { name: true } } },
      skip: Number(query.cursor ?? 0),
      take: query.limit + 1,
    })
    return page(rows.map(row => this.benchmarkRow(row)), query)
  }
  async modelBenchmarks(id: string, query: Page) {
    const resolved = await this.db.model.findFirst({ where: { OR: [{ address: id }, { name: id }] }, select: { address: true } })
    if (!resolved) fail('MODEL_NOT_FOUND', 'This model was not found.')
    const rows = await this.db.benchmark.findMany({
      where: { modelAddress: resolved.address },
      orderBy: [{ publishedSlot: 'desc' }, { address: 'asc' }],
      include: { model: { select: { name: true } } },
      skip: Number(query.cursor ?? 0),
      take: query.limit + 1,
    })
    return page(rows.map(row => this.benchmarkRow(row)), query)
  }
  passPlanRow(row: Prisma.PassPlanGetPayload<{ include: { model: { select: { name: true } } } }>): PassPlan {
    return {
      address: row.address,
      model: row.modelAddress,
      modelName: row.model.name,
      authority: row.authority,
      mint: row.mint,
      pricePerCall: row.pricePerCall.toFixed(0),
      minCalls: row.minCalls,
      maxCalls: row.maxCalls,
      ttlSlots: String(row.ttlSlots),
      active: row.active,
      updatedSlot: String(row.updatedSlot),
    }
  }
  async modelPassPlan(id: string): Promise<PassPlan> {
    const resolved = await this.db.model.findFirst({ where: { OR: [{ address: id }, { name: id }] }, select: { address: true } })
    if (!resolved) fail('MODEL_NOT_FOUND', 'This model was not found.')
    const row = await this.db.passPlan.findUnique({ where: { modelAddress: resolved.address }, include: { model: { select: { name: true } } } })
    if (!row) fail('PASS_PLAN_NOT_FOUND', 'No prepaid pass plan is configured for this model.')
    return this.passPlanRow(row)
  }
  passRow(row: Prisma.PassGetPayload<{ include: { model: { select: { name: true } } } }>): Pass {
    return {
      address: row.address,
      model: row.modelAddress,
      modelName: row.model.name,
      holder: row.holder,
      nonce: row.nonce,
      mint: row.mint,
      pricePerCall: row.pricePerCall.toFixed(0),
      callsTotal: row.callsTotal,
      callsUsed: row.callsUsed,
      callsRemaining: Math.max(0, row.callsTotal - row.callsUsed),
      escrowRemaining: row.escrowRemaining.toFixed(0),
      returnedAmount: row.returnedAmount.toFixed(0),
      purchasedSlot: String(row.purchasedSlot),
      expiresAtSlot: String(row.expiresAtSlot),
      closedSlot: row.closedSlot !== null ? String(row.closedSlot) : null,
      status: row.status,
      updatedSlot: String(row.updatedSlot),
    }
  }
  async pass(address: string): Promise<Pass> {
    const row = await this.db.pass.findUnique({ where: { address }, include: { model: { select: { name: true } } } })
    if (!row) fail('PASS_NOT_FOUND', 'This prepaid pass was not found.')
    return this.passRow(row)
  }
  async accountPasses(wallet: string): Promise<AccountPasses> {
    const rows = await this.db.pass.findMany({
      where: { holder: wallet },
      orderBy: [{ purchasedSlot: 'desc' }, { address: 'asc' }],
      include: { model: { select: { name: true } } },
    })
    return { items: rows.map(row => this.passRow(row)), asOf: new Date().toISOString() }
  }
}
