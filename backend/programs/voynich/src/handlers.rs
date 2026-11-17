use anchor_lang::prelude::*;

use crate::state::{Config, Model};

pub fn initialize_config(ctx: Context<crate::InitializeConfig>, protocol_share_bps: u16) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.protocol_share_bps = protocol_share_bps;
    Ok(())
}

pub fn create_model(ctx: Context<crate::CreateModel>, id_hash: [u8; 32], price_amount: u64) -> Result<()> {
    let model = &mut ctx.accounts.model;
    model.owner = ctx.accounts.owner.key();
    model.id_hash = id_hash;
    model.price_amount = price_amount;
    model.sealed = false;
    model.retired = false;
    Ok(())
}
