// The one module every page, film, image and post takes names, numbers and labels from.
// Values and their sources only. A value this file doesn't hold is a configuration point
// (marked CONFIG) and is never typed into a page.

export const PRODUCT = {
  name: 'Voynich',
  line: 'Hide your model in plain sight.',
  pitch:
    'Open-weight distribution for closed models: the weights sit on Solana as ciphertext anyone can fetch, and only attested hardware can open and run them.',
  description: 'Sealed models on Solana. Weights on chain as ciphertext, opened only inside attested hardware, every answer with a receipt.',
  nameSource: 'The Voynich manuscript, Beinecke MS 408: a text anyone can look at in full and no one has read.',
  chain: 'Solana',
} as const

// CONFIG, set at launch: the public addresses of the site and of the API. Empty until they exist.
export const SITE = {
  url: process.env.NEXT_PUBLIC_SITE_URL ?? '',
  api: process.env.NEXT_PUBLIC_PUBLIC_API_URL ?? '',
} as const

// The product's nouns and verbs, said the same way on every surface.
export const NOUNS = {
  model: 'sealed model',
  ciphertext: 'ciphertext',
  enclave: 'enclave',
  measurement: 'measurement',
  record: 'attestation record',
  grant: 'grant',
  call: 'call',
  receipt: 'receipt',
  owner: 'owner',
  operator: 'operator',
  caller: 'caller',
} as const

export const VERBS = {
  seal: 'Seal',
  grant: 'Grant',
  call: 'Call',
  verify: 'Verify',
  refund: 'Refund',
  retire: 'Retire',
  register: 'Register',
  refresh: 'Refresh',
  setPrice: 'Set price',
  revoke: 'Revoke',
} as const

export const MODEL_STATUS = ['uploading', 'sealed', 'live', 'retired'] as const
export const CALL_STATUS = ['open', 'settled', 'refundable', 'refunded'] as const

// The stages a call passes through in the browser, in order, with the label each shows.
export const CALL_STAGES = [
  { id: 'disconnected', label: 'Connect a wallet' },
  { id: 'ready', label: 'Ready' },
  { id: 'encrypting', label: 'Encrypting the input' },
  { id: 'signing', label: 'Awaiting signature' },
  { id: 'escrowed', label: 'Price in escrow' },
  { id: 'answering', label: 'Enclave answering' },
  { id: 'streaming', label: 'Streaming pieces' },
  { id: 'verified', label: 'Verified' },
  { id: 'failed', label: 'Failed' },
  { id: 'refunded', label: 'Refunded' },
] as const

// The checks a browser runs on a receipt, in order.
export const RECEIPT_CHECKS = [
  { id: 'signature', label: 'Signature', says: 'The enclave key signed this call, input hash and output hash, or the delivered token count and running hash for a metered stream.' },
  { id: 'record', label: 'Attestation record', says: 'The configured attestation program recorded that key, hardware type and measurement.' },
  { id: 'expiry', label: 'Expiry', says: 'The record was unexpired at the slot the call settled.' },
  { id: 'answer', label: 'Open answer', says: 'The open answer bytes stored on chain hash to the signed output hash.' },
  { id: 'base', label: 'Base model', says: 'For a sealed adapter, the enclave signature commits to the on-chain base model SHA-256.' },
] as const

export const SEAL_STEPS = [
  { id: 'prepare', label: 'Prepare', says: 'Choose the weights file and its manifest.' },
  { id: 'encrypt', label: 'Encrypt', says: 'The model key is drawn and the weights are encrypted on this device.' },
  { id: 'create', label: 'Create', says: 'Sign once to create the model and fund the upload key.' },
  { id: 'write', label: 'Write', says: 'The ciphertext is written to chain in chunks.' },
  { id: 'seal', label: 'Seal', says: 'Sign to fix the hash. The bytes can no longer change.' },
  { id: 'grant', label: 'Grant', says: 'Wrap the model key to a first enclave.' },
] as const

export const PROGRAM = {
  name: 'voynich',
  accounts: ['Config', 'Model', 'Weights', 'Enclave', 'Grant', 'Call', 'Receipt'],
  instructions: [
    'initialize', 'set_config', 'create_model', 'write_weights', 'seal_model', 'set_price', 'retire_model',
    'register_enclave', 'refresh_enclave', 'grant_by_owner', 'grant_by_enclave', 'revoke_grant',
    'open_call', 'settle_call', 'refund_call',
  ],
  // Program ids are configured per cluster via environment variables.
  programId: process.env.NEXT_PUBLIC_VOYNICH_PROGRAM_ID ?? '',
  attestationProgramId: process.env.NEXT_PUBLIC_ATTEST_PROGRAM_ID ?? '',
  bountyProgramId: process.env.NEXT_PUBLIC_BOUNTY_PROGRAM_ID ?? '',
} as const

export const CRYPTO = {
  weights: 'XChaCha20-Poly1305',
  weightsKeyBits: 256,
  wrap: 'X25519 + HKDF-SHA256 + XChaCha20-Poly1305',
  signatures: 'Ed25519',
  hash: 'SHA-256',
} as const

export const HARDWARE = {
  launchMode: 'Standard server (dev)',
  launchVerifier: 'attest',
  attested: ['Intel TDX', 'AMD SEV-SNP'],
  inProgress: ['NVIDIA GPU attestation'],
  attestation: 'Solana Confidential Compute',
  attestationDate: '2026-11-13',
} as const

export const CHAIN_FACTS = {
  accountMaxBytes: 10 * 1024 * 1024,
  transactionBytes: 4096,
} as const

export const SKETCH32 = {
  id: 'sketch-32',
  name: 'sketch-32',
  says: 'Names what a person has drawn, out of 32 things.',
  inputKind: 'sketch',
  input: { width: 28, height: 28, channels: 1 },
  categories: 32,
  format: 'ONNX',
  dataset: 'Quick, Draw! (Google Creative Lab, CC BY 4.0)',
  datasetUrl: 'https://github.com/googlecreativelab/quickdraw-dataset',
  priceMint: 'SOL',
} as const

export const SDK = {
  package: 'voynich',
  oneLine: "await voynich.call('sketch-32', input)",
  returns: '{ output, receipt, verified }',
  functions: ['call', 'verify', 'seal', 'models', 'enclaves', 'grant', 'refund'],
} as const

export const CLI = {
  binary: 'voynich',
  commands: ['seal', 'models', 'grant', 'call', 'verify', 'enclave register', 'enclave run', 'enclave status', 'account'],
} as const

// The token is told once, in docs: Concepts, Fees and the token. Every figure about it comes from here.
export const TOKEN = {
  symbol: 'VOYNICH',
  supply: 1_000_000_000,
  launch: 'fair launch',
  allocation: "the developer's own first buy at launch",
  does: 'The protocol share of every settled call is paid to the launch wallet in the settling instruction; a crank buys VOYNICH on the market with it and burns what it bought. 25% of VOYNICH trading fees also route through the same buyback-and-burn crank.',
  home: '/docs/concepts/fees-and-the-token',
  mint: process.env.NEXT_PUBLIC_VOYNICH_MINT || 'baQxEuzMJ69RExbkCGLSrdSueWXCfp4tbi4nKZQpvoy',
  protocolShareBps: 500 as number | null,
  developerAllocation: '10% of supply (99,999,999.999999 VOYNICH locked on Streamflow until 2028-12-30 15:00 UTC)' as string | null,
  lockUrl: 'https://app.streamflow.finance/contract/solana/mainnet/6NdXwbDL82vtnFg8S66yukD7ECT57ecNHHM1VFFSowsk',
} as const

export const PLACES = [
  { href: '/models', label: 'Models' },
  { href: '/bounties', label: 'Bounties' },
  { href: '/seal', label: 'Seal' },
  { href: '/enclaves', label: 'Enclaves' },
  { href: '/sealing', label: 'Sealing' },
  { href: '/operators', label: 'Operators' },
  { href: '/docs', label: 'Docs' },
] as const

export const LINKS = {
  docsHome: '/docs/start/what-voynich-is',
  quickstart: '/docs/start/call-a-model',
  sealGuide: '/docs/start/seal-a-model',
  token: TOKEN.home,
  verifyGuide: '/docs/guides/verify-a-receipt',
  concepts: {
    models: '/docs/concepts/sealed-models',
    enclaves: '/docs/concepts/enclaves-and-attestation',
    grants: '/docs/concepts/grants',
    calls: '/docs/concepts/calls-and-receipts',
  },
  operators: {
    hardware: '/docs/operators/hardware',
    run: '/docs/operators/run-the-runtime',
    register: '/docs/operators/register-and-get-granted',
    earnings: '/docs/operators/earnings',
  },
  x: process.env.NEXT_PUBLIC_X_URL || 'https://x.com/voynichdotdev',
  github: process.env.NEXT_PUBLIC_GITHUB_URL ?? '',
} as const

export const SOURCES = {
  confidentialCompute: 'https://solana.ai/blog/nito-solana-confidential-compute',
  manuscript: 'https://beinecke.library.yale.edu/collections/highlights/voynich-manuscript',
} as const
