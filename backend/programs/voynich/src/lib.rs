use anchor_lang::prelude::*;

pub mod attestation;
pub mod errors;
pub mod money;
pub mod state;

declare_id!("65H3C7T6C2DmbkR9ssBBmNtqpybWcYwotkkETL4E7RSS");

#[program]
pub mod voynich {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
