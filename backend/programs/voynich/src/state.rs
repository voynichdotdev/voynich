use anchor_lang::prelude::*;

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub attestation_program: Pubkey,
    pub attestation_record_layout_version: u8,
    pub fee_recipient: Pubkey,
    pub protocol_share_bps: u16,
    pub call_deadline_slots: u64,
    pub bump: u8,
}

#[account]
pub struct Model {
    pub owner: Pubkey,
    pub id_hash: [u8; 32],
    pub price_amount: u64,
    pub operator_share_bps: u16,
    pub sealed: bool,
    pub retired: bool,
    pub bump: u8,
}
