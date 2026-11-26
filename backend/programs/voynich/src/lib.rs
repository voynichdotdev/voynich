use anchor_lang::prelude::*;
pub mod attestation;
pub mod contexts;
pub mod errors;
pub mod events;
pub mod handlers;
pub mod money;
pub mod state;
pub mod weights;
pub mod ed25519 { include!("../../shared/ed25519.rs"); }

use contexts::*;
use state::*;
declare_id!("65H3C7T6C2DmbkR9ssBBmNtqpybWcYwotkkETL4E7RSS");

#[program]
pub mod voynich {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>, args: ConfigArgs) -> Result<()> { handlers::initialize(ctx, args) }
    pub fn set_config(ctx: Context<SetConfig>, args: ConfigArgs) -> Result<()> { handlers::set_config(ctx, args) }
    pub fn migrate_config(ctx: Context<MigrateConfig>, max_open_answer_bytes: u16) -> Result<()> { handlers::migrate_config(ctx, max_open_answer_bytes) }
    pub fn migrate_model(ctx: Context<MigrateModel>) -> Result<()> { handlers::migrate_model(ctx) }
    pub fn create_model<'info>(ctx: Context<'_, '_, 'info, 'info, CreateModel<'info>>, args: CreateModelArgs) -> Result<()> { handlers::create_model(ctx, args) }
    pub fn attach_weights<'info>(ctx: Context<'_, '_, '_, 'info, AttachWeights<'info>>) -> Result<()> { handlers::attach_weights(ctx) }
    pub fn write_weights(ctx: Context<WriteWeights>, offset: u32, bytes: Vec<u8>) -> Result<()> { handlers::write_weights(ctx, offset, bytes) }
    pub fn seal_range<'info>(ctx: Context<'_, '_, '_, 'info, SealRange<'info>>, chunk_count: u32) -> Result<()> { handlers::seal_range(ctx, chunk_count) }
    pub fn seal_model<'info>(ctx: Context<'_, '_, '_, 'info, SealModel<'info>>, ciphertext_sha256: [u8;32]) -> Result<()> { handlers::seal_model(ctx, ciphertext_sha256) }
    pub fn set_price(ctx: Context<ModelOwner>, price: u64, price_mint: Pubkey, operator_share_bps: u16, price_unit: PriceUnit) -> Result<()> { handlers::set_price(ctx, price, price_mint, operator_share_bps, price_unit) }
    pub fn retire_model(ctx: Context<ModelOwner>) -> Result<()> { handlers::retire_model(ctx) }
    pub fn set_allowed_measurements(ctx: Context<ModelOwner>, allowed_measurements: Vec<[u8; 48]>) -> Result<()> { handlers::set_allowed_measurements(ctx, allowed_measurements) }
    pub fn register_enclave(ctx: Context<RegisterEnclave>, encryption_key: [u8;32], endpoint: String) -> Result<()> { handlers::register_enclave(ctx, encryption_key, endpoint) }
    pub fn refresh_enclave(ctx: Context<RefreshEnclave>, endpoint: String) -> Result<()> { handlers::refresh_enclave(ctx, endpoint) }
    pub fn grant_by_owner(ctx: Context<GrantByOwner>, wrapped_key: Vec<u8>) -> Result<()> { handlers::grant_by_owner(ctx, wrapped_key) }
    pub fn grant_by_enclave(ctx: Context<GrantByEnclave>, wrapped_key: Vec<u8>) -> Result<()> { handlers::grant_by_enclave(ctx, wrapped_key) }
    pub fn revoke_grant(ctx: Context<RevokeGrant>) -> Result<()> { handlers::revoke_grant(ctx) }
    pub fn set_quote(ctx: Context<SetQuote>, operator_share_bps: Option<u16>) -> Result<()> { handlers::set_quote(ctx, operator_share_bps) }
    pub fn open_call(ctx: Context<OpenCall>, nonce: u64, input_hash: [u8;32], answer_mode: AnswerMode, callback: Option<CallbackSpec>) -> Result<()> { handlers::open_call(ctx, nonce, input_hash, answer_mode, callback) }
    pub fn open_metered_call(ctx: Context<OpenCall>, nonce: u64, input_hash: [u8;32], answer_mode: AnswerMode, callback: Option<CallbackSpec>, ceiling: u64) -> Result<()> { handlers::open_metered_call(ctx, nonce, input_hash, answer_mode, callback, ceiling) }
    pub fn settle_call<'info>(ctx: Context<'_, '_, 'info, 'info, SettleCall<'info>>, output_hash: [u8;32], signature: [u8;64], ed25519_instruction_index: u16, open_answer: Vec<u8>) -> Result<()> { handlers::settle_call(ctx, output_hash, signature, ed25519_instruction_index, open_answer) }
    pub fn settle_metered_call<'info>(ctx: Context<'_, '_, 'info, 'info, SettleMeteredCall<'info>>, count: u64, running_hash: [u8;32], signature: [u8;64], ed25519_instruction_index: u16) -> Result<()> { handlers::settle_metered_call(ctx, count, running_hash, signature, ed25519_instruction_index) }
    pub fn refund_call<'info>(ctx: Context<'_, '_, 'info, 'info, RefundCall<'info>>) -> Result<()> { handlers::refund_call(ctx) }
    pub fn publish_measurement(ctx: Context<PublishMeasurement>, digest: [u8; 48], source_repo: String, commit_sha: String, recipe_hash: [u8; 32], version: String) -> Result<()> { handlers::publish_measurement(ctx, digest, source_repo, commit_sha, recipe_hash, version) }
    pub fn deprecate_measurement(ctx: Context<DeprecateMeasurement>) -> Result<()> { handlers::deprecate_measurement(ctx) }
    pub fn set_policy(ctx: Context<SetPolicy>, args: PolicyArgs) -> Result<()> { handlers::set_policy(ctx, args) }
    pub fn clear_policy(ctx: Context<ClearPolicy>) -> Result<()> { handlers::clear_policy(ctx) }
    pub fn begin_version<'info>(ctx: Context<'_, '_, '_, 'info, BeginVersion<'info>>, version: u32, args: BeginVersionArgs) -> Result<()> { handlers::begin_version(ctx, version, args) }
    pub fn write_version_weights(ctx: Context<WriteVersionWeights>, offset: u32, bytes: Vec<u8>) -> Result<()> { handlers::write_version_weights(ctx, offset, bytes) }
    pub fn seal_version_range<'info>(ctx: Context<'_, '_, '_, 'info, SealVersionRange<'info>>, chunk_count: u32) -> Result<()> { handlers::seal_version_range(ctx, chunk_count) }
    pub fn publish_version<'info>(ctx: Context<'_, '_, '_, 'info, PublishVersion<'info>>, ciphertext_sha256: [u8; 32]) -> Result<()> { handlers::publish_version(ctx, ciphertext_sha256) }
    pub fn open_session(ctx: Context<OpenSession>, args: OpenSessionArgs) -> Result<()> { handlers::open_session(ctx, args) }
    pub fn close_session(ctx: Context<CloseSession>) -> Result<()> { handlers::close_session(ctx) }
    pub fn open_session_call(ctx: Context<OpenSessionCall>, nonce: u64, input_hash: [u8; 32], answer_mode: AnswerMode, callback: Option<CallbackSpec>) -> Result<()> { handlers::open_session_call(ctx, nonce, input_hash, answer_mode, callback) }
    pub fn open_session_metered_call(ctx: Context<OpenSessionCall>, nonce: u64, input_hash: [u8; 32], answer_mode: AnswerMode, callback: Option<CallbackSpec>, ceiling: u64) -> Result<()> { handlers::open_session_metered_call(ctx, nonce, input_hash, answer_mode, callback, ceiling) }
    pub fn set_split(ctx: Context<SetSplit>, recipients: Vec<SplitRecipientInput>) -> Result<()> { handlers::set_split(ctx, recipients) }
    pub fn claim_split(ctx: Context<ClaimSplit>) -> Result<()> { handlers::claim_split(ctx) }
    pub fn deposit_bond(ctx: Context<DepositBond>, amount_lamports: u64) -> Result<()> { handlers::deposit_bond(ctx, amount_lamports) }
    pub fn withdraw_bond(ctx: Context<WithdrawBond>, amount_lamports: u64) -> Result<()> { handlers::withdraw_bond(ctx, amount_lamports) }
    pub fn publish_benchmark<'info>(ctx: Context<'_, '_, 'info, 'info, PublishBenchmark<'info>>, args: PublishBenchmarkArgs) -> Result<()> { handlers::publish_benchmark(ctx, args) }
    pub fn set_pass_plan(ctx: Context<SetPassPlan>, args: SetPassPlanArgs) -> Result<()> { handlers::set_pass_plan(ctx, args) }
    pub fn buy_pass(ctx: Context<BuyPass>, nonce: u64, calls_total: u32) -> Result<()> { handlers::buy_pass(ctx, nonce, calls_total) }
    pub fn open_pass_call(ctx: Context<OpenPassCall>, nonce: u64, input_hash: [u8; 32], answer_mode: AnswerMode, callback: Option<CallbackSpec>) -> Result<()> { handlers::open_pass_call(ctx, nonce, input_hash, answer_mode, callback) }
    pub fn close_pass(ctx: Context<ClosePass>) -> Result<()> { handlers::close_pass(ctx) }
}
