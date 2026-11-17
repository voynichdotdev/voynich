use anchor_lang::prelude::*;
use crate::state::{AnswerMode, CallStatus, CallbackAccount, ConfigArgs, MeasurementStatus, ModelBase, ModelStatus, PriceUnit};

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
