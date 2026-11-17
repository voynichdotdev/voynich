use anchor_lang::{prelude::*, system_program};
use anchor_spl::{associated_token, token::{self, CloseAccount, Token, TokenAccount, Transfer}};
use crate::{contexts::{OpenCall, RefundCall, SettleCall, SettleMeteredCall}, errors::VoynichError, state::Call};

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

pub fn settle(ctx: &Context<SettleCall>, owner_amount: u64, operator_amount: u64, protocol_amount: u64) -> Result<()> {
    let call = &ctx.accounts.call;
    require_keys_eq!(ctx.accounts.owner.key(), call.owner, VoynichError::InvalidRecipient);
    require_keys_eq!(ctx.accounts.operator.key(), call.operator, VoynichError::InvalidRecipient);
    require_keys_eq!(ctx.accounts.fee_recipient.key(), call.fee_recipient, VoynichError::InvalidRecipient);
    require_keys_eq!(ctx.accounts.caller.key(), call.caller, VoynichError::InvalidRecipient);
    if call.price_mint == Pubkey::default() {
        native(&call.to_account_info(), &ctx.accounts.owner.to_account_info(), owner_amount)?;
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
        transfer_tokens(program, call, escrow, owner, owner_amount)?;
        transfer_tokens(program, call, escrow, operator, operator_amount)?;
        transfer_tokens(program, call, escrow, protocol, protocol_amount)?;
        // Unsolicited deposits cannot prevent settlement or strand a token balance.
        transfer_tokens(program, call, escrow, caller, escrow.amount - call.price)?;
        close_tokens(program, call, escrow, &ctx.accounts.caller.to_account_info())?;
    }
    Ok(())
}

pub fn settle_metered(
    ctx: &Context<SettleMeteredCall>,
    total: u64,
    owner_amount: u64,
    operator_amount: u64,
    protocol_amount: u64,
    returned_amount: u64,
) -> Result<()> {
    let call = &ctx.accounts.call;
    require_keys_eq!(ctx.accounts.owner.key(), call.owner, VoynichError::InvalidRecipient);
    require_keys_eq!(ctx.accounts.operator.key(), call.operator, VoynichError::InvalidRecipient);
    require_keys_eq!(ctx.accounts.fee_recipient.key(), call.fee_recipient, VoynichError::InvalidRecipient);
    require_keys_eq!(ctx.accounts.caller.key(), call.caller, VoynichError::InvalidRecipient);
    if call.price_mint == Pubkey::default() {
        native(&call.to_account_info(), &ctx.accounts.owner.to_account_info(), owner_amount)?;
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
        transfer_tokens(program, call, escrow, owner, owner_amount)?;
        transfer_tokens(program, call, escrow, operator, operator_amount)?;
        transfer_tokens(program, call, escrow, protocol, protocol_amount)?;
        transfer_tokens(program, call, escrow, caller, refund_tokens)?;
        close_tokens(program, call, escrow, &ctx.accounts.caller.to_account_info())?;
    }
    Ok(())
}

pub fn refund(ctx: &Context<RefundCall>) -> Result<()> {
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
