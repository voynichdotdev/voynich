use anchor_lang::prelude::*;

pub mod attestation;
pub mod contexts;
pub mod errors;
pub mod events;
pub mod handlers;
pub mod money;
pub mod state;
pub mod weights;

declare_id!("65H3C7T6C2DmbkR9ssBBmNtqpybWcYwotkkETL4E7RSS");

#[program]
pub mod voynich {
    use super::*;

    pub fn initialize(ctx: Context<InitializeConfig>, protocol_share_bps: u16) -> Result<()> {
        handlers::initialize_config(ctx, protocol_share_bps)
    }

    pub fn create_model(ctx: Context<CreateModel>, id_hash: [u8; 32], price_amount: u64) -> Result<()> {
        handlers::create_model(ctx, id_hash, price_amount)
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub config: Account<'info, state::Config>,
}

#[derive(Accounts)]
pub struct CreateModel<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub model: Account<'info, state::Model>,
}
