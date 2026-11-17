use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar;

mod ed25519 { include!("../../shared/ed25519.rs"); }

declare_id!("9nt8ErJoyTnn79Hd79tEzViQGavTF2HLiJ4fjoN7U64g");

pub const LAYOUT_VERSION: u8 = 1;
pub const REPORT_DOMAIN: &[u8] = b"voynich/attestation/v1";

#[program]
pub mod attest {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        dev_root: Pubkey,
        max_report_age_slots: u64,
        record_lifetime_slots: u64,
    ) -> Result<()> {
        require_keys_neq!(dev_root, Pubkey::default(), AttestError::InvalidConfiguration);
        require!(max_report_age_slots > 0 && record_lifetime_slots > 0, AttestError::InvalidConfiguration);
        ctx.accounts.config.set_inner(AttestConfig {
            admin: ctx.accounts.admin.key(),
            dev_root,
            max_report_age_slots,
            record_lifetime_slots,
        });
        emit_cpi!(ConfigInitialized {
            admin: ctx.accounts.admin.key(), dev_root, max_report_age_slots, record_lifetime_slots,
        });
        Ok(())
    }

    pub fn submit_report(
        ctx: Context<SubmitReport>,
        version: u8,
        hardware_type: u8,
        signing_key: Pubkey,
        measurement: [u8; 48],
        recent_slot: u64,
        slot_hash: [u8; 32],
        signature: [u8; 64],
        ed25519_ix_index: u16,
    ) -> Result<()> {
        require!(version == LAYOUT_VERSION, AttestError::UnsupportedVersion);
        require!(hardware_type <= 2, AttestError::InvalidHardwareType);
        require_keys_neq!(signing_key, Pubkey::default(), AttestError::InvalidSigningKey);
        require!(measurement != [0; 48], AttestError::InvalidMeasurement);
        let now = Clock::get()?.slot;
        let age = now.checked_sub(recent_slot).ok_or(AttestError::ReportNotRecent)?;
        require!(age <= ctx.accounts.config.max_report_age_slots, AttestError::ReportNotRecent);
        require!(contains_slot_hash(&ctx.accounts.slot_hashes.to_account_info(), recent_slot, &slot_hash)?, AttestError::SlotHashMismatch);
        let record = &mut ctx.accounts.record;
        require!(record.layout_version == 0 || recent_slot > record.report_slot, AttestError::ReportReplay);
        let message = report_message(version, hardware_type, &signing_key, &measurement, recent_slot, &slot_hash);
        ed25519::verify(
            &ctx.accounts.instructions.to_account_info(), ed25519_ix_index,
            &ctx.accounts.config.dev_root, &message, &signature,
        ).map_err(|_| error!(AttestError::InvalidReportSignature))?;
        let expires_at_slot = now.checked_add(ctx.accounts.config.record_lifetime_slots).ok_or(AttestError::SlotOverflow)?;
        record.set_inner(AttestationRecord {
            layout_version: LAYOUT_VERSION,
            signing_key,
            hardware_type,
            measurement,
            recorded_slot: now,
            expires_at_slot,
            report_slot: recent_slot,
        });
        emit_cpi!(RecordUpdated {
            record: ctx.accounts.record.key(), signing_key, hardware_type, measurement,
            recorded_slot: now, expires_at_slot, report_slot: recent_slot,
        });
        Ok(())
    }
}

pub fn report_message(
    version: u8,
    hardware_type: u8,
    signing_key: &Pubkey,
    measurement: &[u8; 48],
    recent_slot: u64,
    slot_hash: &[u8; 32],
) -> Vec<u8> {
    let mut message = Vec::with_capacity(REPORT_DOMAIN.len() + 122);
    message.extend_from_slice(REPORT_DOMAIN);
    message.push(version);
    message.push(hardware_type);
    message.extend_from_slice(signing_key.as_ref());
    message.extend_from_slice(measurement);
    message.extend_from_slice(&recent_slot.to_le_bytes());
    message.extend_from_slice(slot_hash);
    message
}

fn contains_slot_hash(account: &AccountInfo, slot: u64, expected: &[u8; 32]) -> Result<bool> {
    // SlotHashes is bincode Vec<(u64, Hash)>; reading it in place avoids allocating the sysvar.
    let data = account.try_borrow_data()?;
    require!(data.len() >= 8, AttestError::InvalidSlotHashes);
    let count = u64::from_le_bytes(data[..8].try_into().unwrap());
    let count = usize::try_from(count).map_err(|_| error!(AttestError::InvalidSlotHashes))?;
    require!(count <= (data.len() - 8) / 40, AttestError::InvalidSlotHashes);
    for entry in data[8..].chunks_exact(40).take(count) {
        if u64::from_le_bytes(entry[..8].try_into().unwrap()) == slot {
            return Ok(entry[8..40] == expected[..]);
        }
    }
    Ok(false)
}

#[event_cpi]
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + AttestConfig::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, AttestConfig>,
    #[account(constraint = self_program.programdata_address()? == Some(program_data.key()) @ AttestError::Unauthorized)]
    pub self_program: Program<'info, crate::program::Attest>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ AttestError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(version: u8, hardware_type: u8, signing_key: Pubkey)]
pub struct SubmitReport<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, AttestConfig>,
    #[account(init_if_needed, payer = payer, space = 8 + AttestationRecord::INIT_SPACE, seeds = [b"record", signing_key.as_ref()], bump)]
    pub record: Account<'info, AttestationRecord>,
    /// CHECK: Canonical sysvar address; its bincode entries are decoded in place.
    #[account(address = sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
    /// CHECK: Canonical instructions sysvar, checked by the native Ed25519 parser.
    #[account(address = sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct AttestConfig {
    pub admin: Pubkey,
    pub dev_root: Pubkey,
    pub max_report_age_slots: u64,
    pub record_lifetime_slots: u64,
}

#[account]
#[derive(InitSpace)]
pub struct AttestationRecord {
    pub layout_version: u8,
    pub signing_key: Pubkey,
    /// 0 = development stand-in, 1 = Intel TDX, 2 = AMD SEV-SNP.
    pub hardware_type: u8,
    pub measurement: [u8; 48],
    pub recorded_slot: u64,
    pub expires_at_slot: u64,
    /// Latest root-signed slot; a replay must never extend the record's lifetime.
    pub report_slot: u64,
}

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub dev_root: Pubkey,
    pub max_report_age_slots: u64,
    pub record_lifetime_slots: u64,
}

#[event]
pub struct RecordUpdated {
    pub record: Pubkey,
    pub signing_key: Pubkey,
    pub hardware_type: u8,
    pub measurement: [u8; 48],
    pub recorded_slot: u64,
    pub expires_at_slot: u64,
    pub report_slot: u64,
}

#[error_code]
pub enum AttestError {
    #[msg("Only the program upgrade authority can initialize attestation configuration.")]
    Unauthorized,
    #[msg("The development root and slot limits must be explicitly configured.")]
    InvalidConfiguration,
    #[msg("This report layout version is not supported.")]
    UnsupportedVersion,
    #[msg("The hardware type must be dev, TDX or SEV-SNP.")]
    InvalidHardwareType,
    #[msg("The report must name a nonzero signing key.")]
    InvalidSigningKey,
    #[msg("The report must name a nonzero software measurement.")]
    InvalidMeasurement,
    #[msg("The report's slot is in the future or older than the configured maximum age.")]
    ReportNotRecent,
    #[msg("The report's slot hash is absent from the canonical SlotHashes sysvar.")]
    SlotHashMismatch,
    #[msg("This report does not advance the record's root-signed slot.")]
    ReportReplay,
    #[msg("The preceding Ed25519 instruction does not verify this report against the development root.")]
    InvalidReportSignature,
    #[msg("The configured record expiry overflows the slot counter.")]
    SlotOverflow,
    #[msg("The SlotHashes sysvar data is invalid.")]
    InvalidSlotHashes,
}
