// Writes the lists the docs render with <Rows>, from the program's IDL and the API contract.
// Run from anywhere: node web/content/docs/data/generate.mjs
// A field, account, error or route the code has and this file does not describe stops the run.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = resolve(here, '../../../../backend')
const idl = JSON.parse(readFileSync(resolve(backend, 'programs/artifacts/voynich.json'), 'utf8'))
const openapi = JSON.parse(readFileSync(resolve(backend, 'contract/openapi.json'), 'utf8'))
const contract = await import(pathToFileURL(resolve(backend, 'contract/dist/index.js')).href)

const out = (name, rows) => writeFileSync(resolve(here, `${name}.json`), JSON.stringify(rows, null, 2) + '\n')
const need = (value, what) => {
  if (value === undefined) throw new Error(`No description for ${what}`)
  return value
}
const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
const kebab = (name) => name.replace(/_/g, '-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()

function typeName(t) {
  if (typeof t === 'string') return t
  if (t.array) return `[${typeName(t.array[0])}; ${t.array[1]}]`
  if (t.vec) return `Vec<${typeName(t.vec)}>`
  if (t.option) return `Option<${typeName(t.option)}>`
  if (t.defined) return t.defined.name
  throw new Error(`Unknown IDL type ${JSON.stringify(t)}`)
}
function typeSize(t) {
  const sizes = { bool: 1, u8: 1, u16: 2, u32: 4, u64: 8, pubkey: 32 }
  if (typeof t === 'string') return sizes[t] ?? null
  if (t.array) return typeSize(t.array[0]) === null ? null : typeSize(t.array[0]) * t.array[1]
  if (t.defined) {
    const def = idl.types.find((x) => x.name === t.defined.name).type
    return def.kind === 'enum' ? 1 : null
  }
  return null
}
const typeDef = (name) => idl.types.find((t) => t.name === name).type

// ---------------------------------------------------------------- accounts

const FIELDS = {
  Config: {
    admin: 'The wallet that may change the configuration.',
    attestation_program: 'The program whose attestation records the protocol reads.',
    record_layout_version: 'The layout version of those records.',
    fee_recipient: 'The wallet the protocol share of every settled call is paid to.',
    protocol_share_bps: 'The protocol share of a call\'s price, in basis points.',
    call_deadline_slots: 'How many slots after opening a call can still settle.',
    bump: 'The PDA bump.',
    max_open_answer_bytes: 'Maximum length in bytes of an open answer stored on a Receipt, 1 to 4,096.',
  },
  Model: {
    owner: 'The wallet that sealed the model.',
    name: 'The model\'s name, 1 to 32 bytes: lowercase letters and digits in groups joined by single hyphens.',
    manifest: 'The manifest as compact UTF-8 JSON, up to 4,096 bytes. A `sketch` manifest leaves out the fields that equal the sketch defaults.',
    weights: 'The Weights accounts in order, 1 to 64.',
    size_bytes: 'The length of the ciphertext across all Weights accounts.',
    cipher: 'The cipher id, `xchacha20poly1305-64k-v1`.',
    nonce_prefix: 'The 16-byte nonce prefix of the weights cipher.',
    ciphertext_sha256: 'Ciphertext root hash (`hash_version = 0`: flat SHA-256; `hash_version = 1`: 64 KiB chunk Merkle root). All zero until the model is sealed.',
    allowed_measurements: 'The measurements allowed to open the model, 1 to 8.',
    price: 'The price of one unit (one call when `price_unit` is `Call`, or one output token when `Token`), in base units of the price mint.',
    price_mint: 'The mint the price is paid in. The default (all-zero) address means SOL.',
    operator_share_bps: 'The operator\'s share of the price, in basis points.',
    upload_key: 'The primary key allowed to write the ciphertext. The default address once the model is sealed.',
    status: '`Uploading`, `Sealed`, `Live` or `Retired`.',
    created_slot: 'The slot the model was created in.',
    sealed_slot: 'The slot the model was sealed in. 0 until then.',
    calls_settled: 'How many calls to the model have settled.',
    bump: 'The PDA bump.',
    upload_keys: 'Every key authorized to write the ciphertext, 1 to 8 (starts with `upload_key`). Empty once the model is sealed.',
    hash_version: '`0` for legacy flat SHA-256 across all ciphertext bytes; `1` for the 64 KiB chunk binary Merkle root.',
    sealed_chunks: 'Count of 65,552-byte ciphertext chunks folded into `merkle_frontier` so far during range sealing.',
    merkle_frontier: 'Incremental binary Merkle peaks (up to 20 hashes) maintained across `seal_range` calls and cleared on `seal_model`.',
    merkle_frontier_mask: 'Bitmask of occupied levels in `merkle_frontier`, cleared to 0 on `seal_model`.',
    base: 'Optional `ModelBase` (`sha256`, `size_bytes`, `format`, `source`) binding a sealed adapter to a public open-weight base model. `None` for standalone models.',
    price_unit: 'Whether `price` is charged per `Call` (`0`) or per output `Token` (`1`).',
    has_policy: 'True when an active Policy PDA exists for this model (`["policy", model]`). When true, `open_call`, `open_metered_call`, `grant_by_owner` and `grant_by_enclave` require the Policy PDA in remaining accounts.',
  },
  Enclave: {
    signing_key: 'The enclave\'s Ed25519 signing key, the key its attestation record names.',
    encryption_key: 'The enclave\'s X25519 encryption key. Grants and call inputs are encrypted to it.',
    operator: 'The wallet that registered the enclave. It receives the operator share.',
    endpoint: 'The enclave\'s `http://` or `https://` address, up to 256 bytes.',
    attestation_record: 'The address of the enclave\'s attestation record.',
    hardware_type: '0 `dev`, 1 Intel TDX, 2 AMD SEV-SNP, as the record states.',
    measurement: 'The 48-byte measurement the record states.',
    recorded_slot: 'The slot the record was written in, as of the last register or refresh.',
    expires_at_slot: 'The slot the record expires at, as of the last register or refresh.',
    calls_settled: 'How many calls the enclave has settled.',
    bump: 'The PDA bump.',
  },
  Measurement: {
    digest: 'The 48-byte SHA-384 software measurement digest, non-zero.',
    publisher: 'The wallet that published this measurement record and paid its rent.',
    source_repo: 'Source repository URL or identifier, 1 to 128 bytes with no whitespace or control characters.',
    commit_sha: 'Source commit SHA, 7 to 64 hex characters.',
    recipe_hash: 'The 32-byte SHA-256 hash of the reproducible build recipe (`voynich/enclave-recipe/v1`), non-zero.',
    version: 'Release version label, 1 to 32 bytes with no whitespace or control characters.',
    created_slot: 'The slot the measurement record was published in.',
    status: '`Active` (`0`) or `Deprecated` (`1`).',
    bump: 'The PDA bump.',
  },
  Policy: {
    model: 'The Model this policy governs.',
    allow_list_enabled: 'When true, only wallets in `allowed_callers` may open calls on the model.',
    allowed_callers: 'Callers allowed to open calls when `allow_list_enabled` is true, up to 32 unique addresses.',
    max_calls_per_caller_per_window: 'Maximum calls per caller inside one `window_slots` window. `0` (with `window_slots = 0`) disables rate limits.',
    window_slots: 'Rate-limit window length in slots. Must be `0` when `max_calls_per_caller_per_window` is `0`, and positive otherwise.',
    allowed_operators: 'Enclave operators allowed to receive grants for this model, up to 16 unique addresses. Empty means any operator.',
    allowed_regions: 'Allowed region codes, up to 8 unique codes of 1 to 16 lowercase letters, digits or hyphens each. Empty means any region.',
    updated_slot: 'The slot the policy was last created or updated in.',
    bump: 'The PDA bump.',
  },
  Grant: {
    model: 'The Model the grant opens.',
    enclave: 'The Enclave the grant is made to.',
    wrapped_key: 'The model key wrapped to the enclave\'s encryption key: a version 1 envelope of 105 bytes.',
    granted_by: 'The owner\'s wallet, or the Enclave account of the enclave that passed the key on.',
    granted_slot: 'The slot the grant was written in.',
    revoked: 'True once the owner has revoked the grant.',
    bump: 'The PDA bump.',
  },
  Call: {
    caller: 'The wallet that opened the call and paid the escrow.',
    model: 'The Model called.',
    enclave: 'The Enclave chosen to answer.',
    nonce: 'A number the caller chose. With the caller it gives the call its address.',
    input_hash: 'SHA-256 of the input envelope.',
    price: 'The model\'s unit price when the call opened (one call for `Call`, or one output token for `Token`).',
    price_mint: 'The mint of the escrow. The default address means SOL.',
    owner: 'The model\'s owner when the call opened. Receives the owner\'s part.',
    operator: 'The enclave\'s operator when the call opened. Receives the operator share.',
    fee_recipient: 'The protocol\'s fee recipient when the call opened. Receives the protocol share.',
    operator_share_bps: 'The model\'s operator share when the call opened.',
    protocol_share_bps: 'The protocol share when the call opened.',
    opened_slot: 'The slot the call opened in.',
    deadline_slot: 'The last slot the call can settle in. After it the call can be refunded.',
    status: '`Open`, `Settled` or `Refunded`.',
    bump: 'The PDA bump.',
    answer_mode: '`Sealed` or `Open`. An open call stores its answer bytes on chain in the Receipt.',
    caller_is_program: 'True when `open_call` or `open_metered_call` was invoked by another Solana program through CPI.',
    callback_program: 'Program invoked on `on_receipt` inside `settle_call`. The default (all-zero) address means no callback.',
    callback_accounts: 'Up to 8 `CallbackAccount` entries (`pubkey`, `is_writable`) passed to `callback_program::on_receipt` after `[receipt, call, model]`.',
    price_unit: 'Whether the call is priced per `Call` (`0`) or per output `Token` (`1`), snapshotted from the model.',
    ceiling: 'Escrow ceiling in base units of `price_mint`. Equals `price` for `Call` calls; for `Token` calls it is the caller-supplied maximum escrow deposited by `open_metered_call`.',
  },
  Receipt: {
    call: 'The Call this receipt settles.',
    model: 'The Model that was called.',
    enclave: 'The Enclave that answered.',
    input_hash: 'SHA-256 of the input envelope.',
    output_hash: 'SHA-256 of the output envelope for a `Sealed` call, or of `open_answer` for an `Open` call.',
    signature: 'The enclave\'s Ed25519 signature over the receipt message.',
    slot: 'The slot the call settled in.',
    price_mint: 'The mint that was paid. The default address means SOL.',
    total: 'The whole price paid out.',
    owner: 'The wallet paid the owner\'s part.',
    operator: 'The wallet paid the operator share.',
    fee_recipient: 'The wallet paid the protocol share.',
    owner_amount: 'What the owner received.',
    operator_amount: 'What the operator received.',
    protocol_amount: 'What the fee recipient received.',
    bump: 'The PDA bump.',
    answer_mode: '`Sealed` or `Open`, matching the Call.',
    open_answer: 'Plaintext answer bytes stored on chain for an `Open` call (SHA-256 equals `output_hash`). Empty for a `Sealed` call.',
    caller_is_program: 'True when the settled Call was opened through CPI by another Solana program.',
  },
}

const accounts = idl.accounts.map((account) => {
  const fields = typeDef(account.name).fields
  let offset = 8
  const rows = fields.map((field) => {
    const size = typeSize(field.type)
    const row = {
      field: field.name,
      type: typeName(field.type),
      offset: offset === null ? '' : String(offset),
      meaning: need(FIELDS[account.name]?.[field.name], `${account.name}.${field.name}`),
    }
    offset = offset === null || size === null ? null : offset + size
    return row
  })
  for (const name of Object.keys(FIELDS[account.name] ?? {})) {
    if (!fields.some((f) => f.name === name)) throw new Error(`${account.name}.${name} is described but not in the IDL`)
  }
  out(`account-${kebab(account.name)}`, rows)
  return { account: account.name, discriminator: `\`${hex(account.discriminator)}\``, fields: fields.length, bytes: offset === null ? '' : String(offset) }
})
out('program-accounts', accounts)

// ------------------------------------------------------------ instructions

const SAYS = {
  initialize: 'Creates the Config. Sent once by the program\'s upgrade authority.',
  set_config: 'Changes the Config.',
  migrate_config: 'Reallocates a legacy 116-byte Config to 118 bytes and sets `max_open_answer_bytes`.',
  migrate_model: 'Zeroes trailing pre-Build-4 padding bytes in a Model account so trailing `price_unit` decodes cleanly as `Call`.',
  create_model: 'Creates a Model in `Uploading`, binds its initial Weights accounts and funds its upload keys.',
  attach_weights: 'Binds additional preallocated Weights accounts to an uploading model, up to 64 total.',
  write_weights: 'Writes ciphertext bytes into one Weights account.',
  seal_range: 'Hashes 1 to 8 consecutive 65,552-byte ciphertext chunks into the model\'s Merkle frontier.',
  seal_model: 'Finalizes the ciphertext root hash and moves the model to `Sealed`.',
  set_price: 'Sets a model\'s price, price mint, operator share and price unit.',
  set_allowed_measurements: 'Replaces a model\'s allowed measurements list (1 to 8).',
  retire_model: 'Moves a model to `Retired`. No new calls open.',
  register_enclave: 'Creates an Enclave from a current attestation record.',
  refresh_enclave: 'Copies the enclave\'s current attestation record into its Enclave account and sets its endpoint.',
  grant_by_owner: 'Writes a Grant from the owner to an enclave and moves the model to `Live`.',
  grant_by_enclave: 'Writes a Grant from an enclave that holds one to another enclave.',
  revoke_grant: 'Marks a Grant revoked. No new calls open on it.',
  open_call: 'Creates a per-call Call and moves the model\'s price into its escrow.',
  open_metered_call: 'Creates a per-token metered Call and moves the caller\'s escrow ceiling into its escrow.',
  settle_call: 'Checks the enclave\'s signature, writes the Receipt and pays out the escrow.',
  settle_metered_call: 'Checks the enclave\'s piece signature, writes a 423-byte metered Receipt, pays out count * price and returns the unspent ceiling to the caller.',
  refund_call: 'Returns the escrow of a call past its deadline to the caller.',
  publish_measurement: 'Creates an immutable Measurement PDA binding a 48-byte SHA-384 digest to its source repo, commit SHA, recipe hash and version.',
  deprecate_measurement: 'Marks a published Measurement PDA as `Deprecated`. Callable only by its publisher or `Config.admin`.',
  set_policy: 'Creates or updates a model\'s Policy PDA and sets `model.has_policy = true`. Callable only by the model\'s owner.',
  clear_policy: 'Closes a model\'s Policy PDA, returns its rent to the owner and sets `model.has_policy = false`. Callable only by the model\'s owner.',
}
const ORDER = Object.keys(SAYS)

const COMMON = {
  config: 'The protocol\'s Config.',
  system_program: 'The System program.',
  token_program: 'The SPL Token program. Only for a price in a mint.',
  associated_token_program: 'The Associated Token program. Only for a price in a mint.',
  event_authority: 'The program\'s event authority.',
  program: 'The Voynich program.',
  model: 'The Model.',
  attestation_record: 'The enclave\'s attestation record.',
}
const ACCOUNTS = {
  initialize: {
    admin: 'The program\'s upgrade authority. Becomes the Config\'s admin and pays its rent.',
    config: 'The Config, created here.',
    program_account: 'The Voynich program.',
    program_data: 'The program\'s ProgramData account, which names the upgrade authority.',
  },
  set_config: { admin: 'The Config\'s admin.' },
  migrate_config: { admin: 'The Config\'s admin. Pays the rent difference for reallocating the Config.' },
  migrate_model: {
    authority: 'Either the model\'s owner or the Config\'s admin.',
    model: 'The Model account whose trailing tail bytes are repaired and re-validated.',
  },
  create_model: {
    owner: 'The model\'s owner. Pays the Model\'s rent and the upload funding.',
    upload_key: 'The primary fresh key that will write the ciphertext: system-owned, holding no data, different from the owner. Up to 7 additional upload keys may follow the Weights accounts in remaining accounts.',
    model: 'The Model, created here.',
  },
  attach_weights: {
    upload_key: 'One of the model\'s authorized upload keys (`model.upload_key` or an entry in `model.upload_keys`).',
  },
  write_weights: {
    upload_key: 'One of the model\'s authorized upload keys (`model.upload_key` or an entry in `model.upload_keys`).',
    weights: 'The Weights account written to. It is one of the model\'s.',
  },
  seal_range: {
    upload_key: 'One of the model\'s authorized upload keys (`model.upload_key` or an entry in `model.upload_keys`).',
  },
  seal_model: { owner: 'The model\'s owner.' },
  set_price: { owner: 'The model\'s owner.' },
  set_allowed_measurements: { owner: 'The model\'s owner.' },
  retire_model: { owner: 'The model\'s owner.' },
  register_enclave: {
    operator: 'The operator\'s wallet. Pays the Enclave\'s rent and receives the operator share of its calls.',
    signing_key: 'The enclave\'s signing key, the key the attestation record names.',
    enclave: 'The Enclave, created here.',
  },
  refresh_enclave: {
    signing_key: 'The enclave\'s signing key.',
    enclave: 'The Enclave.',
  },
  grant_by_owner: {
    owner: 'The model\'s owner.',
    payer: 'Pays the Grant\'s rent.',
    target_enclave: 'The Enclave the grant is made to.',
    target_attestation_record: 'That enclave\'s attestation record.',
    grant: 'The Grant, created here or written over.',
  },
  grant_by_enclave: {
    signing_key: 'The signing key of the enclave that passes the key on.',
    payer: 'Pays the Grant\'s rent.',
    source_enclave: 'The Enclave that passes the key on.',
    source_grant: 'Its own Grant for this model, not revoked.',
    source_attestation_record: 'Its attestation record.',
    target_enclave: 'The Enclave the grant is made to.',
    target_attestation_record: 'That enclave\'s attestation record.',
    grant: 'The Grant, created here or written over.',
  },
  revoke_grant: {
    owner: 'The model\'s owner.',
    grant: 'The Grant to revoke.',
  },
  open_call: {
    payer: 'Pays the Call\'s rent and, for a price in a mint, the escrow token account rent. Equals `caller` for a wallet call, or a transaction fee payer when `caller` is a program-derived address signed via CPI.',
    caller: 'The wallet or program-derived address that opens the call and funds the escrow. Receives any refund.',
    enclave: 'The Enclave chosen to answer.',
    grant: 'That enclave\'s Grant for the model, not revoked.',
    call: 'The Call, created here.',
    mint: 'The model\'s price mint. Only for a price in a mint.',
    caller_tokens: 'The caller\'s token account for the mint. Only for a price in a mint.',
    escrow_tokens: 'The Call\'s associated token account for the mint, created here. Only for a price in a mint.',
  },
  open_metered_call: {
    payer: 'Pays the Call\'s rent and, for a price in a mint, the escrow token account rent. Equals `caller` for a wallet call, or a transaction fee payer when `caller` is a program-derived address signed via CPI.',
    caller: 'The wallet or program-derived address that opens the metered call and funds the escrow ceiling. Receives any refund.',
    enclave: 'The Enclave chosen to answer.',
    grant: 'That enclave\'s Grant for the model, not revoked.',
    call: 'The Call, created here.',
    mint: 'The model\'s price mint. Only for a price in a mint.',
    caller_tokens: 'The caller\'s token account for the mint. Only for a price in a mint.',
    escrow_tokens: 'The Call\'s associated token account for the mint, created here. Only for a price in a mint.',
  },
  settle_call: {
    payer: 'Pays the Receipt\'s rent and the transaction fee. The enclave\'s runtime sends it.',
    enclave: 'The Enclave that answered.',
    call: 'The Call being settled.',
    receipt: 'The Receipt, created here.',
    caller: 'The call\'s caller.',
    owner: 'The owner recorded in the call.',
    operator: 'The operator recorded in the call.',
    fee_recipient: 'The fee recipient recorded in the call.',
    instructions: 'The Instructions sysvar.',
    escrow_tokens: 'The Call\'s associated token account. Only for a price in a mint.',
    owner_tokens: 'The owner\'s associated token account. Only for a price in a mint.',
    operator_tokens: 'The operator\'s associated token account. Only for a price in a mint.',
    protocol_tokens: 'The fee recipient\'s associated token account. Only for a price in a mint.',
    caller_tokens: 'A token account of the caller\'s for the mint. Only for a price in a mint.',
  },
  settle_metered_call: {
    payer: 'Pays the 423-byte metered Receipt\'s rent and transaction fee. Must be either `call.operator` (enclave runtime) or `call.caller` (caller self-settlement), else `Unauthorized`.',
    enclave: 'The Enclave that streamed the pieces.',
    call: 'The per-token Call being settled.',
    receipt: 'The 423-byte metered Receipt PDA, initialized here (handles pre-funded lamports cleanly).',
    caller: 'The call\'s caller. Receives any unspent ceiling (`returned_amount`) and closed SPL escrow rent.',
    owner: 'The owner recorded in the call.',
    operator: 'The operator recorded in the call.',
    fee_recipient: 'The fee recipient recorded in the call.',
    instructions: 'The Instructions sysvar.',
    escrow_tokens: 'The Call\'s associated token account. Only for a price in a mint.',
    owner_tokens: 'The owner\'s associated token account. Only for a price in a mint.',
    operator_tokens: 'The operator\'s associated token account. Only for a price in a mint.',
    protocol_tokens: 'The fee recipient\'s associated token account. Only for a price in a mint.',
    caller_tokens: 'A token account of the caller\'s for the mint. Receives any unspent SPL ceiling. Only for a price in a mint.',
  },
  refund_call: {
    actor: 'Whoever sends the refund: the caller or anyone else.',
    call: 'The Call being refunded.',
    caller: 'The call\'s caller. Receives the escrow.',
    escrow_tokens: 'The Call\'s associated token account. Only for a price in a mint.',
    caller_tokens: 'A token account of the caller\'s for the mint. Only for a price in a mint.',
  },
  publish_measurement: {
    publisher: 'The wallet publishing the measurement. Pays the 366-byte Measurement PDA\'s rent.',
    measurement: 'The Measurement PDA at `["measurement", digest[..32], digest[32..]]`, created here.',
  },
  deprecate_measurement: {
    authority: 'Either `measurement.publisher` or `config.admin`.',
    measurement: 'The active Measurement PDA to mark `Deprecated`.',
  },
  set_policy: {
    owner: 'The model\'s owner. Pays the 1,770-byte Policy PDA\'s rent on creation.',
    policy: 'The Policy PDA at `["policy", model]`, created if needed or updated in place.',
  },
  clear_policy: {
    owner: 'The model\'s owner. Receives the closed Policy PDA\'s rent.',
    policy: 'The Policy PDA at `["policy", model]`, closed here.',
  },
}

const text = (bytes) => Buffer.from(bytes).toString('utf8')
function address(account) {
  if (account.address) return `\`${account.address}\``
  if (!account.pda) return ''
  const seeds = account.pda.seeds.map((seed) => (seed.kind === 'const' ? `"${text(seed.value)}"` : seed.path))
  return `PDA \`[${seeds.join(', ')}]\``
}

const byName = Object.fromEntries(idl.instructions.map((ix) => [ix.name, ix]))
for (const name of idl.instructions.map((ix) => ix.name)) need(SAYS[name], `instruction ${name}`)
out('program-instructions', ORDER.map((name) => {
  const ix = need(byName[name], `IDL instruction ${name}`)
  return {
    instruction: name,
    arguments: ix.args.map((arg) => `\`${arg.name}: ${typeName(arg.type)}\``).join(', '),
    signers: ix.accounts.filter((a) => a.signer).map((a) => `\`${a.name}\``).join(', '),
    does: SAYS[name],
  }
}))
for (const name of ORDER) {
  const ix = byName[name]
  out(`ix-${kebab(name)}`, ix.accounts.map((account) => ({
    account: account.name,
    writable: account.writable ? 'yes' : '',
    signer: account.signer ? 'yes' : '',
    optional: account.optional ? 'yes' : '',
    address: address(account),
    is: need(ACCOUNTS[name]?.[account.name] ?? COMMON[account.name], `${name}.${account.name}`),
  })))
  if (ix.args.length) {
    out(`ix-${kebab(name)}-args`, ix.args.flatMap((arg) => {
      const defined = typeof arg.type === 'object' && arg.type.defined
      const def = defined ? typeDef(arg.type.defined.name) : null
      const fields = def && def.kind === 'struct' ? def.fields : [arg]
      return fields.map((field) => ({ argument: field.name, type: typeName(field.type) }))
    }))
  }
}

// ------------------------------------------------------------------ events

const EVENTS = {
  ConfigChanged: ['initialize, set_config, migrate_config', 'The Config was created, migrated or changed.'],
  ModelCreated: ['create_model', 'A model was created in `Uploading`.'],
  WeightsAttached: ['attach_weights', 'Additional Weights accounts were bound to an uploading model.'],
  WeightsWritten: ['write_weights', 'Ciphertext bytes were written.'],
  RangeSealed: ['seal_range', 'A batch of 65,552-byte ciphertext chunks was hashed into the model\'s Merkle frontier.'],
  ModelSealed: ['seal_model', 'A model\'s ciphertext root hash was fixed.'],
  ModelPriceChanged: ['set_price', 'A model\'s price, mint, operator share or price unit changed.'],
  ModelAllowedMeasurementsChanged: ['set_allowed_measurements', 'A model\'s allowed measurements list changed.'],
  ModelStatusChanged: ['grant_by_owner, retire_model', 'A model became `Live` or `Retired`.'],
  EnclaveChanged: ['register_enclave, refresh_enclave', 'An enclave was registered or refreshed.'],
  GrantChanged: ['grant_by_owner, grant_by_enclave, revoke_grant', 'A grant was written or revoked.'],
  CallOpened: ['open_call, open_metered_call', 'A call opened with its escrow.'],
  CallSettled: ['settle_call, settle_metered_call', 'A call settled and its receipt was written.'],
  CallRefunded: ['refund_call', 'A call\'s escrow returned to the caller.'],
  MeasurementPublished: ['publish_measurement', 'A 48-byte enclave measurement was published with its source commit and recipe hash.'],
  MeasurementDeprecated: ['deprecate_measurement', 'A published measurement was marked `Deprecated`.'],
  PolicyUpdated: ['set_policy', 'A model\'s on-chain Policy PDA was created or updated.'],
  PolicyCleared: ['clear_policy', 'A model\'s on-chain Policy PDA was closed and cleared.'],
}
for (const event of idl.events) need(EVENTS[event.name], `event ${event.name}`)
out('program-events', Object.keys(EVENTS).map((name) => {
  const event = need(idl.events.find((e) => e.name === name), `IDL event ${name}`)
  return { event: name, discriminator: `\`${hex(event.discriminator)}\``, emittedBy: EVENTS[name][0].split(', ').map((x) => `\`${x}\``).join(', '), says: EVENTS[name][1] }
}))
for (const event of idl.events) {
  out(`event-${kebab(event.name)}`, typeDef(event.name).fields.map((field) => ({ field: field.name, type: typeName(field.type) })))
}

// ------------------------------------------------------------------ errors

const RAISED = {
  Unauthorized: 'The signer is not the one the account names: the Config\'s admin, the program\'s upgrade authority, the model\'s owner, the model\'s upload key, the enclave\'s signing key, neither `call.operator` nor `call.caller` in `settle_metered_call`, or neither `measurement.publisher` nor `config.admin` in `deprecate_measurement`.',
  InvalidConfig: 'A Config value is out of range: a default address for the attestation program or fee recipient, layout version 0, a protocol share above 10,000, a deadline of 0 slots, or `max_open_answer_bytes` outside 1 to 4,096. In `open_call` and `open_metered_call`: the model\'s operator share plus the protocol share exceeds 10,000.',
  InvalidModel: 'In `create_model`: a name that is empty, longer than 32 bytes or not lowercase groups joined by hyphens; an empty manifest or one above 4,096 bytes; a size of 16 bytes or less; an unknown cipher id; no measurement or more than 8; an invalid `base` (`sha256` all zero, `size_bytes` 0, `format` outside `onnx`, `safetensors` or `gguf`, or `source` empty, above 256 bytes, containing whitespace/control characters, or not starting with `https://`, `http://`, `ipfs://` or `hf://`); an upload key (primary or extra) that is the owner, duplicates another upload key, holds data, is not system-owned, or (for extra keys) is not writable; more than 8 total upload keys (`1 + extra_upload_key_count`). In `create_model` and `set_price`: operator share plus protocol share above 10,000. In `set_allowed_measurements`: no measurement or more than 8.',
  ModelNotUploading: '`attach_weights`, `write_weights`, `seal_range` or `seal_model` on a model that is already sealed.',
  ModelNotSealed: '`grant_by_owner` on a model that is `Uploading` or `Retired`.',
  ModelNotLive: '`open_call`, `open_metered_call` or `grant_by_enclave` on a model that is not `Live`.',
  InvalidWeights: 'In `create_model` and `attach_weights`: no Weights account or more than 64 total; one that is not owned by the program, not writable, not rent-exempt, listed twice, larger than 10 MiB, or whose first 56 bytes are not zero; cumulative sizes exceeding `size_bytes`. In `write_weights`, `seal_range` and `seal_model`: an account that does not match the model\'s Weights accounts or expected range.',
  InvalidWrite: 'In `write_weights`: no bytes, or an end past the account\'s size.',
  UploadIncomplete: '`seal_model` while a Weights account has not been written to its end.',
  CiphertextHashMismatch: '`seal_model` with a hash that is not the SHA-256 of the bytes on chain.',
  InvalidAttestation: 'The attestation record is not owned by the configured attestation program, is not at the address derived from the signing key, has another layout, names another key, or is expired at the current slot.',
  MeasurementNotAllowed: 'The enclave\'s measurement is not in the model\'s allowed measurements.',
  InvalidEnclave: 'In `register_enclave` and `refresh_enclave`: an endpoint that is empty, above 256 bytes or not `http://` or `https://`; an all-zero encryption key. In grants and calls: a record account that is not the one the Enclave names, or whose hardware type or measurement differs from the Enclave\'s. In `grant_by_enclave`: source and target are the same enclave.',
  InvalidWrappedKey: 'A wrapped key that is not 105 bytes or does not start with version byte 1.',
  GrantRequired: '`open_call` or `open_metered_call` on a revoked grant, or `grant_by_enclave` from an enclave whose own grant is revoked.',
  CallNotOpen: '`settle_call`, `settle_metered_call` or `refund_call` on a call that already settled or was refunded.',
  CallDeadlinePassed: '`settle_call` or `settle_metered_call` after the call\'s deadline slot.',
  CallNotRefundable: '`refund_call` at or before the call\'s deadline slot.',
  InvalidSignature: 'In `settle_call` or `settle_metered_call`: the Ed25519 instruction at the given index is missing, or does not carry this signature, the enclave\'s signing key and the expected receipt or piece message.',
  InvalidTokenAccount: 'A token account, mint or token program is missing for a price in a mint, has the wrong owner or mint, or is not the associated token account where one is required.',
  InvalidRecipient: 'In `settle_call`, `settle_metered_call` and `refund_call`: the caller, owner, operator or fee recipient passed is not the one recorded in the call.',
  InsufficientEscrow: 'The call\'s escrow holds less than its required payout (`price` for `Call`, `ceiling` for `Token`, or `count * price > ceiling` in `settle_metered_call`).',
  ArithmeticOverflow: 'A slot, counter or `count * price` passed the 64-bit limit.',
  InvalidOpenAnswer: 'In `settle_call`: `open_answer` is non-empty on a `Sealed` call, or on an `Open` call is empty, exceeds `Config.max_open_answer_bytes`, or does not hash to `output_hash`. In `settle_metered_call`: the call is not `AnswerMode::Sealed`.',
  InvalidCallback: 'In `open_call` or `open_metered_call`: `callback.program` is the default address or the `voynich` program itself, or `callback.accounts` has more than 8 entries. In `settle_call` or `settle_metered_call`: remaining accounts do not match `[callback_program, ...callback_accounts]`, the callback program is not executable, or a writable callback account is passed read-only.',
  InvalidCall: 'In `open_call`: the model is priced per `Token`. In `open_metered_call`: the model is priced per `Call`, `ceiling` is below `model.price`, or `ceiling` is `0` when `model.price > 0`. In `settle_call`: the call is priced per `Token`. In `settle_metered_call`: the call is not priced per `Token` or the receipt PDA is already initialized.',
  InvalidMeasurement: 'In `publish_measurement`: an all-zero `digest` or `recipe_hash`, an empty/oversized/whitespace `source_repo` (max 128) or `version` (max 32), or a `commit_sha` outside 7 to 64 hex characters. In `deprecate_measurement`: the measurement is already `Deprecated`.',
  InvalidPolicy: 'In `set_policy`: `allowed_callers` exceeds 32 or has duplicates, `allowed_operators` exceeds 16 or has duplicates, `allowed_regions` exceeds 8 or has duplicates or invalid codes (outside 1 to 16 lowercase letters, digits or hyphens), or only one of `max_calls_per_caller_per_window` and `window_slots` is zero.',
  PolicyCallerDenied: 'In `open_call` or `open_metered_call`: the model\'s Policy has `allow_list_enabled` set and `caller` is not in `allowed_callers`.',
  PolicyOperatorDenied: 'In `grant_by_owner` or `grant_by_enclave`: the model\'s Policy has a non-empty `allowed_operators` list and `target_enclave.operator` is not in it.',
  PolicyRequired: 'In `open_call`, `open_metered_call`, `grant_by_owner` or `grant_by_enclave`: `model.has_policy` is true, but the canonical Policy PDA (`["policy", model]`, owned by the Voynich program) was omitted from remaining accounts.',
}
for (const name of Object.keys(RAISED)) need(idl.errors.find((e) => e.name === name), `IDL error ${name}`)
out('program-errors', idl.errors.map((error) => ({
  name: error.name,
  code: String(error.code),
  hex: `\`0x${error.code.toString(16)}\``,
  message: error.msg,
  raisedWhen: need(RAISED[error.name], `error ${error.name}`),
})))

// --------------------------------------------------------------------- API

const API_ERRORS = {
  VALIDATION_ERROR: 'The request\'s path, query or body does not match the route\'s schema. `fieldErrors` names each field.',
  UNAUTHORIZED: 'The request is not allowed for this caller.',
  ORIGIN_NOT_ALLOWED: 'The browser origin is not on the API\'s allow list.',
  NOT_FOUND: 'No route at this path, or no transaction build has this id.',
  PROGRAM_UNAVAILABLE: 'The API cannot reach the program on its cluster yet.',
  CONFIGURATION_REQUIRED: 'A value the route needs is not configured on this deployment.',
  IDEMPOTENCY_CONFLICT: 'The build was already submitted with another idempotency key.',
  TRANSACTION_EXPIRED: 'The transaction\'s blockhash expired before it landed. Build again.',
  PAYLOAD_TOO_LARGE: 'The request body is larger than the route accepts.',
  UNSUPPORTED_MEDIA_TYPE: 'The request body is not `application/json`.',
  SIMULATION_FAILED: 'The transaction failed in simulation.',
  CHAIN_REFUSED: 'The cluster refused the transaction.',
  RATE_LIMITED: 'Too many requests. `retryAfterSeconds` says when to try again.',
  INTERNAL_ERROR: 'The API failed.',
  UPSTREAM_UNAVAILABLE: 'The RPC or the enclave behind the API did not answer.',
  MODEL_NOT_FOUND: 'No model has this name or address.',
  MODEL_NOT_LIVE: 'The model is not `live`, so it takes no new call.',
  MODEL_NOT_UPLOADING: 'The model is already sealed, so it takes no write and no second seal.',
  ENCLAVE_NOT_FOUND: 'No enclave has this address or signing key.',
  ENCLAVE_EXPIRED: 'The enclave\'s attestation record has expired.',
  MEASUREMENT_NOT_ALLOWED: 'The enclave\'s measurement is not in the model\'s allowed measurements.',
  GRANT_REQUIRED: 'The enclave holds no live grant for the model.',
  CALL_NOT_FOUND: 'No call has this address.',
  CALL_NOT_OPEN: 'The call already settled or was refunded.',
  CALL_NOT_REFUNDABLE: 'The call\'s deadline has not passed.',
  CALL_DEADLINE_PASSED: 'The call\'s deadline has passed, so it takes no input.',
  RECEIPT_NOT_FOUND: 'No receipt matches this receipt address, call address or transaction signature.',
  INPUT_HASH_MISMATCH: 'The envelope sent does not hash to the call\'s input hash.',
  INVALID_ENVELOPE: 'The envelope is not a version 1 envelope.',
  UPLOAD_INCOMPLETE: 'Not every ciphertext byte is written yet.',
  CIPHERTEXT_HASH_MISMATCH: 'The hash sent is not the SHA-256 of the bytes written.',
  PROGRAM_REFUSED: 'The Voynich program refused the transaction. `programError` names the program error.',
  INSUFFICIENT_FUNDS: 'The wallet holds less than the transaction needs. `funding` gives the mint and the required, available and shortfall amounts.',
  BOUNTY_NOT_FOUND: 'No bounty has this address.',
  BOUNTY_NOT_OPEN: 'The bounty is already claimed or cancelled.',
  MEASUREMENT_NOT_FOUND: 'No on-chain measurement record exists for this 48-byte digest.',
  MEASUREMENT_ALREADY_EXISTS: 'A measurement record for this 48-byte digest is already published on chain.',
  MEASUREMENT_DEPRECATED: 'This measurement record is already marked deprecated.',
  INVALID_MEASUREMENT: 'The measurement digest, recipe hash, source repository, commit SHA, or version is invalid.',
  POLICY_NOT_FOUND: 'This model has no active on-chain policy.',
  INVALID_POLICY: 'The policy limits, callers, operators, or regions are invalid.',
  POLICY_CALLER_DENIED: 'The caller is not on this model\'s allow list.',
  POLICY_OPERATOR_DENIED: 'The enclave operator is not allowed by this model\'s policy.',
  POLICY_REQUIRED: 'This model has an active policy; pass its Policy account in remaining accounts.',
}
const status = contract.errors.status
for (const code of Object.keys(API_ERRORS)) need(status[code], `contract error ${code}`)
out('api-errors', Object.entries(status).map(([code, http]) => ({ code, status: String(http), meaning: need(API_ERRORS[code], `API error ${code}`) })))

const routes = []
for (const [path, methods] of Object.entries(openapi.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    routes.push({ route: `${method.toUpperCase()} ${path}`, operation: op.operationId, does: op.summary })
  }
}
out('api-routes', routes)

// ------------------------------------------------------------------- token

const { TOKEN } = await import(pathToFileURL(resolve(here, '../../../lib/facts.ts')).href)
const lockId = TOKEN.lockUrl ? TOKEN.lockUrl.split('/').filter(Boolean).pop() : ''
out('token', [
  { fact: 'Symbol', value: TOKEN.symbol },
  { fact: 'Supply', value: TOKEN.supply.toLocaleString('en-US') },
  { fact: 'Launch', value: TOKEN.launch },
  { fact: 'Developer allocation', value: TOKEN.developerAllocation ? `${TOKEN.allocation}: ${TOKEN.developerAllocation}` : TOKEN.allocation },
  ...(TOKEN.mint ? [{ fact: 'Mint', value: `\`${TOKEN.mint}\``, copy: TOKEN.mint }] : []),
  ...(TOKEN.lockUrl ? [{ fact: 'Lock', value: lockId ? `Streamflow contract ${lockId}` : 'Streamflow lock contract', href: TOKEN.lockUrl }] : []),
  ...(TOKEN.protocolShareBps === null ? [] : [{ fact: 'Protocol share', value: `${TOKEN.protocolShareBps / 100}% (${TOKEN.protocolShareBps} basis points) of every settled call` }]),
])

console.log(`accounts ${accounts.length}, instructions ${ORDER.length}, events ${idl.events.length}, errors ${idl.errors.length}, API errors ${Object.keys(status).length}, routes ${routes.length}`)
