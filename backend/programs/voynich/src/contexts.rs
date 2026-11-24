use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::{errors::VoynichError, state::*};

#[event_cpi]
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)] pub admin: Signer<'info>,
    #[account(init, payer = admin, space = Config::SPACE, seeds = [b"config"], bump)] pub config: Account<'info, Config>,
    #[account(constraint = program_account.programdata_address()? == Some(program_data.key()) @ VoynichError::Unauthorized)]
    pub program_account: Program<'info, crate::program::Voynich>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ VoynichError::Unauthorized)] pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SetConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin @ VoynichError::Unauthorized)] pub config: Account<'info, Config>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct MigrateConfig<'info> {
    #[account(mut)] pub admin: Signer<'info>,
    /// CHECK: verified in handler (owner, PDA ["config"], discriminator, legacy 116-byte layout, admin).
    #[account(mut)] pub config: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigrateModel<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)] pub config: Account<'info, Config>,
    /// CHECK: verified in handler (owner, discriminator, PDA ["model", name], owner/admin signer).
    #[account(mut)] pub model: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(args: CreateModelArgs)]
pub struct CreateModel<'info> {
    #[account(mut)] pub owner: Signer<'info>,
    #[account(mut)] pub upload_key: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)] pub config: Account<'info, Config>,
    #[account(init, payer = owner, space = Model::SPACE, seeds = [b"model", args.name.as_bytes()], bump)] pub model: Box<Account<'info, Model>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct WriteWeights<'info> {
    pub upload_key: Signer<'info>,
    #[account(seeds = [b"model", model.name.as_bytes()], bump = model.bump, constraint = model.is_upload_key(&upload_key.key()) @ VoynichError::Unauthorized)] pub model: Box<Account<'info, Model>>,
    /// CHECK: fixed header, owner, model and writable payload are checked in weights.rs.
    #[account(mut)] pub weights: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct AttachWeights<'info> {
    pub upload_key: Signer<'info>,
    #[account(mut, seeds = [b"model", model.name.as_bytes()], bump = model.bump, constraint = model.is_upload_key(&upload_key.key()) @ VoynichError::Unauthorized)] pub model: Box<Account<'info, Model>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SealRange<'info> {
    pub upload_key: Signer<'info>,
    #[account(mut, seeds = [b"model", model.name.as_bytes()], bump = model.bump, constraint = model.is_upload_key(&upload_key.key()) @ VoynichError::Unauthorized)] pub model: Box<Account<'info, Model>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SealModel<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"model", model.name.as_bytes()], bump = model.bump, has_one = owner @ VoynichError::Unauthorized)] pub model: Box<Account<'info, Model>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ModelOwner<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)] pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"model", model.name.as_bytes()], bump = model.bump, has_one = owner @ VoynichError::Unauthorized)] pub model: Box<Account<'info, Model>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RegisterEnclave<'info> {
    #[account(mut)] pub operator: Signer<'info>,
    pub signing_key: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)] pub config: Account<'info, Config>,
    /// CHECK: verified by the configured attestation adapter.
    pub attestation_record: UncheckedAccount<'info>,
    #[account(init, payer = operator, space = Enclave::SPACE, seeds = [b"enclave", signing_key.key().as_ref()], bump)] pub enclave: Box<Account<'info, Enclave>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RefreshEnclave<'info> {
    pub signing_key: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)] pub config: Account<'info, Config>,
    /// CHECK: verified by the configured attestation adapter.
    pub attestation_record: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"enclave", signing_key.key().as_ref()], bump = enclave.bump, has_one = signing_key @ VoynichError::Unauthorized)] pub enclave: Box<Account<'info, Enclave>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct GrantByOwner<'info> {
    pub owner: Signer<'info>,
    #[account(mut)] pub payer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)] pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"model", model.name.as_bytes()], bump = model.bump, has_one = owner @ VoynichError::Unauthorized)] pub model: Box<Account<'info, Model>>,
    #[account(seeds = [b"enclave", target_enclave.signing_key.as_ref()], bump = target_enclave.bump)] pub target_enclave: Box<Account<'info, Enclave>>,
    /// CHECK: verified against the target enclave and configured verifier.
    pub target_attestation_record: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = payer, space = Grant::SPACE, seeds = [b"grant", model.key().as_ref(), target_enclave.key().as_ref()], bump)] pub grant: Account<'info, Grant>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct GrantByEnclave<'info> {
    pub signing_key: Signer<'info>,
    #[account(mut)] pub payer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)] pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"model", model.name.as_bytes()], bump = model.bump)] pub model: Box<Account<'info, Model>>,
    #[account(seeds = [b"enclave", signing_key.key().as_ref()], bump = source_enclave.bump, has_one = signing_key @ VoynichError::Unauthorized)] pub source_enclave: Box<Account<'info, Enclave>>,
    /// CHECK: verified in handler (owner, PDA ["grant", model, source_enclave], discriminator, legacy 223B or 226B layout).
    #[account(seeds = [b"grant", model.key().as_ref(), source_enclave.key().as_ref()], bump)] pub source_grant: UncheckedAccount<'info>,
    /// CHECK: verified against the source enclave and configured verifier.
    pub source_attestation_record: UncheckedAccount<'info>,
    #[account(seeds = [b"enclave", target_enclave.signing_key.as_ref()], bump = target_enclave.bump)] pub target_enclave: Box<Account<'info, Enclave>>,
    /// CHECK: verified against the target enclave and configured verifier.
    pub target_attestation_record: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = payer, space = Grant::SPACE, seeds = [b"grant", model.key().as_ref(), target_enclave.key().as_ref()], bump)] pub grant: Account<'info, Grant>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RevokeGrant<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"model", model.name.as_bytes()], bump = model.bump, has_one = owner @ VoynichError::Unauthorized)] pub model: Box<Account<'info, Model>>,
    /// CHECK: verified in handler (owner, PDA ["grant", model, grant.enclave], discriminator, legacy 223B or 226B layout).
    #[account(mut)] pub grant: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SetQuote<'info> {
    #[account(mut)] pub operator: Signer<'info>,
    #[account(seeds = [b"model", model.name.as_bytes()], bump = model.bump)] pub model: Box<Account<'info, Model>>,
    #[account(seeds = [b"enclave", enclave.signing_key.as_ref()], bump = enclave.bump, has_one = operator @ VoynichError::Unauthorized)] pub enclave: Box<Account<'info, Enclave>>,
    /// CHECK: verified in handler (owner, PDA ["grant", model, enclave], discriminator, legacy 223B or 226B layout, reallocated to Grant::SPACE).
    #[account(mut, seeds = [b"grant", model.key().as_ref(), enclave.key().as_ref()], bump)] pub grant: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(nonce: u64, input_hash: [u8; 32], answer_mode: AnswerMode, callback: Option<CallbackSpec>)]
pub struct OpenCall<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    #[account(mut)] pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)] pub config: Account<'info, Config>,
    #[account(seeds = [b"model", model.name.as_bytes()], bump = model.bump)] pub model: Box<Account<'info, Model>>,
    #[account(seeds = [b"enclave", enclave.signing_key.as_ref()], bump = enclave.bump)] pub enclave: Box<Account<'info, Enclave>>,
    /// CHECK: verified against enclave and configured verifier.
    pub attestation_record: UncheckedAccount<'info>,
    /// CHECK: verified in handler (owner, PDA ["grant", model, enclave], discriminator, legacy 223B or 226B layout).
    #[account(seeds = [b"grant", model.key().as_ref(), enclave.key().as_ref()], bump)] pub grant: UncheckedAccount<'info>,
    #[account(init, payer = payer, space = Call::space(callback.as_ref().map(|c| c.accounts.len()).unwrap_or(0)), seeds = [b"call", caller.key().as_ref(), &nonce.to_le_bytes()], bump)] pub call: Box<Account<'info, Call>>,
    pub mint: Option<Account<'info, Mint>>,
    #[account(mut)] pub caller_tokens: Option<Account<'info, TokenAccount>>,
    /// CHECK: must be the call-owned associated token account; created and checked in money.rs.
    #[account(mut)] pub escrow_tokens: Option<UncheckedAccount<'info>>,
    pub token_program: Option<Program<'info, Token>>,
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(output_hash: [u8; 32], signature: [u8; 64], ed25519_instruction_index: u16, open_answer: Vec<u8>)]
pub struct SettleCall<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)] pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"model", model.name.as_bytes()], bump = model.bump)] pub model: Box<Account<'info, Model>>,
    #[account(mut, seeds = [b"enclave", enclave.signing_key.as_ref()], bump = enclave.bump)] pub enclave: Box<Account<'info, Enclave>>,
    /// CHECK: verified against enclave and configured verifier.
    pub attestation_record: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"call", call.caller.as_ref(), &call.nonce.to_le_bytes()], bump = call.bump, has_one = model, has_one = enclave)] pub call: Box<Account<'info, Call>>,
    #[account(init, payer = payer, space = Receipt::space(open_answer.len()), seeds = [b"receipt", call.key().as_ref()], bump)] pub receipt: Box<Account<'info, Receipt>>,
    /// CHECK: exact native recipient/caller key checked in handler.
    #[account(mut)] pub caller: UncheckedAccount<'info>,
    /// CHECK: exact owner recipient checked against call snapshot.
    #[account(mut)] pub owner: UncheckedAccount<'info>,
    /// CHECK: exact operator recipient checked against call snapshot.
    #[account(mut)] pub operator: UncheckedAccount<'info>,
    /// CHECK: exact protocol recipient checked against call snapshot.
    #[account(mut)] pub fee_recipient: UncheckedAccount<'info>,
    /// CHECK: fixed instructions sysvar, parsed by the Ed25519 verification helper.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)] pub instructions: UncheckedAccount<'info>,
    #[account(mut)] pub escrow_tokens: Option<Account<'info, TokenAccount>>,
    #[account(mut)] pub owner_tokens: Option<Account<'info, TokenAccount>>,
    #[account(mut)] pub operator_tokens: Option<Account<'info, TokenAccount>>,
    #[account(mut)] pub protocol_tokens: Option<Account<'info, TokenAccount>>,
    #[account(mut)] pub caller_tokens: Option<Account<'info, TokenAccount>>,
    pub token_program: Option<Program<'info, Token>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SettleMeteredCall<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)] pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"model", model.name.as_bytes()], bump = model.bump)] pub model: Box<Account<'info, Model>>,
    #[account(mut, seeds = [b"enclave", enclave.signing_key.as_ref()], bump = enclave.bump)] pub enclave: Box<Account<'info, Enclave>>,
    /// CHECK: verified against enclave and configured verifier.
    pub attestation_record: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"call", call.caller.as_ref(), &call.nonce.to_le_bytes()], bump = call.bump, has_one = model, has_one = enclave)] pub call: Box<Account<'info, Call>>,
    /// CHECK: canonical receipt PDA initialized manually to Receipt::METERED_SPACE (423B) in handler.
    #[account(mut, seeds = [b"receipt", call.key().as_ref()], bump)] pub receipt: UncheckedAccount<'info>,
    /// CHECK: exact native recipient/caller key checked in handler.
    #[account(mut)] pub caller: UncheckedAccount<'info>,
    /// CHECK: exact owner recipient checked against call snapshot.
    #[account(mut)] pub owner: UncheckedAccount<'info>,
    /// CHECK: exact operator recipient checked against call snapshot.
    #[account(mut)] pub operator: UncheckedAccount<'info>,
    /// CHECK: exact protocol recipient checked against call snapshot.
    #[account(mut)] pub fee_recipient: UncheckedAccount<'info>,
    /// CHECK: fixed instructions sysvar, parsed by the Ed25519 verification helper.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)] pub instructions: UncheckedAccount<'info>,
    #[account(mut)] pub escrow_tokens: Option<Account<'info, TokenAccount>>,
    #[account(mut)] pub owner_tokens: Option<Account<'info, TokenAccount>>,
    #[account(mut)] pub operator_tokens: Option<Account<'info, TokenAccount>>,
    #[account(mut)] pub protocol_tokens: Option<Account<'info, TokenAccount>>,
    #[account(mut)] pub caller_tokens: Option<Account<'info, TokenAccount>>,
    pub token_program: Option<Program<'info, Token>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RefundCall<'info> {
    pub actor: Signer<'info>,
    #[account(mut, seeds = [b"call", call.caller.as_ref(), &call.nonce.to_le_bytes()], bump = call.bump)] pub call: Box<Account<'info, Call>>,
    /// CHECK: exact original caller recipient checked in handler.
    #[account(mut)] pub caller: UncheckedAccount<'info>,
    #[account(mut)] pub escrow_tokens: Option<Account<'info, TokenAccount>>,
    #[account(mut)] pub caller_tokens: Option<Account<'info, TokenAccount>>,
    pub token_program: Option<Program<'info, Token>>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(digest: [u8; 48])]
pub struct PublishMeasurement<'info> {
    #[account(mut)] pub publisher: Signer<'info>,
    #[account(init, payer = publisher, space = Measurement::SPACE, seeds = [b"measurement", &digest[..32], &digest[32..]], bump)] pub measurement: Account<'info, Measurement>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct DeprecateMeasurement<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)] pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"measurement", &measurement.digest[..32], &measurement.digest[32..]], bump = measurement.bump, constraint = authority.key() == measurement.publisher || authority.key() == config.admin @ VoynichError::Unauthorized)] pub measurement: Account<'info, Measurement>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SetPolicy<'info> {
    #[account(mut)] pub owner: Signer<'info>,
    #[account(mut, seeds = [b"model", model.name.as_bytes()], bump = model.bump, has_one = owner @ VoynichError::Unauthorized)] pub model: Box<Account<'info, Model>>,
    #[account(init_if_needed, payer = owner, space = Policy::SPACE, seeds = [b"policy", model.key().as_ref()], bump)] pub policy: Box<Account<'info, Policy>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ClearPolicy<'info> {
    #[account(mut)] pub owner: Signer<'info>,
    #[account(mut, seeds = [b"model", model.name.as_bytes()], bump = model.bump, has_one = owner @ VoynichError::Unauthorized)] pub model: Box<Account<'info, Model>>,
    #[account(mut, close = owner, seeds = [b"policy", model.key().as_ref()], bump = policy.bump, has_one = model)] pub policy: Box<Account<'info, Policy>>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(version: u32, args: BeginVersionArgs)]
pub struct BeginVersion<'info> {
    #[account(mut)] pub owner: Signer<'info>,
    #[account(seeds = [b"model", model.name.as_bytes()], bump = model.bump, has_one = owner @ VoynichError::Unauthorized)] pub model: Box<Account<'info, Model>>,
    #[account(init, payer = owner, space = ModelVersion::SPACE, seeds = [b"version", model.key().as_ref(), &version.to_le_bytes()], bump)] pub model_version: Box<Account<'info, ModelVersion>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct WriteVersionWeights<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"model", model.name.as_bytes()], bump = model.bump, has_one = owner @ VoynichError::Unauthorized)] pub model: Box<Account<'info, Model>>,
    #[account(seeds = [b"version", model.key().as_ref(), &model_version.version.to_le_bytes()], bump = model_version.bump, has_one = model)] pub model_version: Box<Account<'info, ModelVersion>>,
    /// CHECK: fixed header, owner, model and writable payload are checked in weights.rs.
    #[account(mut)] pub weights: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SealVersionRange<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"model", model.name.as_bytes()], bump = model.bump, has_one = owner @ VoynichError::Unauthorized)] pub model: Box<Account<'info, Model>>,
    #[account(mut, seeds = [b"version", model.key().as_ref(), &model_version.version.to_le_bytes()], bump = model_version.bump, has_one = model)] pub model_version: Box<Account<'info, ModelVersion>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct PublishVersion<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"model", model.name.as_bytes()], bump = model.bump, has_one = owner @ VoynichError::Unauthorized)] pub model: Box<Account<'info, Model>>,
    #[account(mut, seeds = [b"version", model.key().as_ref(), &model_version.version.to_le_bytes()], bump = model_version.bump, has_one = model)] pub model_version: Box<Account<'info, ModelVersion>>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(args: OpenSessionArgs)]
pub struct OpenSession<'info> {
    #[account(mut)] pub caller: Signer<'info>,
    /// CHECK: delegate key receives optional gas lamports; no account data is read.
    #[account(mut)] pub delegate: UncheckedAccount<'info>,
    #[account(init, payer = caller, space = Session::SPACE, seeds = [b"session", caller.key().as_ref(), delegate.key().as_ref(), &args.nonce.to_le_bytes()], bump)] pub session: Box<Account<'info, Session>>,
    pub mint: Option<Account<'info, Mint>>,
    #[account(mut)] pub caller_tokens: Option<Account<'info, TokenAccount>>,
    /// CHECK: session-owned ATA for SPL budgets; created and verified in money.rs.
    #[account(mut)] pub session_escrow: Option<UncheckedAccount<'info>>,
    pub token_program: Option<Program<'info, Token>>,
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CloseSession<'info> {
    #[account(mut)] pub closer: Signer<'info>,
    #[account(mut, seeds = [b"session", session.caller.as_ref(), session.delegate.as_ref(), &session.nonce.to_le_bytes()], bump = session.bump)] pub session: Box<Account<'info, Session>>,
    /// CHECK: exact caller recipient verified against session.caller.
    #[account(mut)] pub caller: UncheckedAccount<'info>,
    #[account(mut)] pub session_escrow: Option<Account<'info, TokenAccount>>,
    #[account(mut)] pub caller_tokens: Option<Account<'info, TokenAccount>>,
    pub token_program: Option<Program<'info, Token>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(nonce: u64, input_hash: [u8; 32], answer_mode: AnswerMode, callback: Option<CallbackSpec>)]
pub struct OpenSessionCall<'info> {
    #[account(mut)] pub delegate: Signer<'info>,
    #[account(mut, seeds = [b"session", session.caller.as_ref(), session.delegate.as_ref(), &session.nonce.to_le_bytes()], bump = session.bump, has_one = delegate @ VoynichError::Unauthorized)] pub session: Box<Account<'info, Session>>,
    #[account(seeds = [b"config"], bump = config.bump)] pub config: Account<'info, Config>,
    #[account(seeds = [b"model", model.name.as_bytes()], bump = model.bump)] pub model: Box<Account<'info, Model>>,
    #[account(seeds = [b"enclave", enclave.signing_key.as_ref()], bump = enclave.bump)] pub enclave: Box<Account<'info, Enclave>>,
    /// CHECK: verified against enclave and configured verifier.
    pub attestation_record: UncheckedAccount<'info>,
    /// CHECK: verified in handler (owner, PDA ["grant", model, enclave], discriminator, legacy 223B or 226B layout).
    #[account(seeds = [b"grant", model.key().as_ref(), enclave.key().as_ref()], bump)] pub grant: UncheckedAccount<'info>,
    #[account(init, payer = delegate, space = Call::space(callback.as_ref().map(|c| c.accounts.len()).unwrap_or(0)), seeds = [b"call", session.caller.as_ref(), &nonce.to_le_bytes()], bump)] pub call: Box<Account<'info, Call>>,
    pub mint: Option<Account<'info, Mint>>,
    #[account(mut)] pub session_escrow: Option<Account<'info, TokenAccount>>,
    /// CHECK: must be the call-owned associated token account; created and checked in money.rs.
    #[account(mut)] pub escrow_tokens: Option<UncheckedAccount<'info>>,
    pub token_program: Option<Program<'info, Token>>,
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,
    pub system_program: Program<'info, System>,
}
