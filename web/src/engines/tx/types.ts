// The wire shapes the API and the web share for a transaction's life: built, signed, sent,
// followed. Put them in the project's contract package; both sides import from there.

/** Where a transaction failed. The UI names the stage instead of one blanket message. */
export type TxStage = 'build' | 'wallet-rejected' | 'wallet-changed' | 'simulation' | 'send' | 'confirm'

export type TxFailure = {
  stage: TxStage
  message: string
  /** what the person can do next, in the product's words */
  nextStep?: string
  retryable: boolean
  program?: { address: string; code: number | null; name: string | null }
}

/** A transaction the server built and holds for the wallet to sign. */
export type TxBuild = {
  id: string
  transactionBase64: string
  blockhash: string
  lastValidBlockHeight: number
  /** the server adds its signature after the wallet's (a vanity mint): never sent by the wallet */
  cosigned: boolean
}

export type TxStatusName = 'submitted' | 'unconfirmed' | 'confirmed' | 'finalized' | 'failed' | 'expired'

export type TxStatus = {
  id: string
  status: TxStatusName
  signature?: string
  error?: TxFailure
}

/** What the browser sends back: the signed bytes for the server to relay, or the signature of a wallet-sent transaction. */
export type TxSubmission =
  | { mode: 'relay'; buildId: string; signedTransactionBase64: string; idempotencyKey: string }
  | { mode: 'wallet-sent'; buildId: string; signature: string; idempotencyKey: string }

export const settled = (s: TxStatusName) => s === 'confirmed' || s === 'finalized' || s === 'failed' || s === 'expired'
