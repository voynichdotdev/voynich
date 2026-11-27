use anchor_lang::prelude::*;
use crate::state::{AnswerMode, BatchStatus, CallStatus, CallbackAccount, ConfigArgs, MeasurementStatus, ModelBase, ModelStatus, PassStatus, PriceUnit, QuorumStatus, SessionStatus, SplitRecipient};

#[event]
pub struct ConfigChanged { pub admin: Pubkey, pub config: ConfigArgs }
#[event]
pub struct ModelCreated {
    pub model: Pubkey, pub owner: Pubkey, pub name: String, pub manifest: Vec<u8>, pub weights: Vec<Pubkey>,
    pub size_bytes: u64, pub cipher: String, pub nonce_prefix: [u8; 16], pub allowed_measurements: Vec<[u8;48]>,
    pub price: u64, pub price_mint: Pubkey, pub operator_share_bps: u16, pub upload_key: Pubkey, pub slot: u64,
    pub upload_keys: Vec<Pubkey>, pub hash_version: u8, pub base: Option<ModelBase>, pub price_unit: PriceUnit,
}
#[event]
pub struct WeightsAttached { pub model: Pubkey, pub weights: Vec<Pubkey> }
#[event]
pub struct RangeSealed { pub model: Pubkey, pub start_chunk: u32, pub chunk_count: u32, pub sealed_chunks: u32 }
#[event]
pub struct WeightsWritten { pub model: Pubkey, pub weights: Pubkey, pub offset: u32, pub length: u32, pub written_bytes: u32 }
#[event]
pub struct ModelSealed { pub model: Pubkey, pub ciphertext_sha256: [u8;32], pub slot: u64, pub base_sha256: Option<[u8; 32]> }
#[event]
pub struct ModelPriceChanged { pub model: Pubkey, pub price: u64, pub price_mint: Pubkey, pub operator_share_bps: u16, pub price_unit: PriceUnit }
#[event]
pub struct ModelStatusChanged { pub model: Pubkey, pub status: ModelStatus }
#[event]
pub struct ModelAllowedMeasurementsChanged { pub model: Pubkey, pub allowed_measurements: Vec<[u8; 48]> }
#[event]
pub struct EnclaveChanged { pub enclave: Pubkey, pub signing_key: Pubkey, pub encryption_key: [u8;32], pub operator: Pubkey, pub endpoint: String, pub record: Pubkey, pub hardware_type: u8, pub measurement: [u8;48], pub recorded_slot: u64, pub expires_at_slot: u64 }
#[event]
pub struct GrantChanged { pub grant: Pubkey, pub model: Pubkey, pub enclave: Pubkey, pub wrapped_key: Vec<u8>, pub granted_by: Pubkey, pub slot: u64, pub revoked: bool }
#[event]
pub struct CallOpened { pub call: Pubkey, pub caller: Pubkey, pub model: Pubkey, pub enclave: Pubkey, pub nonce: u64, pub input_hash: [u8;32], pub price: u64, pub price_mint: Pubkey, pub owner: Pubkey, pub operator: Pubkey, pub fee_recipient: Pubkey, pub operator_share_bps: u16, pub protocol_share_bps: u16, pub opened_slot: u64, pub deadline_slot: u64, pub answer_mode: AnswerMode, pub caller_is_program: bool, pub callback_program: Pubkey, pub callback_accounts: Vec<CallbackAccount>, pub price_unit: PriceUnit, pub ceiling: u64 }
#[event]
pub struct CallSettled { pub call: Pubkey, pub receipt: Pubkey, pub model: Pubkey, pub enclave: Pubkey, pub input_hash: [u8;32], pub output_hash: [u8;32], pub signature: [u8;64], pub slot: u64, pub price_mint: Pubkey, pub total: u64, pub owner: Pubkey, pub operator: Pubkey, pub fee_recipient: Pubkey, pub owner_amount: u64, pub operator_amount: u64, pub protocol_amount: u64, pub answer_mode: AnswerMode, pub open_answer: Vec<u8>, pub caller_is_program: bool, pub delivered_count: Option<u64>, pub returned_amount: Option<u64> }
#[event]
pub struct CallRefunded { pub call: Pubkey, pub caller: Pubkey, pub price_mint: Pubkey, pub amount: u64, pub slot: u64, pub status: CallStatus }
#[event]
pub struct MeasurementPublished { pub measurement: Pubkey, pub digest: [u8; 48], pub publisher: Pubkey, pub source_repo: String, pub commit_sha: String, pub recipe_hash: [u8; 32], pub version: String, pub created_slot: u64, pub status: MeasurementStatus }
#[event]
pub struct MeasurementDeprecated { pub measurement: Pubkey, pub digest: [u8; 48], pub authority: Pubkey, pub slot: u64, pub status: MeasurementStatus }
#[event]
pub struct PolicyUpdated { pub policy: Pubkey, pub model: Pubkey, pub allow_list_enabled: bool, pub allowed_callers: Vec<Pubkey>, pub max_calls_per_caller_per_window: u32, pub window_slots: u64, pub allowed_operators: Vec<Pubkey>, pub allowed_regions: Vec<String>, pub updated_slot: u64 }
#[event]
pub struct PolicyCleared { pub policy: Pubkey, pub model: Pubkey, pub slot: u64 }
#[event]
pub struct GrantQuoteUpdated { pub model: Pubkey, pub enclave: Pubkey, pub operator: Pubkey, pub quoted_operator_share_bps: Option<u16>, pub slot: u64 }
#[event]
pub struct ModelVersionStarted { pub model: Pubkey, pub model_version: Pubkey, pub version: u32, pub weights: Vec<Pubkey>, pub size_bytes: u64, pub nonce_prefix: [u8; 16], pub manifest: Vec<u8>, pub base: Option<ModelBase>, pub slot: u64 }
#[event]
pub struct ModelVersionPublished {
    pub model: Pubkey, pub model_version: Pubkey, pub version: u32,
    pub previous_version: u32, pub previous_ciphertext_sha256: [u8; 32], pub previous_size_bytes: u64, pub previous_sealed_slot: u64, pub previous_base: Option<ModelBase>,
    pub weights: Vec<Pubkey>, pub size_bytes: u64, pub nonce_prefix: [u8; 16], pub ciphertext_sha256: [u8; 32], pub manifest: Vec<u8>, pub base: Option<ModelBase>, pub published_slot: u64,
}
#[event]
pub struct SessionOpened {
    pub session: Pubkey, pub caller: Pubkey, pub delegate: Pubkey, pub nonce: u64,
    pub mint: Pubkey, pub model: Pubkey, pub budget: u64, pub opened_slot: u64, pub expires_at_slot: u64,
}
#[event]
pub struct SessionDebited {
    pub session: Pubkey, pub caller: Pubkey, pub delegate: Pubkey, pub call: Pubkey, pub model: Pubkey,
    pub amount: u64, pub spent: u64, pub calls_opened: u64, pub slot: u64,
}
#[event]
pub struct SessionClosed {
    pub session: Pubkey, pub caller: Pubkey, pub delegate: Pubkey, pub closer: Pubkey,
    pub returned_amount: u64, pub spent: u64, pub calls_opened: u64, pub slot: u64, pub status: SessionStatus,
}
#[event]
pub struct SplitUpdated {
    pub split: Pubkey, pub model: Pubkey, pub authority: Pubkey, pub mint: Pubkey,
    pub active: bool, pub recipients: Vec<SplitRecipient>, pub updated_slot: u64,
}
#[event]
pub struct SplitCredited {
    pub split: Pubkey, pub model: Pubkey, pub call: Pubkey, pub receipt: Pubkey,
    pub mint: Pubkey, pub amount: u64, pub total_received: u64, pub recipients: Vec<SplitRecipient>, pub slot: u64,
}
#[event]
pub struct SplitClaimed {
    pub split: Pubkey, pub model: Pubkey, pub recipient: Pubkey, pub mint: Pubkey,
    pub amount: u64, pub total_claimed: u64, pub slot: u64,
}
#[event]
pub struct BondDeposited {
    pub bond: Pubkey, pub enclave: Pubkey, pub operator: Pubkey,
    pub amount: u64, pub bonded_lamports: u64, pub slash_bps: u16, pub slot: u64,
}
#[event]
pub struct BondWithdrawn {
    pub bond: Pubkey, pub enclave: Pubkey, pub operator: Pubkey,
    pub amount: u64, pub bonded_lamports: u64, pub slot: u64,
}
#[event]
pub struct BondSlashed {
    pub bond: Pubkey, pub enclave: Pubkey, pub operator: Pubkey, pub call: Pubkey, pub caller: Pubkey,
    pub amount: u64, pub bonded_lamports: u64, pub slashed_total: u64, pub missed_calls: u64, pub slot: u64,
}
#[event]
pub struct BenchmarkPublished {
    pub benchmark: Pubkey, pub model: Pubkey, pub publisher: Pubkey, pub name: String,
    pub model_version: u32, pub dataset_sha256: [u8; 32], pub dataset_uri: String,
    pub sample_count: u32, pub passed_count: u32, pub score_bps: u16,
    pub receipts: Vec<Pubkey>, pub published_slot: u64,
}
#[event]
pub struct PassPlanUpdated {
    pub pass_plan: Pubkey, pub model: Pubkey, pub authority: Pubkey, pub mint: Pubkey,
    pub price_per_call: u64, pub min_calls: u32, pub max_calls: u32, pub ttl_slots: u64,
    pub active: bool, pub updated_slot: u64,
}
#[event]
pub struct PassPurchased {
    pub pass: Pubkey, pub model: Pubkey, pub holder: Pubkey, pub nonce: u64, pub mint: Pubkey,
    pub price_per_call: u64, pub calls_total: u32, pub escrow_remaining: u64,
    pub purchased_slot: u64, pub expires_at_slot: u64,
}
#[event]
pub struct PassUsed {
    pub pass: Pubkey, pub model: Pubkey, pub holder: Pubkey, pub call: Pubkey,
    pub amount: u64, pub calls_used: u32, pub calls_total: u32, pub escrow_remaining: u64,
    pub slot: u64,
}
#[event]
pub struct PassClosed {
    pub pass: Pubkey, pub model: Pubkey, pub holder: Pubkey, pub closer: Pubkey,
    pub returned_amount: u64, pub calls_used: u32, pub calls_total: u32,
    pub slot: u64, pub status: PassStatus,
}
#[event]
pub struct ReferralConfigUpdated {
    pub referral_config: Pubkey, pub model: Pubkey, pub share_bps: u16,
    pub active: bool, pub updated_slot: u64,
}
#[event]
pub struct CallReferralRegistered {
    pub call_referral: Pubkey, pub referral: Pubkey, pub call: Pubkey,
    pub model: Pubkey, pub referrer: Pubkey, pub share_bps: u16, pub slot: u64,
}
#[event]
pub struct ReferralCredited {
    pub referral: Pubkey, pub call_referral: Pubkey, pub model: Pubkey, pub call: Pubkey,
    pub receipt: Pubkey, pub referrer: Pubkey, pub mint: Pubkey,
    pub amount: u64, pub total_earned: u64, pub calls_referred: u64, pub slot: u64,
}
#[event]
pub struct ReferralClaimed {
    pub referral: Pubkey, pub model: Pubkey, pub referrer: Pubkey, pub mint: Pubkey,
    pub amount: u64, pub total_claimed: u64, pub slot: u64,
}
#[event]
pub struct QuorumOpened {
    pub quorum: Pubkey, pub model: Pubkey, pub caller: Pubkey, pub nonce: u64,
    pub input_hash: [u8; 32], pub required_votes: u8, pub require_distinct_enclaves: bool,
    pub created_slot: u64,
}
#[event]
pub struct QuorumAgreed {
    pub quorum: Pubkey, pub model: Pubkey, pub caller: Pubkey, pub input_hash: [u8; 32],
    pub agreed_output_hash: [u8; 32], pub vote_count: u8, pub distinct_enclaves: u8,
    pub receipts: [Pubkey; 5], pub finalized_slot: u64, pub status: QuorumStatus,
}
#[event]
pub struct BatchOpened {
    pub batch: Pubkey, pub model: Pubkey, pub caller: Pubkey, pub nonce: u64,
    pub manifest_hash: [u8; 32], pub total_count: u16, pub created_slot: u64,
}
#[event]
pub struct BatchReceiptsAppended {
    pub batch: Pubkey, pub model: Pubkey, pub receipts: Vec<Pubkey>,
    pub completed_count: u16, pub total_count: u16, pub receipts_root: [u8; 32],
    pub slot: u64,
}
#[event]
pub struct BatchCompleted {
    pub batch: Pubkey, pub model: Pubkey, pub caller: Pubkey,
    pub completed_count: u16, pub total_count: u16, pub receipts_root: [u8; 32],
    pub completed_slot: u64, pub status: BatchStatus,
}
