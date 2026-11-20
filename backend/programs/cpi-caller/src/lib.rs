use anchor_lang::{prelude::*, system_program};
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use voynich_cpi::{AnswerMode, OpenCall, RefundCall, Voynich};

declare_id!("5niikRYqdGcR4KJd9aXfQaYdoQHzdrF1sDyiwrTvbEoa");

#[error_code]
pub enum CpiCallerError {
    #[msg("Receipt open answer does not match the expected payload.")]
    AnswerMismatch,
}

#[program]
pub mod cpi_caller {
    use super::*;

    pub fn open_call(
        ctx: Context<CpiOpenCall>,
        nonce: u64,
        input_hash: [u8; 32],
        open_answer: bool,
        fund_lamports: u64,
    ) -> Result<()> {
        if fund_lamports > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: ctx.accounts.caller.to_account_info(),
                    },
                ),
                fund_lamports,
            )?;
        }

        let authority_key = ctx.accounts.authority.key();
        let bump = [ctx.bumps.caller];
        let seeds: &[&[u8]] = &[b"caller", authority_key.as_ref(), &bump];
        let signer_seeds = &[seeds];

        let answer_mode = if open_answer {
            AnswerMode::Open
        } else {
            AnswerMode::Sealed
        };

        let cpi_accounts = OpenCall {
            payer: ctx.accounts.payer.to_account_info(),
            caller: ctx.accounts.caller.to_account_info(),
            config: ctx.accounts.config.to_account_info(),
            model: ctx.accounts.model.to_account_info(),
            enclave: ctx.accounts.enclave.to_account_info(),
            attestation_record: ctx.accounts.attestation_record.to_account_info(),
            grant: ctx.accounts.grant.to_account_info(),
            call: ctx.accounts.call.to_account_info(),
            mint: ctx.accounts.mint.as_ref().map(|a| a.to_account_info()),
            caller_tokens: ctx.accounts.caller_tokens.as_ref().map(|a| a.to_account_info()),
            escrow_tokens: ctx.accounts.escrow_tokens.as_ref().map(|a| a.to_account_info()),
            token_program: ctx.accounts.token_program.as_ref().map(|a| a.to_account_info()),
            associated_token_program: ctx.accounts.associated_token_program.as_ref().map(|a| a.to_account_info()),
            system_program: ctx.accounts.system_program.to_account_info(),
            event_authority: ctx.accounts.event_authority.to_account_info(),
            program: ctx.accounts.voynich_program.to_account_info(),
        };

        voynich_cpi::open_call(
            CpiContext::new_with_signer(
                ctx.accounts.voynich_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            nonce,
            input_hash,
            answer_mode,
        )
    }

    pub fn verify_receipt(ctx: Context<VerifyReceipt>, expected_open_answer: Vec<u8>) -> Result<()> {
        let parsed = voynich_cpi::read_receipt(
            &ctx.accounts.receipt.to_account_info(),
            &ctx.accounts.model.key(),
            &ctx.accounts.call.key(),
        )?;
        if !expected_open_answer.is_empty() {
            require!(
                parsed.answer_mode == AnswerMode::Open && parsed.open_answer == expected_open_answer,
                CpiCallerError::AnswerMismatch
            );
        }
        Ok(())
    }

    pub fn refund_call(ctx: Context<CpiRefundCall>) -> Result<()> {
        let authority_key = ctx.accounts.authority.key();
        let bump = [ctx.bumps.caller];
        let seeds: &[&[u8]] = &[b"caller", authority_key.as_ref(), &bump];
        let signer_seeds = &[seeds];

        let cpi_accounts = RefundCall {
            actor: ctx.accounts.caller.to_account_info(),
            call: ctx.accounts.call.to_account_info(),
            caller: ctx.accounts.caller.to_account_info(),
            escrow_tokens: ctx.accounts.escrow_tokens.as_ref().map(|a| a.to_account_info()),
            caller_tokens: ctx.accounts.caller_tokens.as_ref().map(|a| a.to_account_info()),
            token_program: ctx.accounts.token_program.as_ref().map(|a| a.to_account_info()),
            event_authority: ctx.accounts.event_authority.to_account_info(),
            program: ctx.accounts.voynich_program.to_account_info(),
        };

        voynich_cpi::refund_call(CpiContext::new_with_signer(
            ctx.accounts.voynich_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        ))
    }

    pub fn withdraw_sol(ctx: Context<WithdrawSol>, amount: u64) -> Result<()> {
        let authority_key = ctx.accounts.authority.key();
        let bump = [ctx.bumps.caller];
        let seeds: &[&[u8]] = &[b"caller", authority_key.as_ref(), &bump];
        let signer_seeds = &[seeds];

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.caller.to_account_info(),
                    to: ctx.accounts.authority.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )
    }

    pub fn withdraw_tokens(ctx: Context<WithdrawTokens>, amount: u64) -> Result<()> {
        let authority_key = ctx.accounts.authority.key();
        let bump = [ctx.bumps.caller];
        let seeds: &[&[u8]] = &[b"caller", authority_key.as_ref(), &bump];
        let signer_seeds = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.caller_tokens.to_account_info(),
                    to: ctx.accounts.authority_tokens.to_account_info(),
                    authority: ctx.accounts.caller.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )
    }
}

#[derive(Accounts)]
pub struct CpiOpenCall<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    pub authority: Signer<'info>,
    /// CHECK: system-owned caller PDA derived from authority; signs voynich::open_call via invoke_signed.
    #[account(mut, seeds = [b"caller", authority.key().as_ref()], bump)]
    pub caller: UncheckedAccount<'info>,
    /// CHECK: verified by voynich::open_call.
    pub config: UncheckedAccount<'info>,
    /// CHECK: verified by voynich::open_call.
    pub model: UncheckedAccount<'info>,
    /// CHECK: verified by voynich::open_call.
    pub enclave: UncheckedAccount<'info>,
    /// CHECK: verified by voynich::open_call.
    pub attestation_record: UncheckedAccount<'info>,
    /// CHECK: verified by voynich::open_call.
    pub grant: UncheckedAccount<'info>,
    /// CHECK: initialized by voynich::open_call.
    #[account(mut)] pub call: UncheckedAccount<'info>,
    /// CHECK: verified by voynich::open_call when SPL priced.
    pub mint: Option<UncheckedAccount<'info>>,
    /// CHECK: verified by voynich::open_call when SPL priced.
    #[account(mut)] pub caller_tokens: Option<UncheckedAccount<'info>>,
    /// CHECK: created/verified by voynich::open_call when SPL priced.
    #[account(mut)] pub escrow_tokens: Option<UncheckedAccount<'info>>,
    /// CHECK: verified by voynich::open_call when SPL priced.
    pub token_program: Option<UncheckedAccount<'info>>,
    /// CHECK: verified by voynich::open_call when SPL priced.
    pub associated_token_program: Option<UncheckedAccount<'info>>,
    pub system_program: Program<'info, System>,
    /// CHECK: voynich emit_cpi event authority PDA.
    pub event_authority: UncheckedAccount<'info>,
    pub voynich_program: Program<'info, Voynich>,
}

#[derive(Accounts)]
pub struct VerifyReceipt<'info> {
    /// CHECK: verified by voynich_cpi::read_receipt (owner, PDA, discriminator, layout, model, call).
    pub receipt: UncheckedAccount<'info>,
    /// CHECK: expected Voynich model address checked against Receipt.model.
    pub model: UncheckedAccount<'info>,
    /// CHECK: expected Voynich call address checked against Receipt.call and Receipt PDA.
    pub call: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CpiRefundCall<'info> {
    pub authority: Signer<'info>,
    /// CHECK: system-owned caller PDA derived from authority.
    #[account(mut, seeds = [b"caller", authority.key().as_ref()], bump)]
    pub caller: UncheckedAccount<'info>,
    /// CHECK: verified by voynich::refund_call.
    #[account(mut)] pub call: UncheckedAccount<'info>,
    /// CHECK: verified by voynich::refund_call when SPL priced.
    #[account(mut)] pub escrow_tokens: Option<UncheckedAccount<'info>>,
    /// CHECK: verified by voynich::refund_call when SPL priced.
    #[account(mut)] pub caller_tokens: Option<UncheckedAccount<'info>>,
    /// CHECK: verified by voynich::refund_call when SPL priced.
    pub token_program: Option<UncheckedAccount<'info>>,
    /// CHECK: voynich emit_cpi event authority PDA.
    pub event_authority: UncheckedAccount<'info>,
    pub voynich_program: Program<'info, Voynich>,
}

#[derive(Accounts)]
pub struct WithdrawSol<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    /// CHECK: system-owned caller PDA derived from authority.
    #[account(mut, seeds = [b"caller", authority.key().as_ref()], bump)]
    pub caller: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawTokens<'info> {
    pub authority: Signer<'info>,
    /// CHECK: system-owned caller PDA derived from authority.
    #[account(seeds = [b"caller", authority.key().as_ref()], bump)]
    pub caller: UncheckedAccount<'info>,
    #[account(mut)] pub caller_tokens: Account<'info, TokenAccount>,
    #[account(mut)] pub authority_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
