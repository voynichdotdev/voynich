import { errors, type ErrorCode } from '@voynich/contract'
import { ApiFailure, failer, type Fail } from '../engines/server/errors.js'
import { InsufficientFundsError, TxError } from '../engines/tx/server/failure.js'
import { TxLedgerError } from '../engines/tx/server/ledger.js'

export const fail: Fail<ErrorCode> = failer(errors.status)
const programCodes: Record<string, ErrorCode> = {
  modelnotuploading: 'MODEL_NOT_UPLOADING', modelnotsealed: 'MODEL_NOT_LIVE', modelnotlive: 'MODEL_NOT_LIVE',
  invalidattestation: 'ENCLAVE_EXPIRED', measurementnotallowed: 'MEASUREMENT_NOT_ALLOWED', grantrequired: 'GRANT_REQUIRED',
  callnotopen: 'CALL_NOT_OPEN', calldeadlinepassed: 'CALL_DEADLINE_PASSED', callnotrefundable: 'CALL_NOT_REFUNDABLE',
  uploadincomplete: 'UPLOAD_INCOMPLETE', ciphertexthashmismatch: 'CIPHERTEXT_HASH_MISMATCH', invalidwrappedkey: 'INVALID_ENVELOPE',
  invalidopenanswer: 'PROGRAM_REFUSED', invalidcallback: 'PROGRAM_REFUSED', invalidcall: 'PROGRAM_REFUSED', invalidmeasurement: 'INVALID_MEASUREMENT', invalidpolicy: 'INVALID_POLICY', policycallerdenied: 'POLICY_CALLER_DENIED', policyoperatordenied: 'POLICY_OPERATOR_DENIED', policyrequired: 'POLICY_REQUIRED', invalidquote: 'INVALID_QUOTE', bountynotopen: 'BOUNTY_NOT_OPEN', labelmismatch: 'PROGRAM_REFUSED',
}
export function transactionFailure(error: TxError): ApiFailure {
  if (error instanceof InsufficientFundsError) return new ApiFailure(errors.status.INSUFFICIENT_FUNDS, { error: { code: 'INSUFFICIENT_FUNDS', message: error.message, retryable: false, stage: 'simulation', funding: error.funding } })
  const code = error instanceof TxLedgerError ? error.code : programCodes[(error.program?.name ?? '').replaceAll('_', '').toLowerCase()] ?? (error.stage === 'simulation' ? 'SIMULATION_FAILED' : 'PROGRAM_REFUSED')
  return new ApiFailure(errors.status[code], { error: { code, message: error.message, retryable: error.retryable,
    stage: error.stage === 'confirm' ? 'confirmation' : error.stage === 'wallet-changed' || error.stage === 'wallet-rejected' ? 'wallet' : error.stage,
    ...(error.program ? { programError: { programId: error.program.address, name: error.program.name ?? 'ProgramError', ...(error.program.code === null ? {} : { number: error.program.code }) } } : {}) } })
}
