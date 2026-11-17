use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_error::ProgramError;

pub struct VerifiedRecord {
    pub hardware_type: u8,
    pub measurement: [u8; 48],
    pub recorded_slot: u64,
    pub expires_at_slot: u64,
}

/// The sole decoder for the development verifier. A live verifier replaces this
/// decoder and the configured program/layout, leaving Voynich's handlers intact.
pub fn verify(
    record: &AccountInfo,
    program: &Pubkey,
    version: u8,
    signing: &Pubkey,
    current_slot: u64,
) -> std::result::Result<VerifiedRecord, ProgramError> {
    if *program == Pubkey::default() || record.owner != program || version != 1 || *signing == Pubkey::default() {
        return Err(ProgramError::InvalidAccountData);
    }
    let (expected, _) = Pubkey::find_program_address(&[b"record", signing.as_ref()], program);
    if record.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    let data = record.try_borrow_data()?;
    // Anchor's SHA-256 account discriminator followed by fixed Borsh layout v1.
    const DISCRIMINATOR: [u8; 8] = [33, 137, 13, 193, 39, 232, 216, 63];
    if data.len() != 114 || data[..8] != DISCRIMINATOR || data[8] != version || data[9..41] != signing.to_bytes() {
        return Err(ProgramError::InvalidAccountData);
    }
    let hardware_type = data[41];
    let measurement: [u8; 48] = data[42..90].try_into().unwrap();
    let recorded_slot = u64::from_le_bytes(data[90..98].try_into().unwrap());
    let expires_at_slot = u64::from_le_bytes(data[98..106].try_into().unwrap());
    let report_slot = u64::from_le_bytes(data[106..114].try_into().unwrap());
    if hardware_type > 2 || measurement == [0; 48] || recorded_slot > current_slot || report_slot > recorded_slot || expires_at_slot <= current_slot {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(VerifiedRecord { hardware_type, measurement, recorded_slot, expires_at_slot })
}
