use anchor_lang::prelude::*;

pub const MAX_WEIGHTS: usize = 64;
pub const MAX_UPLOAD_KEYS: usize = 8;
pub const MAX_MEASUREMENTS: usize = 8;
pub const MAX_MANIFEST: usize = 4096;
pub const MAX_ENDPOINT: usize = 256;
pub const MAX_OPEN_ANSWER_BYTES_LIMIT: u16 = 4096;
pub const MAX_CALLBACK_ACCOUNTS: usize = 8;
pub const MAX_MERKLE_LEVELS: usize = 20;
pub const CIPHER_CHUNK_BYTES: usize = 65_536 + 16;
pub const MAX_SEAL_RANGE_CHUNKS: u32 = 8;
pub const MAX_BASE_FORMAT: usize = 32;
pub const MAX_BASE_SOURCE: usize = 256;
pub const MAX_SOURCE_REPO: usize = 128;
pub const MAX_COMMIT_SHA: usize = 64;
pub const MAX_MEASUREMENT_VERSION: usize = 32;
pub const MAX_POLICY_CALLERS: usize = 32;
pub const MAX_POLICY_OPERATORS: usize = 16;
pub const MAX_POLICY_REGIONS: usize = 8;
pub const MAX_POLICY_REGION_LEN: usize = 16;
pub const ON_RECEIPT_DISCRIMINATOR: [u8; 8] = [147, 219, 81, 58, 69, 119, 225, 93];
pub const CIPHER: &str = "xchacha20poly1305-64k-v1";
pub const WEIGHTS_HEADER: usize = 56;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AnswerMode { Sealed, Open }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PriceUnit { Call, Token }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub struct CallbackAccount {
    pub pubkey: Pubkey,
    pub is_writable: bool,
}
impl CallbackAccount {
    pub const SPACE: usize = 32 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub struct CallbackSpec {
    pub program: Pubkey,
    pub accounts: Vec<CallbackAccount>,
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub attestation_program: Pubkey,
    pub record_layout_version: u8,
    pub fee_recipient: Pubkey,
    pub protocol_share_bps: u16,
    pub call_deadline_slots: u64,
    pub bump: u8,
    pub max_open_answer_bytes: u16,
}
impl Config {
    pub const LEGACY_SPACE: usize = 8 + 32 * 3 + 1 + 2 + 8 + 1;
    pub const SPACE: usize = Self::LEGACY_SPACE + 2;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ModelStatus { Uploading, Sealed, Live, Retired }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub struct ModelBase {
    pub sha256: [u8; 32],
    pub size_bytes: u64,
    pub format: String,
    pub source: String,
}
impl ModelBase {
    pub fn is_valid(&self) -> bool {
        self.sha256 != [0u8; 32]
            && self.size_bytes > 0
            && matches!(self.format.as_str(), "onnx" | "safetensors" | "gguf")
            && self.format.len() <= MAX_BASE_FORMAT
            && !self.source.is_empty()
            && self.source.len() <= MAX_BASE_SOURCE
            && !self.source.bytes().any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
            && (self.source.starts_with("https://")
                || self.source.starts_with("http://")
                || self.source.starts_with("ipfs://")
                || self.source.starts_with("hf://"))
    }
}

#[account]
pub struct Model {
    pub owner: Pubkey,
    pub name: String,
    pub manifest: Vec<u8>,
    pub weights: Vec<Pubkey>,
    pub size_bytes: u64,
    pub cipher: String,
    pub nonce_prefix: [u8; 16],
    pub ciphertext_sha256: [u8; 32],
    pub allowed_measurements: Vec<[u8; 48]>,
    pub price: u64,
    /// Pubkey::default() denotes native SOL.
    pub price_mint: Pubkey,
    pub operator_share_bps: u16,
    pub upload_key: Pubkey,
    pub status: ModelStatus,
    pub created_slot: u64,
    pub sealed_slot: u64,
    pub calls_settled: u64,
    pub bump: u8,
    pub upload_keys: Vec<Pubkey>,
    pub hash_version: u8,
    pub sealed_chunks: u32,
    pub merkle_frontier: Vec<[u8; 32]>,
    pub merkle_frontier_mask: u32,
    pub base: Option<ModelBase>,
    pub price_unit: PriceUnit,
    pub has_policy: bool,
    pub current_version: u32,
    pub has_split: bool,
}
impl Model {
    pub const SPACE: usize = 8192;
    pub fn is_upload_key(&self, key: &Pubkey) -> bool {
        (self.upload_key != Pubkey::default() && self.upload_key == *key) || self.upload_keys.contains(key)
    }
    pub fn effective_version(&self) -> u32 {
        self.current_version.max(1)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum VersionStatus { Uploading, Live, Archived }

#[account]
pub struct ModelVersion {
    pub model: Pubkey,
    pub version: u32,
    pub status: VersionStatus,
    pub weights: Vec<Pubkey>,
    pub size_bytes: u64,
    pub nonce_prefix: [u8; 16],
    pub ciphertext_sha256: [u8; 32],
    pub manifest: Vec<u8>,
    pub base: Option<ModelBase>,
    pub hash_version: u8,
    pub sealed_chunks: u32,
    pub merkle_frontier: Vec<[u8; 32]>,
    pub merkle_frontier_mask: u32,
    pub published_slot: u64,
    pub bump: u8,
}
impl ModelVersion {
    pub const SPACE: usize = 8192;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BeginVersionArgs {
    pub manifest: Vec<u8>,
    pub size_bytes: u64,
    pub nonce_prefix: [u8; 16],
    pub base: Option<ModelBase>,
}

/// A fixed 56-byte header followed by exactly size_bytes bytes of ciphertext.
/// Clients create this rent-exempt, program-owned account before create_model.
#[account]
pub struct Weights {
    pub model: Pubkey,
    pub index: u32,
    pub size_bytes: u32,
    pub written_bytes: u32,
    pub reserved: u32,
}

#[account]
pub struct Enclave {
    pub signing_key: Pubkey,
    pub encryption_key: [u8; 32],
    pub operator: Pubkey,
    pub endpoint: String,
    pub attestation_record: Pubkey,
    pub hardware_type: u8,
    pub measurement: [u8; 48],
    pub recorded_slot: u64,
    pub expires_at_slot: u64,
    pub calls_settled: u64,
    pub bump: u8,
}
impl Enclave { pub const SPACE: usize = 8 + 32 * 4 + 4 + MAX_ENDPOINT + 1 + 48 + 8 * 3 + 1; }

#[account]
pub struct Grant {
    pub model: Pubkey,
    pub enclave: Pubkey,
    pub wrapped_key: Vec<u8>,
    pub granted_by: Pubkey,
    pub granted_slot: u64,
    pub revoked: bool,
    pub bump: u8,
    pub quoted_operator_share_bps: Option<u16>,
}
impl Grant {
    pub const BASE_SPACE: usize = 8 + 32 * 3 + 4 + 105 + 8 + 1 + 1;
    pub const SPACE: usize = Self::BASE_SPACE + 1 + 2;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CallStatus { Open, Settled, Refunded }

#[account]
pub struct Call {
    pub caller: Pubkey,
    pub model: Pubkey,
    pub enclave: Pubkey,
    pub nonce: u64,
    pub input_hash: [u8; 32],
    pub price: u64,
    pub price_mint: Pubkey,
    pub owner: Pubkey,
    pub operator: Pubkey,
    pub fee_recipient: Pubkey,
    pub operator_share_bps: u16,
    pub protocol_share_bps: u16,
    pub opened_slot: u64,
    pub deadline_slot: u64,
    pub status: CallStatus,
    pub bump: u8,
    pub answer_mode: AnswerMode,
    pub caller_is_program: bool,
    pub callback_program: Pubkey,
    pub callback_accounts: Vec<CallbackAccount>,
    pub price_unit: PriceUnit,
    pub ceiling: u64,
}
impl Call {
    pub const BASE_SPACE: usize = 8 + 32 * 8 + 8 * 4 + 2 * 2 + 1 + 1 + 1 + 1;
    pub const SPACE: usize = Self::BASE_SPACE + 32 + 4 + 1 + 8;
    pub fn space(callback_accounts_len: usize) -> usize {
        Self::SPACE + CallbackAccount::SPACE * callback_accounts_len
    }
    pub fn escrow_amount(&self) -> u64 {
        match self.price_unit {
            PriceUnit::Call => self.price,
            PriceUnit::Token => self.ceiling,
        }
    }
}

#[account]
pub struct Receipt {
    pub call: Pubkey,
    pub model: Pubkey,
    pub enclave: Pubkey,
    pub input_hash: [u8; 32],
    pub output_hash: [u8; 32],
    pub signature: [u8; 64],
    pub slot: u64,
    pub price_mint: Pubkey,
    pub total: u64,
    pub owner: Pubkey,
    pub operator: Pubkey,
    pub fee_recipient: Pubkey,
    pub owner_amount: u64,
    pub operator_amount: u64,
    pub protocol_amount: u64,
    pub bump: u8,
    pub answer_mode: AnswerMode,
    pub open_answer: Vec<u8>,
    pub caller_is_program: bool,
}
impl Receipt {
    pub const BASE_SPACE: usize = 8 + 32 * 9 + 64 + 8 * 5 + 1;
    pub const METERED_EXTENSION: usize = 16;
    pub const METERED_SPACE: usize = Self::BASE_SPACE + 1 + 4 + 1 + Self::METERED_EXTENSION;
    pub fn space(open_answer_len: usize) -> usize { Self::BASE_SPACE + 1 + 4 + open_answer_len + 1 }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum MeasurementStatus { Active, Deprecated }

#[account]
pub struct Measurement {
    pub digest: [u8; 48],
    pub publisher: Pubkey,
    pub source_repo: String,
    pub commit_sha: String,
    pub recipe_hash: [u8; 32],
    pub version: String,
    pub created_slot: u64,
    pub status: MeasurementStatus,
    pub bump: u8,
}
impl Measurement {
    pub const SPACE: usize = 8 + 48 + 32 + (4 + MAX_SOURCE_REPO) + (4 + MAX_COMMIT_SHA) + 32 + (4 + MAX_MEASUREMENT_VERSION) + 8 + 1 + 1;
}

#[account]
pub struct Policy {
    pub model: Pubkey,
    pub allow_list_enabled: bool,
    pub allowed_callers: Vec<Pubkey>,
    pub max_calls_per_caller_per_window: u32,
    pub window_slots: u64,
    pub allowed_operators: Vec<Pubkey>,
    pub allowed_regions: Vec<String>,
    pub updated_slot: u64,
    pub bump: u8,
}
impl Policy {
    pub const SPACE: usize = 8 + 32 + 1
        + (4 + 32 * MAX_POLICY_CALLERS)
        + 4 + 8
        + (4 + 32 * MAX_POLICY_OPERATORS)
        + (4 + MAX_POLICY_REGIONS * (4 + MAX_POLICY_REGION_LEN))
        + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PolicyArgs {
    pub allow_list_enabled: bool,
    pub allowed_callers: Vec<Pubkey>,
    pub max_calls_per_caller_per_window: u32,
    pub window_slots: u64,
    pub allowed_operators: Vec<Pubkey>,
    pub allowed_regions: Vec<String>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigArgs {
    pub attestation_program: Pubkey,
    pub record_layout_version: u8,
    pub fee_recipient: Pubkey,
    pub protocol_share_bps: u16,
    pub call_deadline_slots: u64,
    pub max_open_answer_bytes: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateModelArgs {
    pub name: String,
    pub manifest: Vec<u8>,
    pub size_bytes: u64,
    pub cipher: String,
    pub nonce_prefix: [u8; 16],
    pub allowed_measurements: Vec<[u8; 48]>,
    pub price: u64,
    pub price_mint: Pubkey,
    pub operator_share_bps: u16,
    pub upload_funding_lamports: u64,
    pub extra_upload_key_count: u8,
    pub base: Option<ModelBase>,
    pub price_unit: PriceUnit,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum SessionStatus { Open, Closed }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OpenSessionArgs {
    pub delegate: Pubkey,
    pub nonce: u64,
    pub mint: Pubkey,
    pub model: Pubkey,
    pub budget: u64,
    pub expires_at_slot: u64,
    pub delegate_gas_lamports: u64,
}

#[account]
pub struct Session {
    pub caller: Pubkey,
    pub delegate: Pubkey,
    pub nonce: u64,
    pub mint: Pubkey,
    pub model: Pubkey,
    pub budget: u64,
    pub spent: u64,
    pub calls_opened: u64,
    pub opened_slot: u64,
    pub expires_at_slot: u64,
    pub status: SessionStatus,
    pub bump: u8,
}
impl Session {
    pub const SPACE: usize = 8 + 32 * 4 + 8 * 6 + 1 + 1;
}

pub const MAX_SPLIT_RECIPIENTS: usize = 8;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct SplitRecipientInput {
    pub wallet: Pubkey,
    pub share_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct SplitRecipient {
    pub wallet: Pubkey,
    pub share_bps: u16,
    pub accrued: u64,
    pub claimed: u64,
}
impl SplitRecipient {
    pub const SPACE: usize = 32 + 2 + 8 + 8;
}

#[account]
pub struct Split {
    pub model: Pubkey,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub active: bool,
    pub total_received: u64,
    pub updated_slot: u64,
    pub recipients: Vec<SplitRecipient>,
    pub bump: u8,
}
impl Split {
    pub const SPACE: usize = 8 + 32 * 3 + 1 + 8 + 8 + (4 + SplitRecipient::SPACE * MAX_SPLIT_RECIPIENTS) + 1;
}

pub const DEFAULT_BOND_SLASH_BPS: u16 = 1000;
pub const SPL_BOND_SLASH_LAMPORTS: u64 = 1_000_000;

#[account]
pub struct Bond {
    pub enclave: Pubkey,
    pub operator: Pubkey,
    pub bonded_lamports: u64,
    pub slashed_total: u64,
    pub missed_calls: u64,
    pub slash_bps: u16,
    pub updated_slot: u64,
    pub bump: u8,
}
impl Bond {
    pub const SPACE: usize = 8 + 32 * 2 + 8 * 4 + 2 + 1;
}

pub const MAX_BENCHMARK_NAME: usize = 32;
pub const MAX_BENCHMARK_URI: usize = 160;
pub const MAX_BENCHMARK_RECEIPTS: usize = 16;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PublishBenchmarkArgs {
    pub name: String,
    pub dataset_sha256: [u8; 32],
    pub dataset_uri: String,
    pub sample_count: u32,
    pub passed_count: u32,
    pub score_bps: u16,
    pub receipts: Vec<Pubkey>,
}

#[account]
pub struct Benchmark {
    pub model: Pubkey,
    pub publisher: Pubkey,
    pub name: String,
    pub model_version: u32,
    pub dataset_sha256: [u8; 32],
    pub dataset_uri: String,
    pub sample_count: u32,
    pub passed_count: u32,
    pub score_bps: u16,
    pub receipts: Vec<Pubkey>,
    pub published_slot: u64,
    pub bump: u8,
}
impl Benchmark {
    pub const SPACE: usize = 8
        + 32 * 2
        + (4 + MAX_BENCHMARK_NAME)
        + 4
        + 32
        + (4 + MAX_BENCHMARK_URI)
        + 4
        + 4
        + 2
        + (4 + 32 * MAX_BENCHMARK_RECEIPTS)
        + 8
        + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PassStatus { Open, Closed }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct SetPassPlanArgs {
    pub price_per_call: u64,
    pub min_calls: u32,
    pub max_calls: u32,
    pub ttl_slots: u64,
    pub active: bool,
}

#[account]
pub struct PassPlan {
    pub model: Pubkey,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub price_per_call: u64,
    pub min_calls: u32,
    pub max_calls: u32,
    pub ttl_slots: u64,
    pub active: bool,
    pub updated_slot: u64,
    pub bump: u8,
}
impl PassPlan {
    pub const SPACE: usize = 8 + 32 * 3 + 8 + 4 + 4 + 8 + 1 + 8 + 1;
}

#[account]
pub struct Pass {
    pub model: Pubkey,
    pub holder: Pubkey,
    pub nonce: u64,
    pub mint: Pubkey,
    pub price_per_call: u64,
    pub calls_total: u32,
    pub calls_used: u32,
    pub escrow_remaining: u64,
    pub purchased_slot: u64,
    pub expires_at_slot: u64,
    pub status: PassStatus,
    pub bump: u8,
}
impl Pass {
    pub const SPACE: usize = 8 + 32 * 3 + 8 * 5 + 4 * 2 + 1 + 1;
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::Discriminator;

    #[test]
    fn worst_case_model_fits_within_space() {
        let model = Model {
            owner: Pubkey::new_unique(),
            name: "a".repeat(32),
            manifest: vec![b'x'; MAX_MANIFEST],
            weights: vec![Pubkey::new_unique(); MAX_WEIGHTS],
            size_bytes: u64::MAX,
            cipher: CIPHER.to_string(),
            nonce_prefix: [1u8; 16],
            ciphertext_sha256: [2u8; 32],
            allowed_measurements: vec![[3u8; 48]; MAX_MEASUREMENTS],
            price: u64::MAX,
            price_mint: Pubkey::new_unique(),
            operator_share_bps: 10000,
            upload_key: Pubkey::new_unique(),
            status: ModelStatus::Uploading,
            created_slot: 1,
            sealed_slot: 2,
            calls_settled: 3,
            bump: 255,
            upload_keys: vec![Pubkey::new_unique(); MAX_UPLOAD_KEYS],
            hash_version: 1,
            sealed_chunks: 100,
            merkle_frontier: vec![[4u8; 32]; MAX_MERKLE_LEVELS],
            merkle_frontier_mask: u32::MAX,
            base: Some(ModelBase {
                sha256: [5u8; 32],
                size_bytes: 1_000_000_000,
                format: "a".repeat(MAX_BASE_FORMAT),
                source: format!("https://{}", "b".repeat(MAX_BASE_SOURCE - 8)),
            }),
            price_unit: PriceUnit::Token,
            has_policy: true,
            current_version: u32::MAX,
            has_split: true,
        };
        let mut buf = Vec::new();
        model.try_serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), 8057);
        assert!(buf.len() <= Model::SPACE, "worst-case Model {} > SPACE {}", buf.len(), Model::SPACE);
    }

    #[test]
    fn legacy_6000b_model_decodes_base_none() {
        let mut data = vec![0u8; 6000];
        let mut cursor = Vec::new();
        cursor.extend_from_slice(Model::DISCRIMINATOR);
        Pubkey::new_unique().serialize(&mut cursor).unwrap();
        "sketch-32".to_string().serialize(&mut cursor).unwrap();
        b"{\"name\":\"sketch-32\"}".to_vec().serialize(&mut cursor).unwrap();
        vec![Pubkey::new_unique()].serialize(&mut cursor).unwrap();
        252_145u64.serialize(&mut cursor).unwrap();
        CIPHER.to_string().serialize(&mut cursor).unwrap();
        [3u8; 16].serialize(&mut cursor).unwrap();
        [9u8; 32].serialize(&mut cursor).unwrap();
        vec![[0xabu8; 48]].serialize(&mut cursor).unwrap();
        100_000u64.serialize(&mut cursor).unwrap();
        Pubkey::default().serialize(&mut cursor).unwrap();
        2500u16.serialize(&mut cursor).unwrap();
        Pubkey::default().serialize(&mut cursor).unwrap();
        ModelStatus::Live.serialize(&mut cursor).unwrap();
        100u64.serialize(&mut cursor).unwrap();
        120u64.serialize(&mut cursor).unwrap();
        5u64.serialize(&mut cursor).unwrap();
        254u8.serialize(&mut cursor).unwrap();
        data[..cursor.len()].copy_from_slice(&cursor);
        let decoded = Model::try_deserialize(&mut &data[..]).unwrap();
        assert_eq!(decoded.name, "sketch-32");
        assert_eq!(decoded.hash_version, 0);
        assert_eq!(decoded.sealed_chunks, 0);
        assert!(decoded.merkle_frontier.is_empty());
        assert_eq!(decoded.merkle_frontier_mask, 0);
        assert!(decoded.base.is_none());
        assert_eq!(decoded.price_unit, PriceUnit::Call);
    }

    #[test]
    fn pre_build4_8192b_adapter_model_decodes_price_unit_call() {
        let mut data = vec![0u8; Model::SPACE];
        let mut cursor = Vec::new();
        cursor.extend_from_slice(Model::DISCRIMINATOR);
        Pubkey::new_unique().serialize(&mut cursor).unwrap();
        "text-1m".to_string().serialize(&mut cursor).unwrap();
        b"{\"name\":\"text-1m\"}".to_vec().serialize(&mut cursor).unwrap();
        vec![Pubkey::new_unique()].serialize(&mut cursor).unwrap();
        214_737u64.serialize(&mut cursor).unwrap();
        CIPHER.to_string().serialize(&mut cursor).unwrap();
        [4u8; 16].serialize(&mut cursor).unwrap();
        [8u8; 32].serialize(&mut cursor).unwrap();
        vec![[0xcdu8; 48]].serialize(&mut cursor).unwrap();
        100_000u64.serialize(&mut cursor).unwrap();
        Pubkey::default().serialize(&mut cursor).unwrap();
        2500u16.serialize(&mut cursor).unwrap();
        Pubkey::default().serialize(&mut cursor).unwrap();
        ModelStatus::Live.serialize(&mut cursor).unwrap();
        100u64.serialize(&mut cursor).unwrap();
        120u64.serialize(&mut cursor).unwrap();
        1u64.serialize(&mut cursor).unwrap();
        253u8.serialize(&mut cursor).unwrap();
        Vec::<Pubkey>::new().serialize(&mut cursor).unwrap();
        1u8.serialize(&mut cursor).unwrap();
        4u32.serialize(&mut cursor).unwrap();
        Vec::<[u8; 32]>::new().serialize(&mut cursor).unwrap();
        0u32.serialize(&mut cursor).unwrap();
        Some(ModelBase {
            sha256: [0x11u8; 32],
            size_bytes: 6_143_522,
            format: "onnx".to_string(),
            source: "https://example.com/text-1m-base.onnx".to_string(),
        }).serialize(&mut cursor).unwrap();
        // Zero trailing padding simulates an 8192-byte Build 3 account written before price_unit existed.
        data[..cursor.len()].copy_from_slice(&cursor);
        let decoded = Model::try_deserialize(&mut &data[..]).unwrap();
        assert_eq!(decoded.name, "text-1m");
        assert!(decoded.base.is_some());
        assert_eq!(decoded.price_unit, PriceUnit::Call);
    }

    #[test]
    fn call_space_and_escrow_amount_match_price_unit() {
        assert_eq!(Call::BASE_SPACE, 304);
        assert_eq!(Call::SPACE, 349);
        assert_eq!(Call::space(0), 349);
        assert_eq!(Call::space(4), 349 + 33 * 4);
        let base_call = Call {
            caller: Pubkey::default(),
            model: Pubkey::default(),
            enclave: Pubkey::default(),
            nonce: 1,
            input_hash: [0u8; 32],
            price: 1_000,
            price_mint: Pubkey::default(),
            owner: Pubkey::default(),
            operator: Pubkey::default(),
            fee_recipient: Pubkey::default(),
            operator_share_bps: 2500,
            protocol_share_bps: 500,
            opened_slot: 10,
            deadline_slot: 160,
            status: CallStatus::Open,
            bump: 255,
            answer_mode: AnswerMode::Sealed,
            caller_is_program: false,
            callback_program: Pubkey::default(),
            callback_accounts: Vec::new(),
            price_unit: PriceUnit::Call,
            ceiling: 1_000,
        };
        assert_eq!(base_call.escrow_amount(), 1_000);
        let metered = Call { price_unit: PriceUnit::Token, ceiling: 64_000, ..base_call };
        assert_eq!(metered.escrow_amount(), 64_000);
    }

    #[test]
    fn model_base_validation_enforces_fields() {
        let valid = ModelBase {
            sha256: [7u8; 32],
            size_bytes: 1024,
            format: "onnx".to_string(),
            source: "https://example.com/base.onnx".to_string(),
        };
        assert!(valid.is_valid());
        assert!(ModelBase { format: "safetensors".to_string(), source: "hf://org/repo/model.safetensors".to_string(), ..valid.clone() }.is_valid());
        assert!(ModelBase { format: "gguf".to_string(), source: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi".to_string(), ..valid.clone() }.is_valid());
        assert!(ModelBase { source: "http://127.0.0.1:8080/base.onnx".to_string(), ..valid.clone() }.is_valid());

        assert!(!ModelBase { sha256: [0u8; 32], ..valid.clone() }.is_valid());
        assert!(!ModelBase { size_bytes: 0, ..valid.clone() }.is_valid());
        assert!(!ModelBase { format: "pt".to_string(), ..valid.clone() }.is_valid());
        assert!(!ModelBase { format: "".to_string(), ..valid.clone() }.is_valid());
        assert!(!ModelBase { source: "".to_string(), ..valid.clone() }.is_valid());
        assert!(!ModelBase { source: format!("https://{}", "x".repeat(MAX_BASE_SOURCE)), ..valid.clone() }.is_valid());
        assert!(!ModelBase { source: "https://example.com/with space.onnx".to_string(), ..valid.clone() }.is_valid());
        assert!(!ModelBase { source: "https://example.com/ctrl\n.onnx".to_string(), ..valid.clone() }.is_valid());
        assert!(!ModelBase { source: "file:///etc/passwd".to_string(), ..valid.clone() }.is_valid());
        assert!(!ModelBase { source: "javascript:alert(1)".to_string(), ..valid.clone() }.is_valid());
    }

    #[test]
    fn worst_case_measurement_fits_within_space() {
        let m = Measurement {
            digest: [0xabu8; 48],
            publisher: Pubkey::new_unique(),
            source_repo: "a".repeat(MAX_SOURCE_REPO),
            commit_sha: "f".repeat(MAX_COMMIT_SHA),
            recipe_hash: [0xcdu8; 32],
            version: "1".repeat(MAX_MEASUREMENT_VERSION),
            created_slot: u64::MAX,
            status: MeasurementStatus::Active,
            bump: 255,
        };
        let mut buf = Vec::new();
        m.try_serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), Measurement::SPACE);
        assert_eq!(Measurement::SPACE, 366);
    }

    #[test]
    fn worst_case_policy_fits_within_space() {
        let p = Policy {
            model: Pubkey::new_unique(),
            allow_list_enabled: true,
            allowed_callers: vec![Pubkey::new_unique(); MAX_POLICY_CALLERS],
            max_calls_per_caller_per_window: 100,
            window_slots: 1500,
            allowed_operators: vec![Pubkey::new_unique(); MAX_POLICY_OPERATORS],
            allowed_regions: (0..MAX_POLICY_REGIONS).map(|i| format!("region-{:09}", i)).collect(),
            updated_slot: u64::MAX,
            bump: 255,
        };
        let mut buf = Vec::new();
        p.try_serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), Policy::SPACE);
        assert_eq!(Policy::SPACE, 1770);
    }

    #[test]
    fn worst_case_grant_fits_within_space() {
        let mut g = Grant {
            model: Pubkey::new_unique(),
            enclave: Pubkey::new_unique(),
            wrapped_key: vec![1u8; 105],
            granted_by: Pubkey::new_unique(),
            granted_slot: u64::MAX,
            revoked: false,
            bump: 255,
            quoted_operator_share_bps: Some(2500),
        };
        let mut buf = Vec::new();
        g.try_serialize(&mut buf).unwrap();
        assert_eq!(Grant::BASE_SPACE, 223);
        assert_eq!(Grant::SPACE, 226);
        assert_eq!(buf.len(), Grant::SPACE);

        g.quoted_operator_share_bps = None;
        let mut none_buf = Vec::new();
        g.try_serialize(&mut none_buf).unwrap();
        assert_eq!(none_buf.len(), Grant::BASE_SPACE + 1);
    }

    #[test]
    fn worst_case_model_version_fits_within_space() {
        let mv = ModelVersion {
            model: Pubkey::new_unique(),
            version: u32::MAX,
            status: VersionStatus::Live,
            weights: vec![Pubkey::new_unique(); MAX_WEIGHTS],
            size_bytes: u64::MAX,
            nonce_prefix: [7u8; 16],
            ciphertext_sha256: [9u8; 32],
            manifest: vec![b'x'; MAX_MANIFEST],
            base: Some(ModelBase {
                sha256: [1u8; 32],
                size_bytes: u64::MAX,
                format: "a".repeat(MAX_BASE_FORMAT),
                source: format!("https://{}", "b".repeat(MAX_BASE_SOURCE - 8)),
            }),
            hash_version: 1,
            sealed_chunks: u32::MAX,
            merkle_frontier: vec![[3u8; 32]; MAX_MERKLE_LEVELS],
            merkle_frontier_mask: u32::MAX,
            published_slot: u64::MAX,
            bump: 255,
        };
        let mut buf = Vec::new();
        mv.try_serialize(&mut buf).unwrap();
        assert!(buf.len() <= ModelVersion::SPACE, "ModelVersion serialized {} > {}", buf.len(), ModelVersion::SPACE);
    }

    #[test]
    fn worst_case_session_fits_within_space() {
        let s = Session {
            caller: Pubkey::new_unique(),
            delegate: Pubkey::new_unique(),
            nonce: u64::MAX,
            mint: Pubkey::new_unique(),
            model: Pubkey::new_unique(),
            budget: u64::MAX,
            spent: u64::MAX,
            calls_opened: u64::MAX,
            opened_slot: u64::MAX,
            expires_at_slot: u64::MAX,
            status: SessionStatus::Closed,
            bump: 255,
        };
        let mut buf = Vec::new();
        s.try_serialize(&mut buf).unwrap();
        assert_eq!(Session::SPACE, 186);
        assert_eq!(buf.len(), Session::SPACE);
    }

    #[test]
    fn worst_case_split_fits_within_space() {
        let s = Split {
            model: Pubkey::new_unique(),
            authority: Pubkey::new_unique(),
            mint: Pubkey::new_unique(),
            active: true,
            total_received: u64::MAX,
            updated_slot: u64::MAX,
            recipients: vec![SplitRecipient { wallet: Pubkey::new_unique(), share_bps: 1250, accrued: u64::MAX, claimed: u64::MAX }; MAX_SPLIT_RECIPIENTS],
            bump: 255,
        };
        let mut buf = Vec::new();
        s.try_serialize(&mut buf).unwrap();
        assert_eq!(Split::SPACE, 526);
        assert_eq!(buf.len(), Split::SPACE);
    }

    #[test]
    fn worst_case_bond_fits_within_space() {
        let b = Bond {
            enclave: Pubkey::new_unique(),
            operator: Pubkey::new_unique(),
            bonded_lamports: u64::MAX,
            slashed_total: u64::MAX,
            missed_calls: u64::MAX,
            slash_bps: 10_000,
            updated_slot: u64::MAX,
            bump: 255,
        };
        let mut buf = Vec::new();
        b.try_serialize(&mut buf).unwrap();
        assert_eq!(Bond::SPACE, 107);
        assert_eq!(buf.len(), Bond::SPACE);
    }

    #[test]
    fn worst_case_benchmark_fits_within_space() {
        let b = Benchmark {
            model: Pubkey::new_unique(),
            publisher: Pubkey::new_unique(),
            name: "a".repeat(MAX_BENCHMARK_NAME),
            model_version: u32::MAX,
            dataset_sha256: [7u8; 32],
            dataset_uri: format!("https://{}", "b".repeat(MAX_BENCHMARK_URI - 8)),
            sample_count: u32::MAX,
            passed_count: u32::MAX,
            score_bps: 10_000,
            receipts: (0..MAX_BENCHMARK_RECEIPTS).map(|_| Pubkey::new_unique()).collect(),
            published_slot: u64::MAX,
            bump: 255,
        };
        let mut buf = Vec::new();
        b.try_serialize(&mut buf).unwrap();
        assert_eq!(Benchmark::SPACE, 843);
        assert_eq!(buf.len(), Benchmark::SPACE);
    }

    #[test]
    fn worst_case_pass_accounts_fit_within_space() {
        let plan = PassPlan {
            model: Pubkey::new_unique(),
            authority: Pubkey::new_unique(),
            mint: Pubkey::new_unique(),
            price_per_call: u64::MAX,
            min_calls: 1,
            max_calls: u32::MAX,
            ttl_slots: u64::MAX,
            active: true,
            updated_slot: u64::MAX,
            bump: 255,
        };
        let mut plan_buf = Vec::new();
        plan.try_serialize(&mut plan_buf).unwrap();
        assert_eq!(PassPlan::SPACE, 138);
        assert_eq!(plan_buf.len(), PassPlan::SPACE);

        let pass = Pass {
            model: Pubkey::new_unique(),
            holder: Pubkey::new_unique(),
            nonce: u64::MAX,
            mint: Pubkey::new_unique(),
            price_per_call: u64::MAX,
            calls_total: u32::MAX,
            calls_used: u32::MAX,
            escrow_remaining: u64::MAX,
            purchased_slot: u64::MAX,
            expires_at_slot: u64::MAX,
            status: PassStatus::Closed,
            bump: 255,
        };
        let mut pass_buf = Vec::new();
        pass.try_serialize(&mut pass_buf).unwrap();
        assert_eq!(Pass::SPACE, 154);
        assert_eq!(pass_buf.len(), Pass::SPACE);
    }
}
