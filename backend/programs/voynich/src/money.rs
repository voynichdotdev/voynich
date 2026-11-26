use anchor_lang::{prelude::*, system_program};
use anchor_spl::{associated_token, token::{self, CloseAccount, Token, TokenAccount, Transfer}};
use crate::{contexts::{BuyPass, ClaimSplit, ClosePass, CloseSession, DepositBond, OpenCall, OpenPassCall, OpenSession, OpenSessionCall, RefundCall, SettleCall, SettleMeteredCall, WithdrawBond}, errors::VoynichError, state::{Call, Pass, Session}};

fn token_account(account: &Account<TokenAccount>, owner: Pubkey, mint: Pubkey, associated: bool) -> Result<()> {
    require_keys_eq!(account.owner, owner, VoynichError::InvalidTokenAccount);
    require_keys_eq!(account.mint, mint, VoynichError::InvalidTokenAccount);
    if associated { require_keys_eq!(account.key(), associated_token::get_associated_token_address(&owner, &mint), VoynichError::InvalidTokenAccount); }
    Ok(())
}

pub fn deposit(ctx: &Context<OpenCall>) -> Result<()> {
    let call = &ctx.accounts.call;
    let amount = call.escrow_amount();
    if call.price_mint == Pubkey::default() {
        system_program::transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer {
            from: ctx.accounts.caller.to_account_info(), to: call.to_account_info(),
        }), amount)?;
    } else {
        let mint = ctx.accounts.mint.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let source = ctx.accounts.caller_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let escrow = ctx.accounts.escrow_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let program = ctx.accounts.token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let ata_program = ctx.accounts.associated_token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        require_keys_eq!(mint.key(), call.price_mint, VoynichError::InvalidTokenAccount);
        token_account(source, call.caller, call.price_mint, false)?;
        require_keys_eq!(escrow.key(), associated_token::get_associated_token_address(&call.key(), &call.price_mint), VoynichError::InvalidTokenAccount);
        // Anyone can pre-create the ATA of a predictable call PDA.
        associated_token::create_idempotent(CpiContext::new(ata_program.to_account_info(), associated_token::Create {
            payer: ctx.accounts.payer.to_account_info(), associated_token: escrow.to_account_info(), authority: call.to_account_info(),
            mint: mint.to_account_info(), system_program: ctx.accounts.system_program.to_account_info(), token_program: program.to_account_info(),
        }))?;
        token::transfer(CpiContext::new(program.to_account_info(), Transfer { from: source.to_account_info(), to: escrow.to_account_info(), authority: ctx.accounts.caller.to_account_info() }), amount)?;
    }
    Ok(())
}

fn native(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 { return Ok(()); }
    require!(from.lamports() >= Rent::get()?.minimum_balance(from.data_len()).checked_add(amount).ok_or(VoynichError::ArithmeticOverflow)?, VoynichError::InsufficientEscrow);
    // Separate borrows support recipients that share one wallet.
    let balance = from.lamports().checked_sub(amount).ok_or(VoynichError::InsufficientEscrow)?;
    **from.try_borrow_mut_lamports()? = balance;
    let balance = to.lamports().checked_add(amount).ok_or(VoynichError::ArithmeticOverflow)?;
    **to.try_borrow_mut_lamports()? = balance;
    Ok(())
}

fn transfer_tokens<'info>(program: &Program<'info, Token>, call: &Account<'info, Call>, escrow: &Account<'info, TokenAccount>, destination: &Account<'info, TokenAccount>, amount: u64) -> Result<()> {
    if amount == 0 { return Ok(()); }
    let nonce = call.nonce.to_le_bytes();
    let bump = [call.bump];
    let seeds = [b"call".as_ref(), call.caller.as_ref(), nonce.as_ref(), bump.as_ref()];
    token::transfer(CpiContext::new_with_signer(program.to_account_info(), Transfer { from: escrow.to_account_info(), to: destination.to_account_info(), authority: call.to_account_info() }, &[&seeds]), amount)
}

fn close_tokens<'info>(program: &Program<'info, Token>, call: &Account<'info, Call>, escrow: &Account<'info, TokenAccount>, caller: &AccountInfo<'info>) -> Result<()> {
    let nonce = call.nonce.to_le_bytes();
    let bump = [call.bump];
    let seeds = [b"call".as_ref(), call.caller.as_ref(), nonce.as_ref(), bump.as_ref()];
    token::close_account(CpiContext::new_with_signer(program.to_account_info(), CloseAccount { account: escrow.to_account_info(), destination: caller.clone(), authority: call.to_account_info() }, &[&seeds]))
}

pub fn settle<'info>(
    ctx: &Context<'_, '_, 'info, 'info, SettleCall<'info>>,
    owner_amount: u64,
    operator_amount: u64,
    protocol_amount: u64,
    split_target: Option<(&'info AccountInfo<'info>, Option<&'info AccountInfo<'info>>)>,
) -> Result<()> {
    let call = &ctx.accounts.call;
    require_keys_eq!(ctx.accounts.owner.key(), call.owner, VoynichError::InvalidRecipient);
    require_keys_eq!(ctx.accounts.operator.key(), call.operator, VoynichError::InvalidRecipient);
    require_keys_eq!(ctx.accounts.fee_recipient.key(), call.fee_recipient, VoynichError::InvalidRecipient);
    require_keys_eq!(ctx.accounts.caller.key(), call.caller, VoynichError::InvalidRecipient);
    if call.price_mint == Pubkey::default() {
        if let Some((split_info, _)) = split_target {
            native(&call.to_account_info(), split_info, owner_amount)?;
        } else {
            native(&call.to_account_info(), &ctx.accounts.owner.to_account_info(), owner_amount)?;
        }
        native(&call.to_account_info(), &ctx.accounts.operator.to_account_info(), operator_amount)?;
        native(&call.to_account_info(), &ctx.accounts.fee_recipient.to_account_info(), protocol_amount)?;
    } else {
        let program = ctx.accounts.token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let escrow = ctx.accounts.escrow_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let owner = ctx.accounts.owner_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let operator = ctx.accounts.operator_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let protocol = ctx.accounts.protocol_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let caller = ctx.accounts.caller_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        token_account(escrow, call.key(), call.price_mint, true)?;
        token_account(owner, call.owner, call.price_mint, true)?;
        token_account(operator, call.operator, call.price_mint, true)?;
        token_account(protocol, call.fee_recipient, call.price_mint, true)?;
        token_account(caller, call.caller, call.price_mint, false)?;
        require!(escrow.amount >= call.price, VoynichError::InsufficientEscrow);
        if let Some((split_info, split_ata_opt)) = split_target {
            let split_ata_info = split_ata_opt.ok_or(VoynichError::InvalidSplit)?;
            let split_ata = Account::<TokenAccount>::try_from(split_ata_info).map_err(|_| error!(VoynichError::InvalidSplit))?;
            token_account(&split_ata, split_info.key(), call.price_mint, true)?;
            transfer_tokens(program, call, escrow, &split_ata, owner_amount)?;
        } else {
            transfer_tokens(program, call, escrow, owner, owner_amount)?;
        }
        transfer_tokens(program, call, escrow, operator, operator_amount)?;
        transfer_tokens(program, call, escrow, protocol, protocol_amount)?;
        // Unsolicited deposits cannot prevent settlement or strand a token balance.
        transfer_tokens(program, call, escrow, caller, escrow.amount - call.price)?;
        close_tokens(program, call, escrow, &ctx.accounts.caller.to_account_info())?;
    }
    Ok(())
}

pub fn settle_metered<'info>(
    ctx: &Context<'_, '_, 'info, 'info, SettleMeteredCall<'info>>,
    total: u64,
    owner_amount: u64,
    operator_amount: u64,
    protocol_amount: u64,
    returned_amount: u64,
    split_target: Option<(&'info AccountInfo<'info>, Option<&'info AccountInfo<'info>>)>,
) -> Result<()> {
    let call = &ctx.accounts.call;
    require_keys_eq!(ctx.accounts.owner.key(), call.owner, VoynichError::InvalidRecipient);
    require_keys_eq!(ctx.accounts.operator.key(), call.operator, VoynichError::InvalidRecipient);
    require_keys_eq!(ctx.accounts.fee_recipient.key(), call.fee_recipient, VoynichError::InvalidRecipient);
    require_keys_eq!(ctx.accounts.caller.key(), call.caller, VoynichError::InvalidRecipient);
    if call.price_mint == Pubkey::default() {
        if let Some((split_info, _)) = split_target {
            native(&call.to_account_info(), split_info, owner_amount)?;
        } else {
            native(&call.to_account_info(), &ctx.accounts.owner.to_account_info(), owner_amount)?;
        }
        native(&call.to_account_info(), &ctx.accounts.operator.to_account_info(), operator_amount)?;
        native(&call.to_account_info(), &ctx.accounts.fee_recipient.to_account_info(), protocol_amount)?;
        native(&call.to_account_info(), &ctx.accounts.caller.to_account_info(), returned_amount)?;
    } else {
        let program = ctx.accounts.token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let escrow = ctx.accounts.escrow_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let owner = ctx.accounts.owner_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let operator = ctx.accounts.operator_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let protocol = ctx.accounts.protocol_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let caller = ctx.accounts.caller_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        token_account(escrow, call.key(), call.price_mint, true)?;
        token_account(owner, call.owner, call.price_mint, true)?;
        token_account(operator, call.operator, call.price_mint, true)?;
        token_account(protocol, call.fee_recipient, call.price_mint, true)?;
        token_account(caller, call.caller, call.price_mint, false)?;
        require!(escrow.amount >= call.ceiling, VoynichError::InsufficientEscrow);
        let refund_tokens = escrow.amount.checked_sub(total).ok_or(VoynichError::InsufficientEscrow)?;
        if let Some((split_info, split_ata_opt)) = split_target {
            let split_ata_info = split_ata_opt.ok_or(VoynichError::InvalidSplit)?;
            let split_ata = Account::<TokenAccount>::try_from(split_ata_info).map_err(|_| error!(VoynichError::InvalidSplit))?;
            token_account(&split_ata, split_info.key(), call.price_mint, true)?;
            transfer_tokens(program, call, escrow, &split_ata, owner_amount)?;
        } else {
            transfer_tokens(program, call, escrow, owner, owner_amount)?;
        }
        transfer_tokens(program, call, escrow, operator, operator_amount)?;
        transfer_tokens(program, call, escrow, protocol, protocol_amount)?;
        transfer_tokens(program, call, escrow, caller, refund_tokens)?;
        close_tokens(program, call, escrow, &ctx.accounts.caller.to_account_info())?;
    }
    Ok(())
}

pub fn refund<'info>(ctx: &Context<'_, '_, 'info, 'info, RefundCall<'info>>) -> Result<()> {
    let call = &ctx.accounts.call;
    let amount = call.escrow_amount();
    require_keys_eq!(ctx.accounts.caller.key(), call.caller, VoynichError::InvalidRecipient);
    if call.price_mint == Pubkey::default() {
        native(&call.to_account_info(), &ctx.accounts.caller.to_account_info(), amount)?;
    } else {
        let program = ctx.accounts.token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let escrow = ctx.accounts.escrow_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let destination = ctx.accounts.caller_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        token_account(escrow, call.key(), call.price_mint, true)?;
        token_account(destination, call.caller, call.price_mint, false)?;
        require!(escrow.amount >= amount, VoynichError::InsufficientEscrow);
        transfer_tokens(program, call, escrow, destination, escrow.amount)?;
        close_tokens(program, call, escrow, &ctx.accounts.caller.to_account_info())?;
    }
    Ok(())
}

fn transfer_session_tokens<'info>(
    program: &Program<'info, Token>,
    session: &Account<'info, Session>,
    escrow: &Account<'info, TokenAccount>,
    destination: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 { return Ok(()); }
    let nonce = session.nonce.to_le_bytes();
    let bump = [session.bump];
    let seeds = [b"session".as_ref(), session.caller.as_ref(), session.delegate.as_ref(), nonce.as_ref(), bump.as_ref()];
    token::transfer(
        CpiContext::new_with_signer(
            program.to_account_info(),
            Transfer { from: escrow.to_account_info(), to: destination.clone(), authority: session.to_account_info() },
            &[&seeds],
        ),
        amount,
    )
}

fn close_session_tokens<'info>(
    program: &Program<'info, Token>,
    session: &Account<'info, Session>,
    escrow: &Account<'info, TokenAccount>,
    caller: &AccountInfo<'info>,
) -> Result<()> {
    let nonce = session.nonce.to_le_bytes();
    let bump = [session.bump];
    let seeds = [b"session".as_ref(), session.caller.as_ref(), session.delegate.as_ref(), nonce.as_ref(), bump.as_ref()];
    token::close_account(CpiContext::new_with_signer(
        program.to_account_info(),
        CloseAccount { account: escrow.to_account_info(), destination: caller.clone(), authority: session.to_account_info() },
        &[&seeds],
    ))
}

pub fn deposit_session(ctx: &Context<OpenSession>, budget: u64, delegate_gas_lamports: u64) -> Result<()> {
    let session = &ctx.accounts.session;
    if delegate_gas_lamports > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.caller.to_account_info(),
                    to: ctx.accounts.delegate.to_account_info(),
                },
            ),
            delegate_gas_lamports,
        )?;
    }
    if session.mint == Pubkey::default() {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.caller.to_account_info(),
                    to: session.to_account_info(),
                },
            ),
            budget,
        )?;
    } else {
        let mint = ctx.accounts.mint.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let source = ctx.accounts.caller_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let escrow = ctx.accounts.session_escrow.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let program = ctx.accounts.token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let ata_program = ctx.accounts.associated_token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        require_keys_eq!(mint.key(), session.mint, VoynichError::InvalidTokenAccount);
        token_account(source, session.caller, session.mint, false)?;
        require_keys_eq!(escrow.key(), associated_token::get_associated_token_address(&session.key(), &session.mint), VoynichError::InvalidTokenAccount);
        associated_token::create_idempotent(CpiContext::new(ata_program.to_account_info(), associated_token::Create {
            payer: ctx.accounts.caller.to_account_info(),
            associated_token: escrow.to_account_info(),
            authority: session.to_account_info(),
            mint: mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: program.to_account_info(),
        }))?;
        token::transfer(
            CpiContext::new(program.to_account_info(), Transfer { from: source.to_account_info(), to: escrow.to_account_info(), authority: ctx.accounts.caller.to_account_info() }),
            budget,
        )?;
    }
    Ok(())
}

pub fn deposit_from_session(ctx: &Context<OpenSessionCall>, amount: u64) -> Result<()> {
    let session = &ctx.accounts.session;
    let call = &ctx.accounts.call;
    if call.price_mint == Pubkey::default() {
        native(&session.to_account_info(), &call.to_account_info(), amount)?;
    } else {
        let mint = ctx.accounts.mint.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let source = ctx.accounts.session_escrow.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let escrow = ctx.accounts.escrow_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let program = ctx.accounts.token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let ata_program = ctx.accounts.associated_token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        require_keys_eq!(mint.key(), call.price_mint, VoynichError::InvalidTokenAccount);
        token_account(source, session.key(), call.price_mint, true)?;
        require_keys_eq!(escrow.key(), associated_token::get_associated_token_address(&call.key(), &call.price_mint), VoynichError::InvalidTokenAccount);
        associated_token::create_idempotent(CpiContext::new(ata_program.to_account_info(), associated_token::Create {
            payer: ctx.accounts.delegate.to_account_info(),
            associated_token: escrow.to_account_info(),
            authority: call.to_account_info(),
            mint: mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: program.to_account_info(),
        }))?;
        transfer_session_tokens(program, session, source, &escrow.to_account_info(), amount)?;
    }
    Ok(())
}

pub fn close_session_escrow(ctx: &Context<CloseSession>, remaining: u64) -> Result<u64> {
    let session = &ctx.accounts.session;
    require_keys_eq!(ctx.accounts.caller.key(), session.caller, VoynichError::InvalidRecipient);
    if session.mint == Pubkey::default() {
        native(&session.to_account_info(), &ctx.accounts.caller.to_account_info(), remaining)?;
        Ok(remaining)
    } else {
        let program = ctx.accounts.token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let escrow = ctx.accounts.session_escrow.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let destination = ctx.accounts.caller_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        token_account(escrow, session.key(), session.mint, true)?;
        token_account(destination, session.caller, session.mint, false)?;
        let amount = escrow.amount;
        transfer_session_tokens(program, session, escrow, &destination.to_account_info(), amount)?;
        close_session_tokens(program, session, escrow, &ctx.accounts.caller.to_account_info())?;
        Ok(amount)
    }
}

pub fn claim_split_payout(ctx: &Context<ClaimSplit>, amount: u64) -> Result<()> {
    let split = &ctx.accounts.split;
    if split.mint == Pubkey::default() {
        native(&split.to_account_info(), &ctx.accounts.recipient.to_account_info(), amount)?;
    } else {
        let program = ctx.accounts.token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let escrow = ctx.accounts.split_escrow.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let destination = ctx.accounts.recipient_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        token_account(escrow, split.key(), split.mint, true)?;
        token_account(destination, ctx.accounts.recipient.key(), split.mint, false)?;
        let bump = [split.bump];
        let seeds = [b"split".as_ref(), split.model.as_ref(), bump.as_ref()];
        token::transfer(
            CpiContext::new_with_signer(
                program.to_account_info(),
                Transfer {
                    from: escrow.to_account_info(),
                    to: destination.to_account_info(),
                    authority: split.to_account_info(),
                },
                &[&seeds],
            ),
            amount,
        )?;
    }
    Ok(())
}

pub fn deposit_bond(ctx: &Context<DepositBond>, amount: u64) -> Result<()> {
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.operator.to_account_info(),
                to: ctx.accounts.bond.to_account_info(),
            },
        ),
        amount,
    )
}

pub fn withdraw_bond(ctx: &Context<WithdrawBond>, amount: u64) -> Result<()> {
    native(&ctx.accounts.bond.to_account_info(), &ctx.accounts.operator.to_account_info(), amount)
}

pub fn slash_bond(bond_info: &AccountInfo, caller_info: &AccountInfo, amount: u64) -> Result<()> {
    native(bond_info, caller_info, amount)
}

fn transfer_pass_tokens<'info>(
    program: &Program<'info, Token>,
    pass: &Account<'info, Pass>,
    from: &Account<'info, TokenAccount>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let nonce_bytes = pass.nonce.to_le_bytes();
    let bump = [pass.bump];
    let seeds = [
        b"pass".as_ref(),
        pass.model.as_ref(),
        pass.holder.as_ref(),
        nonce_bytes.as_ref(),
        bump.as_ref(),
    ];
    token::transfer(
        CpiContext::new_with_signer(
            program.to_account_info(),
            Transfer { from: from.to_account_info(), to: to.clone(), authority: pass.to_account_info() },
            &[&seeds],
        ),
        amount,
    )
}

fn close_pass_tokens<'info>(
    program: &Program<'info, Token>,
    pass: &Account<'info, Pass>,
    escrow: &Account<'info, TokenAccount>,
    destination: &AccountInfo<'info>,
) -> Result<()> {
    let nonce_bytes = pass.nonce.to_le_bytes();
    let bump = [pass.bump];
    let seeds = [
        b"pass".as_ref(),
        pass.model.as_ref(),
        pass.holder.as_ref(),
        nonce_bytes.as_ref(),
        bump.as_ref(),
    ];
    token::close_account(CpiContext::new_with_signer(
        program.to_account_info(),
        CloseAccount {
            account: escrow.to_account_info(),
            destination: destination.clone(),
            authority: pass.to_account_info(),
        },
        &[&seeds],
    ))
}

pub fn deposit_pass(ctx: &Context<BuyPass>, amount: u64) -> Result<()> {
    let pass = &ctx.accounts.pass;
    if pass.mint == Pubkey::default() {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.holder.to_account_info(),
                    to: pass.to_account_info(),
                },
            ),
            amount,
        )?;
    } else {
        let mint = ctx.accounts.mint.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let source = ctx.accounts.holder_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let escrow = ctx.accounts.pass_escrow.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let program = ctx.accounts.token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let ata_program = ctx.accounts.associated_token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        require_keys_eq!(mint.key(), pass.mint, VoynichError::InvalidTokenAccount);
        token_account(source, pass.holder, pass.mint, false)?;
        require_keys_eq!(escrow.key(), associated_token::get_associated_token_address(&pass.key(), &pass.mint), VoynichError::InvalidTokenAccount);
        associated_token::create_idempotent(CpiContext::new(ata_program.to_account_info(), associated_token::Create {
            payer: ctx.accounts.holder.to_account_info(),
            associated_token: escrow.to_account_info(),
            authority: pass.to_account_info(),
            mint: mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: program.to_account_info(),
        }))?;
        token::transfer(
            CpiContext::new(
                program.to_account_info(),
                Transfer {
                    from: source.to_account_info(),
                    to: escrow.to_account_info(),
                    authority: ctx.accounts.holder.to_account_info(),
                },
            ),
            amount,
        )?;
    }
    Ok(())
}

pub fn deposit_from_pass(ctx: &Context<OpenPassCall>, amount: u64) -> Result<()> {
    let pass = &ctx.accounts.pass;
    let call = &ctx.accounts.call;
    if call.price_mint == Pubkey::default() {
        native(&pass.to_account_info(), &call.to_account_info(), amount)?;
    } else {
        let mint = ctx.accounts.mint.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let source = ctx.accounts.pass_escrow.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let escrow = ctx.accounts.escrow_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let program = ctx.accounts.token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let ata_program = ctx.accounts.associated_token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        require_keys_eq!(mint.key(), call.price_mint, VoynichError::InvalidTokenAccount);
        token_account(source, pass.key(), call.price_mint, true)?;
        require_keys_eq!(escrow.key(), associated_token::get_associated_token_address(&call.key(), &call.price_mint), VoynichError::InvalidTokenAccount);
        associated_token::create_idempotent(CpiContext::new(ata_program.to_account_info(), associated_token::Create {
            payer: ctx.accounts.holder.to_account_info(),
            associated_token: escrow.to_account_info(),
            authority: call.to_account_info(),
            mint: mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: program.to_account_info(),
        }))?;
        transfer_pass_tokens(program, pass, source, &escrow.to_account_info(), amount)?;
    }
    Ok(())
}

pub fn close_pass_escrow(ctx: &Context<ClosePass>, remaining: u64) -> Result<u64> {
    let pass = &ctx.accounts.pass;
    require_keys_eq!(ctx.accounts.holder.key(), pass.holder, VoynichError::InvalidRecipient);
    if pass.mint == Pubkey::default() {
        native(&pass.to_account_info(), &ctx.accounts.holder.to_account_info(), remaining)?;
        Ok(remaining)
    } else {
        let program = ctx.accounts.token_program.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let escrow = ctx.accounts.pass_escrow.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        let destination = ctx.accounts.holder_tokens.as_ref().ok_or(VoynichError::InvalidTokenAccount)?;
        token_account(escrow, pass.key(), pass.mint, true)?;
        token_account(destination, pass.holder, pass.mint, false)?;
        let amount = escrow.amount;
        transfer_pass_tokens(program, pass, escrow, &destination.to_account_info(), amount)?;
        close_pass_tokens(program, pass, escrow, &ctx.accounts.holder.to_account_info())?;
        Ok(amount)
    }
}
