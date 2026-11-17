use anchor_lang::solana_program::{
    account_info::AccountInfo, ed25519_program, entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
};

/// Matches one already-verified native Ed25519 instruction to this operation's intent.
/// Cross-instruction offsets are deliberately refused: every signed byte must be in that instruction.
pub fn verify(
    instructions: &AccountInfo,
    index: u16,
    key: &Pubkey,
    message: &[u8],
    signature: &[u8; 64],
) -> ProgramResult {
    let invalid = ProgramError::InvalidInstructionData;
    if index >= load_current_index_checked(instructions)? {
        return Err(invalid);
    }
    let instruction = load_instruction_at_checked(usize::from(index), instructions)?;
    if instruction.program_id != ed25519_program::ID || !instruction.accounts.is_empty() {
        return Err(invalid);
    }
    let data = instruction.data.as_slice();
    if data.len() < 16 || data[0] != 1 || data[1] != 0 {
        return Err(invalid);
    }
    let word = |offset: usize| u16::from_le_bytes([data[offset], data[offset + 1]]);
    if word(4) != u16::MAX || word(8) != u16::MAX || word(14) != u16::MAX {
        return Err(invalid);
    }
    let bounded = |offset: u16, length: usize| -> Option<&[u8]> {
        let start = usize::from(offset);
        let end = start.checked_add(length)?;
        data.get(start..end)
    };
    if bounded(word(2), 64) != Some(signature.as_slice())
        || bounded(word(6), 32) != Some(key.as_ref())
        || usize::from(word(12)) != message.len()
        || bounded(word(10), message.len()) != Some(message)
    {
        return Err(invalid);
    }
    Ok(())
}
