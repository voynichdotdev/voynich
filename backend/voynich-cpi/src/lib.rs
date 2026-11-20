use core::fmt;
use anchor_lang::prelude::*;
use anchor_lang::Discriminator;

pub use voynich::{
    self,
    cpi::accounts::{OpenCall, RefundCall},
    program::Voynich,
    state::{
        AnswerMode, CallbackAccount, CallbackSpec, MAX_CALLBACK_ACCOUNTS, ON_RECEIPT_DISCRIMINATOR,
        PriceUnit,
    },
    ID,
};

pub const RECEIPT_LEGACY_SPACE: usize = 401;
pub const RECEIPT_STEP1_HEADER_SPACE: usize = 406;
pub const RECEIPT_METERED_EXTENSION: usize = 16;
pub const RECEIPT_METERED_SPACE: usize = RECEIPT_STEP1_HEADER_SPACE + 1 + RECEIPT_METERED_EXTENSION;

#[error_code]
pub enum VoynichCpiError {
    #[msg("Receipt account is not owned by the Voynich program.")]
    InvalidReceiptOwner,
    #[msg("Receipt address does not match the canonical receipt PDA for this call.")]
    InvalidReceiptPda,
    #[msg("Account bytes do not start with the Voynich Receipt discriminator.")]
    InvalidReceiptDiscriminator,
    #[msg("Receipt account data is malformed or truncated.")]
    InvalidReceiptData,
    #[msg("Receipt model does not match the expected model.")]
    ModelMismatch,
    #[msg("Receipt call does not match the expected call.")]
    CallMismatch,
}

#[derive(Clone, PartialEq, Eq)]
pub struct ParsedReceipt {
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
    pub delivered_count: Option<u64>,
    pub returned_amount: Option<u64>,
}

impl fmt::Debug for ParsedReceipt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mode = match self.answer_mode {
            AnswerMode::Sealed => "Sealed",
            AnswerMode::Open => "Open",
        };
        f.debug_struct("ParsedReceipt")
            .field("call", &self.call)
            .field("model", &self.model)
            .field("enclave", &self.enclave)
            .field("slot", &self.slot)
            .field("total", &self.total)
            .field("answer_mode", &mode)
            .field("open_answer_len", &self.open_answer.len())
            .field("caller_is_program", &self.caller_is_program)
            .field("delivered_count", &self.delivered_count)
            .field("returned_amount", &self.returned_amount)
            .finish()
    }
}

pub fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"config"], &voynich::ID)
}

pub fn model_pda(name: &str) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"model", name.as_bytes()], &voynich::ID)
}

pub fn enclave_pda(signing_key: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"enclave", signing_key.as_ref()], &voynich::ID)
}

pub fn grant_pda(model: &Pubkey, enclave: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"grant", model.as_ref(), enclave.as_ref()], &voynich::ID)
}

pub fn call_pda(caller: &Pubkey, nonce: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"call", caller.as_ref(), &nonce.to_le_bytes()], &voynich::ID)
}

pub fn receipt_pda(call: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"receipt", call.as_ref()], &voynich::ID)
}

pub fn event_authority_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"__event_authority"], &voynich::ID)
}

/// Opens a paid Voynich inference call via CPI without a settlement callback.
pub fn open_call<'a, 'b, 'c, 'info>(
    ctx: CpiContext<'a, 'b, 'c, 'info, OpenCall<'info>>,
    nonce: u64,
    input_hash: [u8; 32],
    answer_mode: AnswerMode,
) -> Result<()> {
    voynich::cpi::open_call(ctx, nonce, input_hash, answer_mode, None)
}

/// Opens a paid Voynich inference call via CPI that invokes `callback.program::on_receipt`
/// inside `settle_call` immediately after the Receipt is written.
pub fn open_call_with_callback<'a, 'b, 'c, 'info>(
    ctx: CpiContext<'a, 'b, 'c, 'info, OpenCall<'info>>,
    nonce: u64,
    input_hash: [u8; 32],
    answer_mode: AnswerMode,
    callback: CallbackSpec,
) -> Result<()> {
    voynich::cpi::open_call(ctx, nonce, input_hash, answer_mode, Some(callback))
}

/// Opens a per-token metered Voynich inference call via CPI with an explicit escrow ceiling.
pub fn open_metered_call<'a, 'b, 'c, 'info>(
    ctx: CpiContext<'a, 'b, 'c, 'info, OpenCall<'info>>,
    nonce: u64,
    input_hash: [u8; 32],
    answer_mode: AnswerMode,
    ceiling: u64,
) -> Result<()> {
    voynich::cpi::open_metered_call(ctx, nonce, input_hash, answer_mode, None, ceiling)
}

/// Opens a per-token metered Voynich inference call via CPI with a settlement callback and escrow ceiling.
pub fn open_metered_call_with_callback<'a, 'b, 'c, 'info>(
    ctx: CpiContext<'a, 'b, 'c, 'info, OpenCall<'info>>,
    nonce: u64,
    input_hash: [u8; 32],
    answer_mode: AnswerMode,
    callback: CallbackSpec,
    ceiling: u64,
) -> Result<()> {
    voynich::cpi::open_metered_call(ctx, nonce, input_hash, answer_mode, Some(callback), ceiling)
}

/// Refunds an expired Voynich call via CPI, returning escrow to the original caller.
pub fn refund_call<'a, 'b, 'c, 'info>(
    ctx: CpiContext<'a, 'b, 'c, 'info, RefundCall<'info>>,
) -> Result<()> {
    voynich::cpi::refund_call(ctx)
}

fn read_pubkey(data: &[u8], offset: usize) -> Pubkey {
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&data[offset..offset + 32]);
    Pubkey::new_from_array(bytes)
}

fn read_u64(data: &[u8], offset: usize) -> u64 {
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&data[offset..offset + 8]);
    u64::from_le_bytes(bytes)
}

fn read_array_32(data: &[u8], offset: usize) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&data[offset..offset + 32]);
    bytes
}

fn read_array_64(data: &[u8], offset: usize) -> [u8; 64] {
    let mut bytes = [0u8; 64];
    bytes.copy_from_slice(&data[offset..offset + 64]);
    bytes
}

/// Verifies a Voynich Receipt account's owner, canonical PDA, discriminator, layout, model, and call,
/// returning a decoded `ParsedReceipt` compatible with legacy (401B), Step 1 (406+N), and Step 2 (407+N) layouts.
pub fn read_receipt(
    receipt_info: &AccountInfo,
    expected_model: &Pubkey,
    expected_call: &Pubkey,
) -> Result<ParsedReceipt> {
    require_keys_eq!(*receipt_info.owner, voynich::ID, VoynichCpiError::InvalidReceiptOwner);
    let (expected_pda, _) = receipt_pda(expected_call);
    require_keys_eq!(receipt_info.key(), expected_pda, VoynichCpiError::InvalidReceiptPda);

    let data = receipt_info.try_borrow_data()?;
    require!(data.len() >= 8, VoynichCpiError::InvalidReceiptDiscriminator);
    require!(
        &data[..8] == voynich::state::Receipt::DISCRIMINATOR,
        VoynichCpiError::InvalidReceiptDiscriminator
    );
    require!(data.len() >= RECEIPT_LEGACY_SPACE, VoynichCpiError::InvalidReceiptData);

    let call = read_pubkey(&data, 8);
    let model = read_pubkey(&data, 40);
    let enclave = read_pubkey(&data, 72);
    let input_hash = read_array_32(&data, 104);
    let output_hash = read_array_32(&data, 136);
    let signature = read_array_64(&data, 168);
    let slot = read_u64(&data, 232);
    let price_mint = read_pubkey(&data, 240);
    let total = read_u64(&data, 272);
    let owner = read_pubkey(&data, 280);
    let operator = read_pubkey(&data, 312);
    let fee_recipient = read_pubkey(&data, 344);
    let owner_amount = read_u64(&data, 376);
    let operator_amount = read_u64(&data, 384);
    let protocol_amount = read_u64(&data, 392);
    let bump = data[400];

    let (answer_mode, open_answer, caller_is_program, delivered_count, returned_amount) = if data.len() == RECEIPT_LEGACY_SPACE {
        (AnswerMode::Sealed, Vec::new(), false, None, None)
    } else {
        require!(data.len() >= RECEIPT_STEP1_HEADER_SPACE, VoynichCpiError::InvalidReceiptData);
        let mode = match data[401] {
            0 => AnswerMode::Sealed,
            1 => AnswerMode::Open,
            _ => return Err(error!(VoynichCpiError::InvalidReceiptData)),
        };
        let mut len_bytes = [0u8; 4];
        len_bytes.copy_from_slice(&data[402..406]);
        let open_len = u32::from_le_bytes(len_bytes) as usize;
        let step1_end = RECEIPT_STEP1_HEADER_SPACE
            .checked_add(open_len)
            .ok_or_else(|| error!(VoynichCpiError::InvalidReceiptData))?;
        let step2_end = step1_end
            .checked_add(1)
            .ok_or_else(|| error!(VoynichCpiError::InvalidReceiptData))?;
        let metered_end = step2_end
            .checked_add(RECEIPT_METERED_EXTENSION)
            .ok_or_else(|| error!(VoynichCpiError::InvalidReceiptData))?;
        if data.len() == step1_end {
            (mode, data[RECEIPT_STEP1_HEADER_SPACE..step1_end].to_vec(), false, None, None)
        } else if data.len() == step2_end {
            let caller_flag = match data[step1_end] {
                0 => false,
                1 => true,
                _ => return Err(error!(VoynichCpiError::InvalidReceiptData)),
            };
            (mode, data[RECEIPT_STEP1_HEADER_SPACE..step1_end].to_vec(), caller_flag, None, None)
        } else if data.len() == metered_end {
            let caller_flag = match data[step1_end] {
                0 => false,
                1 => true,
                _ => return Err(error!(VoynichCpiError::InvalidReceiptData)),
            };
            let delivered = read_u64(&data, step2_end);
            let returned = read_u64(&data, step2_end + 8);
            (mode, data[RECEIPT_STEP1_HEADER_SPACE..step1_end].to_vec(), caller_flag, Some(delivered), Some(returned))
        } else {
            return Err(error!(VoynichCpiError::InvalidReceiptData));
        }
    };

    require_keys_eq!(call, *expected_call, VoynichCpiError::CallMismatch);
    require_keys_eq!(model, *expected_model, VoynichCpiError::ModelMismatch);

    Ok(ParsedReceipt {
        call,
        model,
        enclave,
        input_hash,
        output_hash,
        signature,
        slot,
        price_mint,
        total,
        owner,
        operator,
        fee_recipient,
        owner_amount,
        operator_amount,
        protocol_amount,
        bump,
        answer_mode,
        open_answer,
        caller_is_program,
        delivered_count,
        returned_amount,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_receipt_bytes(
        call: Pubkey,
        model: Pubkey,
        enclave: Pubkey,
        era: &str,
        answer_mode: u8,
        open_answer: &[u8],
        caller_is_program: u8,
    ) -> Vec<u8> {
        let mut base = vec![0u8; RECEIPT_LEGACY_SPACE];
        base[0..8].copy_from_slice(voynich::state::Receipt::DISCRIMINATOR);
        base[8..40].copy_from_slice(call.as_ref());
        base[40..72].copy_from_slice(model.as_ref());
        base[72..104].copy_from_slice(enclave.as_ref());
        base[104..136].fill(0x11);
        base[136..168].fill(0x22);
        base[168..232].fill(0x33);
        base[232..240].copy_from_slice(&420u64.to_le_bytes());
        base[272..280].copy_from_slice(&1_000_000u64.to_le_bytes());
        base[376..384].copy_from_slice(&700_000u64.to_le_bytes());
        base[384..392].copy_from_slice(&250_000u64.to_le_bytes());
        base[392..400].copy_from_slice(&50_000u64.to_le_bytes());
        base[400] = 251;

        match era {
            "legacy" => base,
            "step1" => {
                base.push(answer_mode);
                base.extend_from_slice(&(open_answer.len() as u32).to_le_bytes());
                base.extend_from_slice(open_answer);
                base
            }
            "step2" => {
                base.push(answer_mode);
                base.extend_from_slice(&(open_answer.len() as u32).to_le_bytes());
                base.extend_from_slice(open_answer);
                base.push(caller_is_program);
                base
            }
            _ => unreachable!(),
        }
    }

    fn make_account_info<'a>(
        key: &'a Pubkey,
        lamports: &'a mut u64,
        data: &'a mut [u8],
        owner: &'a Pubkey,
    ) -> AccountInfo<'a> {
        AccountInfo::new(key, false, false, lamports, data, owner, false, 0)
    }

    #[test]
    fn reads_legacy_401_receipt() {
        let call = Pubkey::new_unique();
        let model = Pubkey::new_unique();
        let enclave = Pubkey::new_unique();
        let (pda_key, _) = receipt_pda(&call);
        let mut lamports = 1_000_000;
        let mut bytes = build_receipt_bytes(call, model, enclave, "legacy", 0, &[], 0);
        let info = make_account_info(&pda_key, &mut lamports, &mut bytes, &voynich::ID);
        let parsed = read_receipt(&info, &model, &call).expect("legacy 401B receipt must parse");
        assert_eq!(parsed.call, call);
        assert_eq!(parsed.model, model);
        assert_eq!(parsed.enclave, enclave);
        assert_eq!(parsed.slot, 420);
        assert_eq!(parsed.total, 1_000_000);
        assert!(parsed.answer_mode == AnswerMode::Sealed);
        assert!(parsed.open_answer.is_empty());
        assert!(!parsed.caller_is_program);
    }

    #[test]
    fn reads_step1_open_receipt() {
        let call = Pubkey::new_unique();
        let model = Pubkey::new_unique();
        let enclave = Pubkey::new_unique();
        let (pda_key, _) = receipt_pda(&call);
        let answer = br#"{"label":"clock","probability":0.97}"#;
        let mut lamports = 1_000_000;
        let mut bytes = build_receipt_bytes(call, model, enclave, "step1", 1, answer, 0);
        let info = make_account_info(&pda_key, &mut lamports, &mut bytes, &voynich::ID);
        let parsed = read_receipt(&info, &model, &call).expect("step1 406+N receipt must parse");
        assert!(parsed.answer_mode == AnswerMode::Open);
        assert_eq!(parsed.open_answer, answer);
        assert!(!parsed.caller_is_program);
    }

    #[test]
    fn reads_step2_program_receipt() {
        let call = Pubkey::new_unique();
        let model = Pubkey::new_unique();
        let enclave = Pubkey::new_unique();
        let (pda_key, _) = receipt_pda(&call);
        let answer = br#"{"label":"clock","probability":0.97}"#;
        let mut lamports = 1_000_000;
        let mut bytes = build_receipt_bytes(call, model, enclave, "step2", 1, answer, 1);
        let info = make_account_info(&pda_key, &mut lamports, &mut bytes, &voynich::ID);
        let parsed = read_receipt(&info, &model, &call).expect("step2 407+N receipt must parse");
        assert!(parsed.answer_mode == AnswerMode::Open);
        assert_eq!(parsed.open_answer, answer);
        assert!(parsed.caller_is_program);
    }

    #[test]
    fn rejects_wrong_owner() {
        let call = Pubkey::new_unique();
        let model = Pubkey::new_unique();
        let enclave = Pubkey::new_unique();
        let (pda_key, _) = receipt_pda(&call);
        let bad_owner = Pubkey::new_unique();
        let mut lamports = 1_000_000;
        let mut bytes = build_receipt_bytes(call, model, enclave, "step2", 1, b"ok", 1);
        let info = make_account_info(&pda_key, &mut lamports, &mut bytes, &bad_owner);
        let err = read_receipt(&info, &model, &call).unwrap_err();
        assert!(err.to_string().contains("InvalidReceiptOwner"));
    }

    #[test]
    fn rejects_wrong_pda() {
        let call = Pubkey::new_unique();
        let model = Pubkey::new_unique();
        let enclave = Pubkey::new_unique();
        let wrong_key = Pubkey::new_unique();
        let mut lamports = 1_000_000;
        let mut bytes = build_receipt_bytes(call, model, enclave, "step2", 1, b"ok", 1);
        let info = make_account_info(&wrong_key, &mut lamports, &mut bytes, &voynich::ID);
        let err = read_receipt(&info, &model, &call).unwrap_err();
        assert!(err.to_string().contains("InvalidReceiptPda"));
    }

    #[test]
    fn rejects_bad_discriminator() {
        let call = Pubkey::new_unique();
        let model = Pubkey::new_unique();
        let enclave = Pubkey::new_unique();
        let (pda_key, _) = receipt_pda(&call);
        let mut lamports = 1_000_000;
        let mut bytes = build_receipt_bytes(call, model, enclave, "step2", 1, b"ok", 1);
        bytes[0] ^= 0xff;
        let info = make_account_info(&pda_key, &mut lamports, &mut bytes, &voynich::ID);
        let err = read_receipt(&info, &model, &call).unwrap_err();
        assert!(err.to_string().contains("InvalidReceiptDiscriminator"));
    }

    #[test]
    fn rejects_wrong_model() {
        let call = Pubkey::new_unique();
        let model = Pubkey::new_unique();
        let other_model = Pubkey::new_unique();
        let enclave = Pubkey::new_unique();
        let (pda_key, _) = receipt_pda(&call);
        let mut lamports = 1_000_000;
        let mut bytes = build_receipt_bytes(call, model, enclave, "step2", 1, b"ok", 1);
        let info = make_account_info(&pda_key, &mut lamports, &mut bytes, &voynich::ID);
        let err = read_receipt(&info, &other_model, &call).unwrap_err();
        assert!(err.to_string().contains("ModelMismatch"));
    }

    #[test]
    fn rejects_wrong_call() {
        let stored_call = Pubkey::new_unique();
        let expected_call = Pubkey::new_unique();
        let model = Pubkey::new_unique();
        let enclave = Pubkey::new_unique();
        let (pda_key, _) = receipt_pda(&expected_call);
        let mut lamports = 1_000_000;
        let mut bytes = build_receipt_bytes(stored_call, model, enclave, "step2", 1, b"ok", 1);
        let info = make_account_info(&pda_key, &mut lamports, &mut bytes, &voynich::ID);
        let err = read_receipt(&info, &model, &expected_call).unwrap_err();
        assert!(err.to_string().contains("CallMismatch"));
    }

    #[test]
    fn rejects_malformed_trailing_bytes() {
        let call = Pubkey::new_unique();
        let model = Pubkey::new_unique();
        let enclave = Pubkey::new_unique();
        let (pda_key, _) = receipt_pda(&call);

        // Truncated between 401 and 406
        let mut lamports = 1_000_000;
        let mut bytes = build_receipt_bytes(call, model, enclave, "legacy", 0, &[], 0);
        bytes.push(1);
        let info = make_account_info(&pda_key, &mut lamports, &mut bytes, &voynich::ID);
        assert!(read_receipt(&info, &model, &call).unwrap_err().to_string().contains("InvalidReceiptData"));

        // Invalid caller_is_program byte (2)
        let mut bytes2 = build_receipt_bytes(call, model, enclave, "step2", 1, b"ok", 2);
        let info2 = make_account_info(&pda_key, &mut lamports, &mut bytes2, &voynich::ID);
        assert!(read_receipt(&info2, &model, &call).unwrap_err().to_string().contains("InvalidReceiptData"));

        // Invalid answer_mode byte (7)
        let mut bytes3 = build_receipt_bytes(call, model, enclave, "step2", 7, b"ok", 0);
        let info3 = make_account_info(&pda_key, &mut lamports, &mut bytes3, &voynich::ID);
        assert!(read_receipt(&info3, &model, &call).unwrap_err().to_string().contains("InvalidReceiptData"));
    }

    #[test]
    fn pda_helpers_match_canonical_seeds() {
        let caller = Pubkey::new_unique();
        let (call_key, _) = call_pda(&caller, 7);
        assert_eq!(call_key, Pubkey::find_program_address(&[b"call", caller.as_ref(), &7u64.to_le_bytes()], &voynich::ID).0);
        assert_eq!(config_pda().0, Pubkey::find_program_address(&[b"config"], &voynich::ID).0);
        assert_eq!(model_pda("sketch-32").0, Pubkey::find_program_address(&[b"model", b"sketch-32"], &voynich::ID).0);
        assert_eq!(receipt_pda(&call_key).0, Pubkey::find_program_address(&[b"receipt", call_key.as_ref()], &voynich::ID).0);
        assert_eq!(event_authority_pda().0, Pubkey::find_program_address(&[b"__event_authority"], &voynich::ID).0);
    }

    #[test]
    fn reads_metered_423_receipt() {
        let call = Pubkey::new_unique();
        let model = Pubkey::new_unique();
        let enclave = Pubkey::new_unique();
        let (pda_key, _) = receipt_pda(&call);
        let mut lamports = 1_000_000;
        let mut bytes = build_receipt_bytes(call, model, enclave, "step2", 0, &[], 0);
        bytes.extend_from_slice(&61u64.to_le_bytes());
        bytes.extend_from_slice(&78_000u64.to_le_bytes());
        assert_eq!(bytes.len(), RECEIPT_METERED_SPACE);
        assert_eq!(RECEIPT_METERED_SPACE, 423);
        let info = make_account_info(&pda_key, &mut lamports, &mut bytes, &voynich::ID);
        let parsed = read_receipt(&info, &model, &call).expect("metered 423B receipt must parse");
        assert!(parsed.answer_mode == AnswerMode::Sealed);
        assert!(parsed.open_answer.is_empty());
        assert!(!parsed.caller_is_program);
        assert_eq!(parsed.delivered_count, Some(61));
        assert_eq!(parsed.returned_amount, Some(78_000));

        // Partial metered tail (e.g. 415B) must fail cleanly.
        let mut truncated = bytes[..415].to_vec();
        let info_bad = make_account_info(&pda_key, &mut lamports, &mut truncated, &voynich::ID);
        assert!(read_receipt(&info_bad, &model, &call).unwrap_err().to_string().contains("InvalidReceiptData"));
    }

    #[test]
    fn callback_constants_and_spec_match_voynich() {
        let expected = anchor_lang::solana_program::hash::hash(b"global:on_receipt").to_bytes();
        assert_eq!(ON_RECEIPT_DISCRIMINATOR, expected[..8]);
        assert_eq!(MAX_CALLBACK_ACCOUNTS, 8);
        let program = Pubkey::new_unique();
        let target = Pubkey::new_unique();
        let spec = CallbackSpec {
            program,
            accounts: vec![CallbackAccount { pubkey: target, is_writable: true }],
        };
        assert_eq!(spec.program, program);
        assert_eq!(spec.accounts.len(), 1);
        assert!(spec.accounts[0].is_writable);
    }
}
