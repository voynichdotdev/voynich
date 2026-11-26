import { Prisma } from '@prisma/client'
import type { StagedTransaction } from '../engines/indexer/store.js'
import { bytes, hex, mint, text, type Facts } from './facts.js'

const number = (data: Record<string, unknown>, key: string) => Number(data[key])
const slot = (data: Record<string, unknown>, key: string) => BigInt(String(data[key]))
const hardware = (value: number) => (['dev', 'tdx', 'sev_snp'] as const)[value]!
const enumName = (value: unknown) => typeof value === 'string' ? value.toLowerCase() : Object.keys(value as object)[0]!.toLowerCase()
const json = (value: unknown) => value as Prisma.InputJsonValue

async function notify(tx: Prisma.TransactionClient, type: string, id: string) {
  await tx.$executeRaw`SELECT pg_notify('voynich_events', ${JSON.stringify({ type, id })})`
}

export function createApply(attestationProgramId: string) {
  return async (tx: Prisma.TransactionClient, row: StagedTransaction<Facts>) => {
    if (row.failed || !row.facts) return
    const currentSlot = BigInt(row.slot)
    for (const value of row.facts.mints) await tx.tokenMint.upsert({ where: { mint: value.mint }, create: value, update: { decimals: value.decimals } })
    for (const event of row.facts.events) {
      const data = event.data
      switch (event.name) {
        case 'configchanged': {
          const config = data.config as Record<string, unknown>
          const value = { feeRecipient: String(config.feeRecipient), protocolShareBps: Number(config.protocolShareBps), callDeadlineSlots: String(config.callDeadlineSlots), maxOpenAnswerBytes: Number(config.maxOpenAnswerBytes ?? 1024), attestationRecordLayoutVersion: Number(config.recordLayoutVersion), attestationProgramId: String(config.attestationProgram) }
          await tx.sharedProtocolState.upsert({ where: { id: 'protocol' }, create: { id: 'protocol', currentSlot, config: value }, update: { config: value } })
          break
        }
        case 'recordupdated': {
          const address = text(data, 'record')
          const value = { address, recordedSlot: slot(data, 'recordedSlot'), signingKey: text(data, 'signingKey'), encryptionKey: new Uint8Array(32), hardwareType: hardware(number(data, 'hardwareType')), measurement: hex(data, 'measurement'), expiresAtSlot: slot(data, 'expiresAtSlot'), programId: attestationProgramId, layoutVersion: 1 }
          await tx.attestationRecord.upsert({ where: { address_recordedSlot: { address, recordedSlot: value.recordedSlot } }, create: value, update: { expiresAtSlot: value.expiresAtSlot } })
          const enclaves = await tx.enclave.findMany({ where: { attestationRecordAddress: address, attestationRecord: { measurement: value.measurement, hardwareType: value.hardwareType } } })
          for (const enclave of enclaves) {
            await tx.enclave.update({ where: { address: enclave.address }, data: { attestationRecordedSlot: value.recordedSlot } })
            await notify(tx, 'enclave.updated', enclave.address)
          }
          break
        }
        case 'modelcreated': {
          const address = text(data, 'model')
          const size = slot(data, 'sizeBytes')
          const primaryUploadKey = text(data, 'uploadKey')
          const rawUploadKeys = Array.isArray(data.uploadKeys) ? (data.uploadKeys as string[]) : []
          const uploadKeys = rawUploadKeys.length ? rawUploadKeys : [primaryUploadKey]
          const hashVersion = typeof data.hashVersion === 'number' ? data.hashVersion : 0
          const rawBase = data.base as { sha256?: number[]; sizeBytes?: string | number; format?: string; source?: string } | null | undefined
          const baseFields = rawBase && Array.isArray(rawBase.sha256)
            ? {
                baseSha256: Buffer.from(Uint8Array.from(rawBase.sha256)).toString('hex'),
                baseSizeBytes: BigInt(String(rawBase.sizeBytes)),
                baseFormat: String(rawBase.format),
                baseSource: String(rawBase.source),
              }
            : { baseSha256: null, baseSizeBytes: null, baseFormat: null, baseSource: null }
          const priceUnit = (data.priceUnit ? enumName(data.priceUnit) : 'call') as 'call' | 'token'
          const value = { address, name: text(data, 'name'), owner: text(data, 'owner'), manifest: json(data.manifest), status: 'uploading' as const, createdSlot: slot(data, 'slot'), plaintextSize: size - ((size + 65551n) / 65552n) * 16n, ciphertextSize: size, cipherId: text(data, 'cipher'), noncePrefix: bytes(data, 'noncePrefix'), allowedMeasurements: (data.allowedMeasurements as number[][]).map(item => Buffer.from(item).toString('hex')), price: text(data, 'price'), priceMint: mint(text(data, 'priceMint')), priceUnit, operatorShareBps: number(data, 'operatorShareBps'), uploadKey: primaryUploadKey, uploadKeys, hashVersion, sealedChunks: 0, ...baseFields, updatedSlot: currentSlot }
          await tx.model.upsert({ where: { address }, create: { ...value, manifestBytes: bytes(data, 'manifestBytes'), indexingIssue: typeof data.indexingIssue === 'string' ? data.indexingIssue : null }, update: value })
          let offset = 0n
          for (const [index, key] of (data.weights as string[]).entries()) {
            const metadata = row.facts.weights.find(weight => weight.address === key)!
            const size = BigInt(metadata.size)
            const value = { address: key, modelAddress: address, index, offset, size, writtenRanges: [], bytesWritten: 0n, updatedSlot: currentSlot }
            await tx.weights.upsert({ where: { address: key }, create: value, update: value })
            offset += size
          }
          await notify(tx, 'model.updated', address)
          break
        }
        case 'weightsattached': {
          const address = text(data, 'model')
          const existing = await tx.weights.findMany({ where: { modelAddress: address }, orderBy: { index: 'asc' } })
          let index = existing.length
          let offset = existing.reduce((sum, item) => sum + item.size, 0n)
          for (const key of data.weights as string[]) {
            const metadata = row.facts.weights.find(weight => weight.address === key)!
            const size = BigInt(metadata.size)
            const value = { address: key, modelAddress: address, index, offset, size, writtenRanges: [], bytesWritten: 0n, updatedSlot: currentSlot }
            await tx.weights.upsert({ where: { address: key }, create: value, update: value })
            index++
            offset += size
          }
          await tx.model.update({ where: { address }, data: { updatedSlot: currentSlot } })
          await notify(tx, 'model.updated', address)
          break
        }
        case 'rangesealed': {
          const address = text(data, 'model')
          await tx.model.update({ where: { address }, data: { sealedChunks: number(data, 'sealedChunks'), updatedSlot: currentSlot } })
          await notify(tx, 'model.updated', address)
          break
        }
        case 'weightswritten': {
          const address = text(data, 'weights')
          const weight = await tx.weights.findUnique({ where: { address } })
          if (!weight) break
          const pieces = [...weight.writtenRanges as { offset: number; length: number }[], { offset: number(data, 'offset'), length: number(data, 'length') }].sort((a, b) => a.offset - b.offset)
          const ranges: { offset: number; length: number }[] = []
          for (const piece of pieces) {
            const previous = ranges.at(-1)
            if (previous && piece.offset <= previous.offset + previous.length) previous.length = Math.max(previous.offset + previous.length, piece.offset + piece.length) - previous.offset
            else ranges.push({ ...piece })
          }
          await tx.weights.update({ where: { address }, data: { bytesWritten: BigInt(ranges.reduce((total, range) => total + range.length, 0)), writtenRanges: json(ranges), updatedSlot: currentSlot } })
          await notify(tx, 'model.updated', text(data, 'model'))
          break
        }
        case 'modelsealed': {
          const address = text(data, 'model')
          const existing = await tx.model.findUnique({ where: { address }, select: { hashVersion: true, ciphertextSize: true } })
          const totalChunks = existing && existing.hashVersion === 1 ? Number((existing.ciphertextSize + 65551n) / 65552n) : 0
          await tx.model.update({ where: { address }, data: { status: 'sealed', sealedSlot: slot(data, 'slot'), ciphertextSha256: hex(data, 'ciphertextSha256'), ...(existing?.hashVersion === 1 ? { sealedChunks: totalChunks } : {}), uploadKey: null, uploadKeys: [], updatedSlot: currentSlot } })
          await notify(tx, 'model.updated', address)
          break
        }
        case 'modelpricechanged': {
          const priceUnit = data.priceUnit ? (enumName(data.priceUnit) as 'call' | 'token') : undefined
          await tx.model.update({ where: { address: text(data, 'model') }, data: { price: text(data, 'price'), priceMint: mint(text(data, 'priceMint')), ...(priceUnit ? { priceUnit } : {}), operatorShareBps: number(data, 'operatorShareBps'), ...(typeof data.indexingIssue === 'string' ? { indexingIssue: data.indexingIssue } : {}), updatedSlot: currentSlot } })
          await notify(tx, 'model.updated', text(data, 'model'))
          break
        }
        case 'modelstatuschanged':
          await tx.model.update({ where: { address: text(data, 'model') }, data: { status: enumName(data.status) as 'uploading' | 'sealed' | 'live' | 'retired', updatedSlot: currentSlot } })
          await notify(tx, 'model.updated', text(data, 'model'))
          break
        case 'modelallowedmeasurementschanged':
          await tx.model.update({ where: { address: text(data, 'model') }, data: { allowedMeasurements: (data.allowedMeasurements as number[][]).map(item => Buffer.from(item).toString('hex')), updatedSlot: currentSlot } })
          await notify(tx, 'model.updated', text(data, 'model'))
          break
        case 'enclavechanged': {
          const record = text(data, 'record')
          const recordedSlot = slot(data, 'recordedSlot')
          const recordValue = { address: record, recordedSlot, signingKey: text(data, 'signingKey'), encryptionKey: bytes(data, 'encryptionKey'), hardwareType: hardware(number(data, 'hardwareType')), measurement: hex(data, 'measurement'), expiresAtSlot: slot(data, 'expiresAtSlot'), programId: attestationProgramId, layoutVersion: 1 }
          await tx.attestationRecord.upsert({ where: { address_recordedSlot: { address: record, recordedSlot } }, create: recordValue, update: recordValue })
          const address = text(data, 'enclave')
          const value = { address, signingKey: text(data, 'signingKey'), encryptionKey: bytes(data, 'encryptionKey'), operator: text(data, 'operator'), endpoint: text(data, 'endpoint'), attestationRecordAddress: record, attestationRecordedSlot: recordedSlot, updatedSlot: currentSlot }
          await tx.enclave.updateMany({ where: { address, OR: [{ endpoint: { not: value.endpoint } }, { attestationRecord: { measurement: { not: recordValue.measurement } } }] }, data: { reachable: false } })
          await tx.enclave.upsert({ where: { address }, create: { ...value, registeredSlot: currentSlot }, update: value })
          await notify(tx, 'enclave.updated', address)
          break
        }
        case 'grantchanged': {
          const address = text(data, 'grant')
          const value = { address, modelAddress: text(data, 'model'), enclaveAddress: text(data, 'enclave'), wrappedKey: bytes(data, 'wrappedKey'), grantedBy: text(data, 'grantedBy'), grantedSlot: slot(data, 'slot'), revokedSlot: data.revoked ? currentSlot : null }
          await tx.grant.upsert({ where: { address }, create: value, update: data.revoked ? { revokedSlot: currentSlot } : value })
          await notify(tx, 'model.updated', value.modelAddress)
          await notify(tx, 'enclave.updated', value.enclaveAddress)
          break
        }
        case 'grantquoteupdated': {
          const modelAddress = text(data, 'model')
          const enclaveAddress = text(data, 'enclave')
          const rawQuote = data.quotedOperatorShareBps
          const quotedOperatorShareBps = rawQuote === null || rawQuote === undefined ? null : number(data, 'quotedOperatorShareBps')
          await tx.grant.updateMany({ where: { modelAddress, enclaveAddress }, data: { quotedOperatorShareBps } })
          await notify(tx, 'model.updated', modelAddress)
          await notify(tx, 'enclave.updated', enclaveAddress)
          break
        }
        case 'callopened': {
          const address = text(data, 'call')
          const answerMode = (data.answerMode ? enumName(data.answerMode) : 'sealed') as 'sealed' | 'open'
          const callerIsProgram = Boolean(data.callerIsProgram ?? false)
          const priceUnit = (data.priceUnit ? enumName(data.priceUnit) : 'call') as 'call' | 'token'
          const unitPrice = text(data, 'price')
          const escrowAmount = priceUnit === 'token' && data.ceiling !== undefined ? text(data, 'ceiling') : unitPrice
          const value = { address, caller: text(data, 'caller'), callerIsProgram, modelAddress: text(data, 'model'), enclaveAddress: text(data, 'enclave'), inputHash: hex(data, 'inputHash'), escrowAmount, priceUnit, unitPrice, priceMint: mint(text(data, 'priceMint')), openedSlot: slot(data, 'openedSlot'), deadlineSlot: slot(data, 'deadlineSlot'), status: 'open' as const, answerMode, openSignature: row.signature, updatedSlot: currentSlot }
          await tx.call.upsert({ where: { address }, create: value, update: value })
          await notify(tx, 'call.updated', address)
          break
        }
        case 'callsettled': {
          const address = text(data, 'receipt')
          const enclave = await tx.enclave.findUniqueOrThrow({ where: { address: text(data, 'enclave') } })
          const record = await tx.attestationRecord.findFirstOrThrow({ where: { address: enclave.attestationRecordAddress, recordedSlot: { lte: currentSlot } }, orderBy: { recordedSlot: 'desc' } })
          const answerMode = (data.answerMode ? enumName(data.answerMode) : 'sealed') as 'sealed' | 'open'
          const openBytes = data.openAnswer ? bytes(data, 'openAnswer') : new Uint8Array(0)
          const callerIsProgram = Boolean(data.callerIsProgram ?? false)
          const deliveredCount = data.deliveredCount !== null && data.deliveredCount !== undefined ? BigInt(String(data.deliveredCount)) : null
          const returnedAmount = data.returnedAmount !== null && data.returnedAmount !== undefined ? String(data.returnedAmount) : null
          const receipt = { address, callAddress: text(data, 'call'), modelAddress: text(data, 'model'), enclaveAddress: enclave.address, inputHash: hex(data, 'inputHash'), outputHash: hex(data, 'outputHash'), enclaveSignature: bytes(data, 'signature'), answerMode, openAnswer: openBytes.length > 0 ? openBytes : null, callerIsProgram, deliveredCount, returnedAmount, slot: slot(data, 'slot'), transactionSignature: row.signature, attestationRecordAddress: record.address, attestationRecordedSlot: record.recordedSlot }
          await tx.receipt.create({ data: receipt })
          for (const role of ['owner', 'operator', 'protocol'] as const) await tx.payment.create({ data: { receiptAddress: address, role, recipient: text(data, role === 'protocol' ? 'feeRecipient' : role), mint: mint(text(data, 'priceMint')), amount: text(data, `${role}Amount`) } })
          await tx.call.update({ where: { address: receipt.callAddress }, data: { status: 'settled', updatedSlot: currentSlot } })
          await tx.model.update({ where: { address: receipt.modelAddress }, data: { callsSettled: { increment: 1 }, updatedSlot: currentSlot } })
          await tx.enclave.update({ where: { address: enclave.address }, data: { callsSettled: { increment: 1 } } })
          const recentReceipts = await tx.receipt.findMany({
            where: { modelAddress: receipt.modelAddress, enclaveAddress: enclave.address },
            orderBy: { slot: 'desc' },
            take: 25,
            select: { slot: true, call: { select: { openedSlot: true } } },
          })
          const answerDeltas = recentReceipts
            .map(item => Math.max(0, Number(item.slot - item.call.openedSlot) * 200))
            .sort((a, b) => a - b)
          if (answerDeltas.length > 0) {
            const mid = Math.floor(answerDeltas.length / 2)
            const medianAnswerMs = answerDeltas.length % 2 === 1
              ? answerDeltas[mid]!
              : Math.round((answerDeltas[mid - 1]! + answerDeltas[mid]!) / 2)
            await tx.grant.updateMany({
              where: { modelAddress: receipt.modelAddress, enclaveAddress: enclave.address },
              data: { medianAnswerMs },
            })
          }
          await notify(tx, 'call.updated', receipt.callAddress)
          await notify(tx, 'receipt.created', address)
          await notify(tx, 'model.updated', receipt.modelAddress)
          await notify(tx, 'enclave.updated', enclave.address)
          break
        }
        case 'callrefunded':
          await tx.call.update({ where: { address: text(data, 'call') }, data: { status: 'refunded', refundSignature: row.signature, refundedSlot: slot(data, 'slot'), updatedSlot: currentSlot } })
          await notify(tx, 'call.updated', text(data, 'call'))
          break
        case 'bountyposted': {
          const address = text(data, 'bounty')
          const value = {
            address,
            creator: text(data, 'creator'),
            nonce: text(data, 'nonce'),
            modelAddress: text(data, 'model'),
            targetLabel: text(data, 'targetLabel'),
            mint: mint(text(data, 'mint')),
            amount: text(data, 'amount'),
            status: 'open' as const,
            createdSlot: slot(data, 'slot'),
            updatedSlot: currentSlot,
          }
          await tx.bounty.upsert({ where: { address }, create: value, update: value })
          await notify(tx, 'bounty.updated', address)
          break
        }
        case 'bountydrawn': {
          const bountyAddress = text(data, 'bounty')
          const address = text(data, 'attempt')
          const value = {
            address,
            bountyAddress,
            drawer: text(data, 'drawer'),
            callAddress: text(data, 'call'),
            createdSlot: slot(data, 'slot'),
          }
          await tx.bountyAttempt.upsert({ where: { address }, create: value, update: value })
          await tx.bounty.update({ where: { address: bountyAddress }, data: { attemptsCount: { increment: 1 }, updatedSlot: currentSlot } })
          await notify(tx, 'bounty.updated', bountyAddress)
          break
        }
        case 'bountycollected': {
          const address = text(data, 'bounty')
          await tx.bounty.update({
            where: { address },
            data: {
              status: 'claimed',
              winner: text(data, 'winner'),
              winningCall: text(data, 'call'),
              winningReceipt: text(data, 'receipt'),
              claimedSlot: slot(data, 'slot'),
              updatedSlot: currentSlot,
            },
          })
          await notify(tx, 'bounty.updated', address)
          break
        }
        case 'bountycancelled': {
          const address = text(data, 'bounty')
          await tx.bounty.update({
            where: { address },
            data: { status: 'cancelled', updatedSlot: currentSlot },
          })
          await notify(tx, 'bounty.updated', address)
          break
        }
        case 'attemptrefunded': {
          const address = text(data, 'attempt')
          await tx.bountyAttempt.update({ where: { address }, data: { refunded: true } })
          await notify(tx, 'bounty.updated', text(data, 'bounty'))
          break
        }
        case 'measurementpublished': {
          const address = text(data, 'measurement')
          const digest = hex(data, 'digest')
          const value = {
            address,
            digest,
            publisher: text(data, 'publisher'),
            sourceRepo: text(data, 'sourceRepo'),
            commitSha: text(data, 'commitSha'),
            recipeHash: hex(data, 'recipeHash'),
            version: text(data, 'version'),
            createdSlot: slot(data, 'createdSlot'),
            status: (data.status ? enumName(data.status) : 'active') as 'active' | 'deprecated',
            updatedSlot: currentSlot,
          }
          await tx.measurement.upsert({ where: { address }, create: value, update: value })
          await notify(tx, 'measurement.updated', digest)
          break
        }
        case 'measurementdeprecated': {
          const address = text(data, 'measurement')
          const digest = hex(data, 'digest')
          await tx.measurement.update({
            where: { address },
            data: { status: 'deprecated', updatedSlot: currentSlot },
          })
          await notify(tx, 'measurement.updated', digest)
          break
        }
        case 'policyupdated': {
          const address = text(data, 'policy')
          const modelAddress = text(data, 'model')
          const value = {
            address,
            modelAddress,
            allowListEnabled: Boolean(data.allowListEnabled),
            allowedCallers: Array.isArray(data.allowedCallers) ? (data.allowedCallers as string[]) : [],
            maxCallsPerCallerPerWindow: number(data, 'maxCallsPerCallerPerWindow'),
            windowSlots: slot(data, 'windowSlots'),
            allowedOperators: Array.isArray(data.allowedOperators) ? (data.allowedOperators as string[]) : [],
            allowedRegions: Array.isArray(data.allowedRegions) ? (data.allowedRegions as string[]) : [],
            updatedSlot: slot(data, 'updatedSlot'),
          }
          await tx.modelPolicy.upsert({ where: { address }, create: value, update: value })
          await tx.model.update({ where: { address: modelAddress }, data: { hasPolicy: true, updatedSlot: currentSlot } })
          await notify(tx, 'policy.updated', modelAddress)
          await notify(tx, 'model.updated', modelAddress)
          break
        }
        case 'policycleared': {
          const address = text(data, 'policy')
          const modelAddress = text(data, 'model')
          await tx.modelPolicy.deleteMany({ where: { modelAddress } })
          await tx.model.update({ where: { address: modelAddress }, data: { hasPolicy: false, updatedSlot: currentSlot } })
          await notify(tx, 'policy.cleared', `${modelAddress}:${address}`)
          await notify(tx, 'model.updated', modelAddress)
          break
        }
        case 'modelversionstarted': {
          const modelAddress = text(data, 'model')
          const version = number(data, 'version')
          const base = data.base as { sha256?: number[]; sizeBytes?: string; format?: string; source?: string } | null | undefined
          const value = {
            modelAddress,
            version,
            address: text(data, 'modelVersion'),
            status: 'uploading' as const,
            sizeBytes: BigInt(text(data, 'sizeBytes')),
            noncePrefix: bytes(data, 'noncePrefix'),
            manifest: (data.manifest ?? null) as Prisma.InputJsonValue,
            baseSha256: base?.sha256 ? Buffer.from(base.sha256).toString('hex') : null,
            baseSizeBytes: base?.sizeBytes !== undefined ? BigInt(base.sizeBytes) : null,
            baseFormat: base?.format ?? null,
            baseSource: base?.source ?? null,
            updatedSlot: currentSlot,
          }
          await tx.modelVersion.upsert({
            where: { modelAddress_version: { modelAddress, version } },
            create: value,
            update: value,
          })
          break
        }
        case 'modelversionpublished': {
          const modelAddress = text(data, 'model')
          const version = number(data, 'version')
          const previousVersion = number(data, 'previousVersion')
          const publishedSlot = slot(data, 'publishedSlot')
          const prevBase = data.previousBase as { sha256?: number[]; sizeBytes?: string; format?: string; source?: string } | null | undefined
          const nextBase = data.base as { sha256?: number[]; sizeBytes?: string; format?: string; source?: string } | null | undefined
          const existingModel = await tx.model.findUnique({ where: { address: modelAddress } })
          await tx.modelVersion.updateMany({ where: { modelAddress, status: 'live' }, data: { status: 'archived', updatedSlot: currentSlot } })
          const prevRow = {
            modelAddress,
            version: previousVersion,
            address: null,
            status: 'archived' as const,
            sizeBytes: BigInt(text(data, 'previousSizeBytes')),
            ciphertextSha256: hex(data, 'previousCiphertextSha256'),
            noncePrefix: existingModel?.noncePrefix ?? null,
            manifest: (existingModel?.manifest ?? null) as Prisma.InputJsonValue,
            baseSha256: prevBase?.sha256 ? Buffer.from(prevBase.sha256).toString('hex') : null,
            baseSizeBytes: prevBase?.sizeBytes !== undefined ? BigInt(prevBase.sizeBytes) : null,
            baseFormat: prevBase?.format ?? null,
            baseSource: prevBase?.source ?? null,
            publishedSlot: slot(data, 'previousSealedSlot'),
            updatedSlot: currentSlot,
          }
          await tx.modelVersion.upsert({
            where: { modelAddress_version: { modelAddress, version: previousVersion } },
            create: prevRow,
            update: { status: 'archived', updatedSlot: currentSlot },
          })
          const sizeBytes = BigInt(text(data, 'sizeBytes'))
          const ciphertextSha256 = hex(data, 'ciphertextSha256')
          const noncePrefix = bytes(data, 'noncePrefix')
          const liveRow = {
            modelAddress,
            version,
            address: text(data, 'modelVersion'),
            status: 'live' as const,
            sizeBytes,
            ciphertextSha256,
            noncePrefix,
            manifest: (data.manifest ?? null) as Prisma.InputJsonValue,
            baseSha256: nextBase?.sha256 ? Buffer.from(nextBase.sha256).toString('hex') : null,
            baseSizeBytes: nextBase?.sizeBytes !== undefined ? BigInt(nextBase.sizeBytes) : null,
            baseFormat: nextBase?.format ?? null,
            baseSource: nextBase?.source ?? null,
            publishedSlot,
            updatedSlot: currentSlot,
          }
          await tx.modelVersion.upsert({
            where: { modelAddress_version: { modelAddress, version } },
            create: liveRow,
            update: liveRow,
          })
          const chunks = Math.ceil(Number(sizeBytes) / 65552)
          const plaintextSize = BigInt(Math.max(0, Number(sizeBytes) - chunks * 16))
          await tx.model.update({
            where: { address: modelAddress },
            data: {
              currentVersion: version,
              ciphertextSize: sizeBytes,
              plaintextSize,
              ciphertextSha256,
              noncePrefix,
              manifest: (data.manifest ?? existingModel?.manifest ?? {}) as Prisma.InputJsonValue,
              manifestBytes: data.manifestBytes ? bytes(data, 'manifestBytes') : (existingModel?.manifestBytes ?? new Uint8Array(0)),
              baseSha256: liveRow.baseSha256,
              baseSizeBytes: liveRow.baseSizeBytes,
              baseFormat: liveRow.baseFormat,
              baseSource: liveRow.baseSource,
              hashVersion: 1,
              sealedChunks: chunks,
              sealedSlot: publishedSlot,
              updatedSlot: currentSlot,
            },
          })
          const weightKeys = (data.weights as string[]) ?? []
          if (weightKeys.length > 0) {
            await tx.weights.deleteMany({ where: { modelAddress, address: { notIn: weightKeys } } })
            let offset = 0n
            for (let index = 0; index < weightKeys.length; index++) {
              const weightAddress = weightKeys[index]!
              const meta = row.facts.weights.find(item => item.address === weightAddress)
              const size = meta ? BigInt(meta.size) : sizeBytes
              const written = meta ? BigInt(meta.written) : size
              await tx.weights.upsert({
                where: { address: weightAddress },
                create: { address: weightAddress, modelAddress, index, offset, size, writtenRanges: written > 0n ? [{ offset: 0, length: Number(written) }] : [], bytesWritten: written, updatedSlot: currentSlot },
                update: { index, offset, size, writtenRanges: written > 0n ? [{ offset: 0, length: Number(written) }] : [], bytesWritten: written, updatedSlot: currentSlot },
              })
              offset += size
            }
          }
          await notify(tx, 'model.updated', modelAddress)
          await notify(tx, 'version.published', `${modelAddress}:${version}`)
          break
        }
        case 'sessionopened': {
          const address = text(data, 'session')
          const rawMint = text(data, 'mint')
          const rawModel = text(data, 'model')
          const ZERO_KEY = '11111111111111111111111111111111'
          const value = {
            address,
            caller: text(data, 'caller'),
            delegate: text(data, 'delegate'),
            nonce: text(data, 'nonce'),
            mint: rawMint === ZERO_KEY ? null : rawMint,
            modelAddress: rawModel === ZERO_KEY ? null : rawModel,
            budget: new Prisma.Decimal(text(data, 'budget')),
            spent: new Prisma.Decimal('0'),
            callsOpened: 0n,
            openedSlot: BigInt(text(data, 'openedSlot')),
            expiresAtSlot: BigInt(text(data, 'expiresAtSlot')),
            closedSlot: null,
            returnedAmount: null,
            status: 'open' as const,
            updatedSlot: currentSlot,
          }
          await tx.session.upsert({ where: { address }, create: value, update: value })
          await notify(tx, 'session.updated', address)
          break
        }
        case 'sessiondebited': {
          const address = text(data, 'session')
          const existing = await tx.session.findUnique({ where: { address } })
          if (existing) {
            await tx.session.update({
              where: { address },
              data: {
                spent: new Prisma.Decimal(text(data, 'spent')),
                callsOpened: BigInt(text(data, 'callsOpened')),
                updatedSlot: currentSlot,
              },
            })
            await notify(tx, 'session.updated', address)
          }
          break
        }
        case 'sessionclosed': {
          const address = text(data, 'session')
          const existing = await tx.session.findUnique({ where: { address } })
          if (existing) {
            await tx.session.update({
              where: { address },
              data: {
                spent: new Prisma.Decimal(text(data, 'spent')),
                callsOpened: BigInt(text(data, 'callsOpened')),
                closedSlot: BigInt(text(data, 'slot')),
                returnedAmount: new Prisma.Decimal(text(data, 'returnedAmount')),
                status: 'closed',
                updatedSlot: currentSlot,
              },
            })
            await notify(tx, 'session.updated', address)
          }
          break
        }
        case 'splitupdated': {
          const address = text(data, 'split')
          const modelAddress = text(data, 'model')
          const rawMint = text(data, 'mint')
          const ZERO_KEY = '11111111111111111111111111111111'
          const active = Boolean(data.active)
          const rawRecipients = (data.recipients as { wallet: string; shareBps: number; accrued: string; claimed: string }[]) ?? []
          const recipients = rawRecipients.map(r => ({
            wallet: String(r.wallet),
            shareBps: Number(r.shareBps),
            accrued: String(r.accrued),
            claimed: String(r.claimed),
          }))
          const existing = await tx.split.findUnique({ where: { address } })
          const value = {
            address,
            modelAddress,
            authority: text(data, 'authority'),
            mint: rawMint === ZERO_KEY ? null : rawMint,
            active,
            totalReceived: existing?.totalReceived ?? new Prisma.Decimal('0'),
            recipients: recipients as unknown as Prisma.InputJsonValue,
            updatedSlot: currentSlot,
          }
          await tx.split.upsert({
            where: { address },
            create: value,
            update: {
              authority: value.authority,
              mint: value.mint,
              active: value.active,
              recipients: value.recipients,
              updatedSlot: currentSlot,
            },
          })
          await tx.model.update({
            where: { address: modelAddress },
            data: { hasSplit: active, updatedSlot: currentSlot },
          })
          await notify(tx, 'model.updated', modelAddress)
          await notify(tx, 'split.updated', modelAddress)
          break
        }
        case 'splitcredited': {
          const address = text(data, 'split')
          const modelAddress = text(data, 'model')
          const rawMint = text(data, 'mint')
          const ZERO_KEY = '11111111111111111111111111111111'
          const rawRecipients = (data.recipients as { wallet: string; shareBps: number; accrued: string; claimed: string }[]) ?? []
          const recipients = rawRecipients.map(r => ({
            wallet: String(r.wallet),
            shareBps: Number(r.shareBps),
            accrued: String(r.accrued),
            claimed: String(r.claimed),
          }))
          const existing = await tx.split.findUnique({ where: { address } })
          if (existing) {
            await tx.split.update({
              where: { address },
              data: {
                mint: rawMint === ZERO_KEY ? null : rawMint,
                totalReceived: new Prisma.Decimal(text(data, 'totalReceived')),
                recipients: recipients as unknown as Prisma.InputJsonValue,
                updatedSlot: currentSlot,
              },
            })
            await notify(tx, 'split.updated', modelAddress)
          }
          break
        }
        case 'splitclaimed': {
          const address = text(data, 'split')
          const modelAddress = text(data, 'model')
          const recipient = text(data, 'recipient')
          const totalClaimed = text(data, 'totalClaimed')
          const existing = await tx.split.findUnique({ where: { address } })
          if (existing) {
            const current = (existing.recipients as { wallet: string; shareBps: number; accrued: string; claimed: string }[]) ?? []
            const updated = current.map(r => r.wallet === recipient ? { ...r, claimed: totalClaimed } : r)
            await tx.split.update({
              where: { address },
              data: {
                recipients: updated as unknown as Prisma.InputJsonValue,
                updatedSlot: currentSlot,
              },
            })
            await notify(tx, 'split.updated', modelAddress)
          }
          break
        }
        case 'bonddeposited': {
          const address = text(data, 'bond')
          const enclaveAddress = text(data, 'enclave')
          const operator = text(data, 'operator')
          const bondedLamports = new Prisma.Decimal(text(data, 'bondedLamports'))
          const slashBps = number(data, 'slashBps')
          await tx.bond.upsert({
            where: { address },
            create: {
              address,
              enclaveAddress,
              operator,
              bondedLamports,
              slashedTotal: new Prisma.Decimal('0'),
              missedCalls: 0n,
              slashBps,
              updatedSlot: currentSlot,
            },
            update: {
              operator,
              bondedLamports,
              slashBps,
              updatedSlot: currentSlot,
            },
          })
          await notify(tx, 'bond.updated', enclaveAddress)
          await notify(tx, 'enclave.updated', enclaveAddress)
          break
        }
        case 'bondwithdrawn': {
          const address = text(data, 'bond')
          const enclaveAddress = text(data, 'enclave')
          const existing = await tx.bond.findUnique({ where: { address } })
          if (existing) {
            await tx.bond.update({
              where: { address },
              data: {
                bondedLamports: new Prisma.Decimal(text(data, 'bondedLamports')),
                updatedSlot: currentSlot,
              },
            })
            await notify(tx, 'bond.updated', enclaveAddress)
            await notify(tx, 'enclave.updated', enclaveAddress)
          }
          break
        }
        case 'bondslashed': {
          const address = text(data, 'bond')
          const enclaveAddress = text(data, 'enclave')
          const existing = await tx.bond.findUnique({ where: { address } })
          if (existing) {
            await tx.bond.update({
              where: { address },
              data: {
                bondedLamports: new Prisma.Decimal(text(data, 'bondedLamports')),
                slashedTotal: new Prisma.Decimal(text(data, 'slashedTotal')),
                missedCalls: BigInt(text(data, 'missedCalls')),
                updatedSlot: currentSlot,
              },
            })
            await notify(tx, 'bond.updated', enclaveAddress)
            await notify(tx, 'enclave.updated', enclaveAddress)
          }
          break
        }
        case 'benchmarkpublished': {
          const address = text(data, 'benchmark')
          const modelAddress = text(data, 'model')
          const value = {
            address,
            modelAddress,
            publisher: text(data, 'publisher'),
            name: text(data, 'name'),
            modelVersion: number(data, 'modelVersion'),
            datasetSha256: hex(data, 'datasetSha256'),
            datasetUri: text(data, 'datasetUri'),
            sampleCount: number(data, 'sampleCount'),
            passedCount: number(data, 'passedCount'),
            scoreBps: number(data, 'scoreBps'),
            receipts: ((data.receipts as string[]) ?? []).map(String) as unknown as Prisma.InputJsonValue,
            publishedSlot: slot(data, 'publishedSlot'),
          }
          await tx.benchmark.upsert({
            where: { address },
            create: value,
            update: value,
          })
          await notify(tx, 'benchmark.published', address)
          break
        }
        case 'passplanupdated': {
          const address = text(data, 'passPlan')
          const modelAddress = text(data, 'model')
          const rawMint = text(data, 'mint')
          const ZERO_KEY = '11111111111111111111111111111111'
          const value = {
            address,
            modelAddress,
            authority: text(data, 'authority'),
            mint: rawMint === ZERO_KEY ? null : rawMint,
            pricePerCall: new Prisma.Decimal(text(data, 'pricePerCall')),
            minCalls: number(data, 'minCalls'),
            maxCalls: number(data, 'maxCalls'),
            ttlSlots: BigInt(text(data, 'ttlSlots')),
            active: Boolean(data.active),
            updatedSlot: slot(data, 'updatedSlot'),
          }
          await tx.passPlan.upsert({ where: { address }, create: value, update: value })
          await notify(tx, 'pass_plan.updated', modelAddress)
          break
        }
        case 'passpurchased': {
          const address = text(data, 'pass')
          const modelAddress = text(data, 'model')
          const rawMint = text(data, 'mint')
          const ZERO_KEY = '11111111111111111111111111111111'
          const value = {
            address,
            modelAddress,
            holder: text(data, 'holder'),
            nonce: text(data, 'nonce'),
            mint: rawMint === ZERO_KEY ? null : rawMint,
            pricePerCall: new Prisma.Decimal(text(data, 'pricePerCall')),
            callsTotal: number(data, 'callsTotal'),
            callsUsed: 0,
            escrowRemaining: new Prisma.Decimal(text(data, 'escrowRemaining')),
            returnedAmount: new Prisma.Decimal('0'),
            purchasedSlot: slot(data, 'purchasedSlot'),
            expiresAtSlot: slot(data, 'expiresAtSlot'),
            closedSlot: null,
            status: 'open' as const,
            updatedSlot: currentSlot,
          }
          await tx.pass.upsert({ where: { address }, create: value, update: value })
          await notify(tx, 'pass.updated', address)
          break
        }
        case 'passused': {
          const address = text(data, 'pass')
          const existing = await tx.pass.findUnique({ where: { address } })
          if (existing) {
            await tx.pass.update({
              where: { address },
              data: {
                callsUsed: number(data, 'callsUsed'),
                escrowRemaining: new Prisma.Decimal(text(data, 'escrowRemaining')),
                updatedSlot: currentSlot,
              },
            })
            await notify(tx, 'pass.updated', address)
          }
          break
        }
        case 'passclosed': {
          const address = text(data, 'pass')
          const existing = await tx.pass.findUnique({ where: { address } })
          if (existing) {
            await tx.pass.update({
              where: { address },
              data: {
                callsUsed: number(data, 'callsUsed'),
                escrowRemaining: new Prisma.Decimal('0'),
                returnedAmount: new Prisma.Decimal(text(data, 'returnedAmount')),
                closedSlot: slot(data, 'slot'),
                status: 'closed',
                updatedSlot: currentSlot,
              },
            })
            await notify(tx, 'pass.updated', address)
          }
          break
        }
      }
    }
  }
}
