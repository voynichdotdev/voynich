use anchor_lang::{prelude::*, system_program, Discriminator};
use anchor_spl::{
    associated_token::{self, AssociatedToken},
    token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer},
};
use voynich_cpi::{AnswerMode, CallbackAccount, CallbackSpec, OpenCall, RefundCall, Voynich};

declare_id!("8Sm13coiVCjiHAp6NNvuJv36xcFqLN84ykZgqYBmX2ws");

pub const MAX_LABEL_BYTES: usize = 32;

#[error_code]
pub enum BountyError {
    #[msg("Target label must be 1 to 32 UTF-8 bytes.")]
    InvalidLabel,
    #[msg("Bounty amount must be greater than zero.")]
    InvalidAmount,
    #[msg("Model account is not owned by the Voynich program or has invalid data.")]
    InvalidModel,
    #[msg("Bounty is no longer open.")]
    BountyNotOpen,
    #[msg("Only the bounty creator can perform this action.")]
    Unauthorized,
    #[msg("Provided token account or mint does not match the bounty or model.")]
    InvalidTokenAccount,
    #[msg("Receipt is not an open answer or does not carry a valid top-level label.")]
    InvalidOpenAnswer,
    #[msg("Receipt label does not match the bounty target label.")]
    LabelMismatch,
    #[msg("Bounty escrow balance is insufficient.")]
    InsufficientEscrow,
    #[msg("Call account does not match the attempt or Voynich program.")]
    InvalidCall,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum BountyStatus {
    Open,
    Claimed,
    Cancelled,
}

#[account]
pub struct Bounty {
    pub creator: Pubkey,
    pub nonce: u64,
    pub model: Pubkey,
    pub target_label: String,
    /// Pubkey::default() denotes native SOL.
    pub mint: Pubkey,
    pub amount: u64,
    pub status: BountyStatus,
    pub winner: Pubkey,
    pub winning_call: Pubkey,
    pub winning_receipt: Pubkey,
    pub created_slot: u64,
    pub claimed_slot: u64,
    pub attempts: u64,
    pub bump: u8,
}

impl Bounty {
    pub const SPACE: usize = 8 + 32 * 6 + 8 * 5 + 4 + MAX_LABEL_BYTES + 1 + 1;
}

#[account]
pub struct Attempt {
    pub bounty: Pubkey,
    pub drawer: Pubkey,
    pub call: Pubkey,
    pub created_slot: u64,
    pub bump: u8,
}

impl Attempt {
    pub const SPACE: usize = 8 + 32 * 3 + 8 + 1;
}

#[event]
pub struct BountyPosted {
    pub bounty: Pubkey,
    pub creator: Pubkey,
    pub nonce: u64,
    pub model: Pubkey,
    pub target_label: String,
    pub mint: Pubkey,
    pub amount: u64,
    pub slot: u64,
}

#[event]
pub struct BountyDrawn {
    pub bounty: Pubkey,
    pub attempt: Pubkey,
    pub drawer: Pubkey,
    pub call: Pubkey,
    pub caller: Pubkey,
    pub model: Pubkey,
    pub enclave: Pubkey,
    pub input_hash: [u8; 32],
    pub slot: u64,
}

#[event]
pub struct BountyCollected {
    pub bounty: Pubkey,
    pub attempt: Pubkey,
    pub winner: Pubkey,
    pub call: Pubkey,
    pub receipt: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub label: String,
    pub slot: u64,
}

#[event]
pub struct BountyCancelled {
    pub bounty: Pubkey,
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub slot: u64,
}

#[event]
pub struct AttemptRefunded {
    pub bounty: Pubkey,
    pub attempt: Pubkey,
    pub drawer: Pubkey,
    pub call: Pubkey,
    pub price_mint: Pubkey,
    pub amount: u64,
    pub slot: u64,
}

fn check_token_account(account: &Account<TokenAccount>, owner: Pubkey, mint: Pubkey, associated: bool) -> Result<()> {
    require_keys_eq!(account.owner, owner, BountyError::InvalidTokenAccount);
    require_keys_eq!(account.mint, mint, BountyError::InvalidTokenAccount);
    if associated {
        require_keys_eq!(
            account.key(),
            associated_token::get_associated_token_address(&owner, &mint),
            BountyError::InvalidTokenAccount
        );
    }
    Ok(())
}

fn pay_native_from_pda(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let min_balance = Rent::get()?.minimum_balance(from.data_len());
    let required = min_balance.checked_add(amount).ok_or(BountyError::ArithmeticOverflow)?;
    require!(from.lamports() >= required, BountyError::InsufficientEscrow);
    let after_from = from.lamports().checked_sub(amount).ok_or(BountyError::InsufficientEscrow)?;
    **from.try_borrow_mut_lamports()? = after_from;
    let after_to = to.lamports().checked_add(amount).ok_or(BountyError::ArithmeticOverflow)?;
    **to.try_borrow_mut_lamports()? = after_to;
    Ok(())
}

/// Extracts the top-level `"label"` string value from a JSON object payload without serde_json.
pub fn parse_top_level_label(bytes: &[u8]) -> Option<String> {
    let mut i = skip_ws(bytes, 0);
    if *bytes.get(i)? != b'{' {
        return None;
    }
    i = skip_ws(bytes, i + 1);
    if *bytes.get(i)? == b'}' {
        return None;
    }
    loop {
        let (key, next) = parse_json_string(bytes, i)?;
        i = skip_ws(bytes, next);
        if *bytes.get(i)? != b':' {
            return None;
        }
        i = skip_ws(bytes, i + 1);
        if key == "label" {
            let (value, _) = parse_json_string(bytes, i)?;
            return Some(value);
        }
        i = skip_json_value(bytes, i)?;
        i = skip_ws(bytes, i);
        match *bytes.get(i)? {
            b',' => i = skip_ws(bytes, i + 1),
            b'}' => return None,
            _ => return None,
        }
    }
}

fn skip_ws(bytes: &[u8], mut i: usize) -> usize {
    while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | b'\n' | b'\r') {
        i += 1;
    }
    i
}

fn parse_json_string(bytes: &[u8], start: usize) -> Option<(String, usize)> {
    if *bytes.get(start)? != b'"' {
        return None;
    }
    let mut i = start + 1;
    let mut out = Vec::new();
    while i < bytes.len() {
        match bytes[i] {
            b'"' => {
                let s = String::from_utf8(out).ok()?;
                return Some((s, i + 1));
            }
            b'\\' => {
                i += 1;
                let esc = *bytes.get(i)?;
                match esc {
                    b'"' => out.push(b'"'),
                    b'\\' => out.push(b'\\'),
                    b'/' => out.push(b'/'),
                    b'b' => out.push(0x08),
                    b'f' => out.push(0x0c),
                    b'n' => out.push(b'\n'),
                    b'r' => out.push(b'\r'),
                    b't' => out.push(b'\t'),
                    b'u' => {
                        if i + 4 >= bytes.len() {
                            return None;
                        }
                        let hex = core::str::from_utf8(&bytes[i + 1..i + 5]).ok()?;
                        let code = u16::from_str_radix(hex, 16).ok()?;
                        let ch = char::from_u32(u32::from(code))?;
                        let mut buf = [0u8; 4];
                        out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                        i += 4;
                    }
                    _ => return None,
                }
                i += 1;
            }
            b if b < 0x20 => return None,
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    None
}

fn skip_json_value(bytes: &[u8], start: usize) -> Option<usize> {
    let i = skip_ws(bytes, start);
    let b = *bytes.get(i)?;
    match b {
        b'"' => parse_json_string(bytes, i).map(|(_, next)| next),
        b'{' => {
            let mut cur = skip_ws(bytes, i + 1);
            if *bytes.get(cur)? == b'}' {
                return Some(cur + 1);
            }
            loop {
                let (_, after_key) = parse_json_string(bytes, cur)?;
                cur = skip_ws(bytes, after_key);
                if *bytes.get(cur)? != b':' {
                    return None;
                }
                cur = skip_json_value(bytes, cur + 1)?;
                cur = skip_ws(bytes, cur);
                match *bytes.get(cur)? {
                    b',' => cur = skip_ws(bytes, cur + 1),
                    b'}' => return Some(cur + 1),
                    _ => return None,
                }
            }
        }
        b'[' => {
            let mut cur = skip_ws(bytes, i + 1);
            if *bytes.get(cur)? == b']' {
                return Some(cur + 1);
            }
            loop {
                cur = skip_json_value(bytes, cur)?;
                cur = skip_ws(bytes, cur);
                match *bytes.get(cur)? {
                    b',' => cur = skip_ws(bytes, cur + 1),
                    b']' => return Some(cur + 1),
                    _ => return None,
                }
            }
        }
        b't' => (bytes.get(i..i + 4) == Some(b"true")).then_some(i + 4),
        b'f' => (bytes.get(i..i + 5) == Some(b"false")).then_some(i + 5),
        b'n' => (bytes.get(i..i + 4) == Some(b"null")).then_some(i + 4),
        b'-' | b'0'..=b'9' => {
            let mut cur = i;
            if bytes[cur] == b'-' {
                cur += 1;
            }
            let digits_start = cur;
            while cur < bytes.len() && bytes[cur].is_ascii_digit() {
                cur += 1;
            }
            if cur == digits_start {
                return None;
            }
            if cur < bytes.len() && bytes[cur] == b'.' {
                cur += 1;
                let frac_start = cur;
                while cur < bytes.len() && bytes[cur].is_ascii_digit() {
                    cur += 1;
                }
                if cur == frac_start {
                    return None;
                }
            }
            if cur < bytes.len() && matches!(bytes[cur], b'e' | b'E') {
                cur += 1;
                if cur < bytes.len() && matches!(bytes[cur], b'+' | b'-') {
                    cur += 1;
                }
                let exp_start = cur;
                while cur < bytes.len() && bytes[cur].is_ascii_digit() {
                    cur += 1;
                }
                if cur == exp_start {
                    return None;
                }
            }
            Some(cur)
        }
        _ => None,
    }
}

#[program]
pub mod bounty {
    use super::*;

    pub fn post(ctx: Context<PostBounty>, nonce: u64, target_label: String, amount: u64) -> Result<()> {
        require!(
            !target_label.is_empty() && target_label.len() <= MAX_LABEL_BYTES,
            BountyError::InvalidLabel
        );
        require!(amount > 0, BountyError::InvalidAmount);
        {
            let model_info = ctx.accounts.model.to_account_info();
            require_keys_eq!(*model_info.owner, voynich_cpi::ID, BountyError::InvalidModel);
            let data = model_info.try_borrow_data()?;
            require!(
                data.len() >= 8 && &data[..8] == voynich_cpi::voynich::state::Model::DISCRIMINATOR,
                BountyError::InvalidModel
            );
        }

        let slot = Clock::get()?.slot;
        let mint_key = ctx.accounts.mint.as_ref().map(|m| m.key()).unwrap_or_default();

        let bounty = &mut ctx.accounts.bounty;
        bounty.creator = ctx.accounts.creator.key();
        bounty.nonce = nonce;
        bounty.model = ctx.accounts.model.key();
        bounty.target_label = target_label.clone();
        bounty.mint = mint_key;
        bounty.amount = amount;
        bounty.status = BountyStatus::Open;
        bounty.winner = Pubkey::default();
        bounty.winning_call = Pubkey::default();
        bounty.winning_receipt = Pubkey::default();
        bounty.created_slot = slot;
        bounty.claimed_slot = 0;
        bounty.attempts = 0;
        bounty.bump = ctx.bumps.bounty;

        if mint_key == Pubkey::default() {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.creator.to_account_info(),
                        to: ctx.accounts.bounty.to_account_info(),
                    },
                ),
                amount,
            )?;
        } else {
            let mint = ctx.accounts.mint.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let source = ctx.accounts.creator_tokens.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let escrow = ctx.accounts.bounty_tokens.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let token_program = ctx.accounts.token_program.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let ata_program = ctx.accounts.associated_token_program.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            check_token_account(source, ctx.accounts.creator.key(), mint_key, false)?;
            require_keys_eq!(
                escrow.key(),
                associated_token::get_associated_token_address(&ctx.accounts.bounty.key(), &mint_key),
                BountyError::InvalidTokenAccount
            );
            associated_token::create_idempotent(CpiContext::new(
                ata_program.to_account_info(),
                associated_token::Create {
                    payer: ctx.accounts.creator.to_account_info(),
                    associated_token: escrow.to_account_info(),
                    authority: ctx.accounts.bounty.to_account_info(),
                    mint: mint.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    token_program: token_program.to_account_info(),
                },
            ))?;
            token::transfer(
                CpiContext::new(
                    token_program.to_account_info(),
                    Transfer {
                        from: source.to_account_info(),
                        to: escrow.to_account_info(),
                        authority: ctx.accounts.creator.to_account_info(),
                    },
                ),
                amount,
            )?;
        }

        emit_cpi!(BountyPosted {
            bounty: ctx.accounts.bounty.key(),
            creator: ctx.accounts.creator.key(),
            nonce,
            model: ctx.accounts.model.key(),
            target_label,
            mint: mint_key,
            amount,
            slot,
        });
        Ok(())
    }

    pub fn draw(ctx: Context<DrawBounty>, call_nonce: u64, input_hash: [u8; 32]) -> Result<()> {
        require!(ctx.accounts.bounty.status == BountyStatus::Open, BountyError::BountyNotOpen);
        require_keys_eq!(ctx.accounts.model.key(), ctx.accounts.bounty.model, BountyError::InvalidModel);

        let model_price = ctx.accounts.model.price;
        let model_price_mint = ctx.accounts.model.price_mint;
        let bounty_key = ctx.accounts.bounty.key();
        let caller_bump = [ctx.bumps.caller];
        let caller_seeds: &[&[u8]] = &[b"caller", bounty_key.as_ref(), &caller_bump];
        let signer_seeds = &[caller_seeds];

        if model_price_mint == Pubkey::default() {
            if model_price > 0 {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.drawer.to_account_info(),
                            to: ctx.accounts.caller.to_account_info(),
                        },
                    ),
                    model_price,
                )?;
            }
        } else {
            let mint = ctx.accounts.price_mint.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let drawer_tokens = ctx.accounts.drawer_tokens.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let caller_tokens = ctx.accounts.caller_tokens.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let token_program = ctx.accounts.token_program.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let ata_program = ctx.accounts.associated_token_program.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            require_keys_eq!(mint.key(), model_price_mint, BountyError::InvalidTokenAccount);
            check_token_account(drawer_tokens, ctx.accounts.drawer.key(), model_price_mint, false)?;
            require_keys_eq!(
                caller_tokens.key(),
                associated_token::get_associated_token_address(&ctx.accounts.caller.key(), &model_price_mint),
                BountyError::InvalidTokenAccount
            );
            associated_token::create_idempotent(CpiContext::new(
                ata_program.to_account_info(),
                associated_token::Create {
                    payer: ctx.accounts.drawer.to_account_info(),
                    associated_token: caller_tokens.to_account_info(),
                    authority: ctx.accounts.caller.to_account_info(),
                    mint: mint.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    token_program: token_program.to_account_info(),
                },
            ))?;
            if model_price > 0 {
                token::transfer(
                    CpiContext::new(
                        token_program.to_account_info(),
                        Transfer {
                            from: drawer_tokens.to_account_info(),
                            to: caller_tokens.to_account_info(),
                            authority: ctx.accounts.drawer.to_account_info(),
                        },
                    ),
                    model_price,
                )?;
            }
        }

        let mut callback_accounts = Vec::with_capacity(6);
        callback_accounts.push(CallbackAccount { pubkey: bounty_key, is_writable: true });
        callback_accounts.push(CallbackAccount { pubkey: ctx.accounts.event_authority.key(), is_writable: false });
        callback_accounts.push(CallbackAccount { pubkey: crate::ID, is_writable: false });

        let bounty_mint_key = ctx.accounts.bounty.mint;
        if bounty_mint_key == Pubkey::default() {
            callback_accounts.push(CallbackAccount { pubkey: ctx.accounts.drawer.key(), is_writable: true });
        } else {
            let bounty_mint = ctx.accounts.bounty_mint.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let bounty_tokens = ctx.accounts.bounty_tokens.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let drawer_reward_tokens = ctx.accounts.drawer_reward_tokens.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let token_program = ctx.accounts.token_program.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let ata_program = ctx.accounts.associated_token_program.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            require_keys_eq!(bounty_mint.key(), bounty_mint_key, BountyError::InvalidTokenAccount);
            require_keys_eq!(
                bounty_tokens.key(),
                associated_token::get_associated_token_address(&bounty_key, &bounty_mint_key),
                BountyError::InvalidTokenAccount
            );
            require_keys_eq!(
                drawer_reward_tokens.key(),
                associated_token::get_associated_token_address(&ctx.accounts.drawer.key(), &bounty_mint_key),
                BountyError::InvalidTokenAccount
            );
            associated_token::create_idempotent(CpiContext::new(
                ata_program.to_account_info(),
                associated_token::Create {
                    payer: ctx.accounts.drawer.to_account_info(),
                    associated_token: drawer_reward_tokens.to_account_info(),
                    authority: ctx.accounts.drawer.to_account_info(),
                    mint: bounty_mint.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    token_program: token_program.to_account_info(),
                },
            ))?;
            callback_accounts.push(CallbackAccount { pubkey: bounty_tokens.key(), is_writable: true });
            callback_accounts.push(CallbackAccount { pubkey: drawer_reward_tokens.key(), is_writable: true });
            callback_accounts.push(CallbackAccount { pubkey: token_program.key(), is_writable: false });
        }

        let cpi_accounts = OpenCall {
            payer: ctx.accounts.drawer.to_account_info(),
            caller: ctx.accounts.caller.to_account_info(),
            config: ctx.accounts.config.to_account_info(),
            model: ctx.accounts.model.to_account_info(),
            enclave: ctx.accounts.enclave.to_account_info(),
            attestation_record: ctx.accounts.attestation_record.to_account_info(),
            grant: ctx.accounts.grant.to_account_info(),
            call: ctx.accounts.call.to_account_info(),
            mint: ctx.accounts.price_mint.as_ref().map(|a| a.to_account_info()),
            caller_tokens: ctx.accounts.caller_tokens.as_ref().map(|a| a.to_account_info()),
            escrow_tokens: ctx.accounts.escrow_tokens.as_ref().map(|a| a.to_account_info()),
            token_program: ctx.accounts.token_program.as_ref().map(|a| a.to_account_info()),
            associated_token_program: ctx.accounts.associated_token_program.as_ref().map(|a| a.to_account_info()),
            system_program: ctx.accounts.system_program.to_account_info(),
            event_authority: ctx.accounts.voynich_event_authority.to_account_info(),
            program: ctx.accounts.voynich_program.to_account_info(),
        };
        voynich_cpi::open_call_with_callback(
            CpiContext::new_with_signer(
                ctx.accounts.voynich_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            call_nonce,
            input_hash,
            AnswerMode::Open,
            CallbackSpec {
                program: crate::ID,
                accounts: callback_accounts,
            },
        )?;

        let slot = Clock::get()?.slot;
        let attempt = &mut ctx.accounts.attempt;
        attempt.bounty = bounty_key;
        attempt.drawer = ctx.accounts.drawer.key();
        attempt.call = ctx.accounts.call.key();
        attempt.created_slot = slot;
        attempt.bump = ctx.bumps.attempt;

        let bounty = &mut ctx.accounts.bounty;
        bounty.attempts = bounty.attempts.checked_add(1).ok_or(BountyError::ArithmeticOverflow)?;

        emit_cpi!(BountyDrawn {
            bounty: bounty_key,
            attempt: attempt.key(),
            drawer: ctx.accounts.drawer.key(),
            call: ctx.accounts.call.key(),
            caller: ctx.accounts.caller.key(),
            model: ctx.accounts.model.key(),
            enclave: ctx.accounts.enclave.key(),
            input_hash,
            slot,
        });
        Ok(())
    }

    pub fn collect(ctx: Context<CollectBounty>) -> Result<()> {
        require!(ctx.accounts.bounty.status == BountyStatus::Open, BountyError::BountyNotOpen);
        require_keys_eq!(ctx.accounts.attempt.bounty, ctx.accounts.bounty.key(), BountyError::InvalidCall);
        require_keys_eq!(ctx.accounts.attempt.call, ctx.accounts.call.key(), BountyError::InvalidCall);
        require_keys_eq!(ctx.accounts.drawer.key(), ctx.accounts.attempt.drawer, BountyError::Unauthorized);

        let parsed = voynich_cpi::read_receipt(
            &ctx.accounts.receipt.to_account_info(),
            &ctx.accounts.bounty.model,
            &ctx.accounts.attempt.call,
        )?;
        require!(parsed.answer_mode == AnswerMode::Open, BountyError::InvalidOpenAnswer);
        let label = parse_top_level_label(&parsed.open_answer).ok_or(BountyError::InvalidOpenAnswer)?;
        require!(label == ctx.accounts.bounty.target_label, BountyError::LabelMismatch);

        let slot = Clock::get()?.slot;
        let bounty_mint = ctx.accounts.bounty.mint;
        let bounty_amount = ctx.accounts.bounty.amount;
        let creator_key = ctx.accounts.bounty.creator;
        let nonce_bytes = ctx.accounts.bounty.nonce.to_le_bytes();
        let bump = [ctx.accounts.bounty.bump];
        let bounty_seeds: &[&[u8]] = &[b"bounty", creator_key.as_ref(), nonce_bytes.as_ref(), &bump];
        let signer_seeds = &[bounty_seeds];

        if bounty_mint == Pubkey::default() {
            pay_native_from_pda(
                &ctx.accounts.bounty.to_account_info(),
                &ctx.accounts.drawer.to_account_info(),
                bounty_amount,
            )?;
        } else {
            let escrow = ctx.accounts.bounty_tokens.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let destination = ctx.accounts.drawer_tokens.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let token_program = ctx.accounts.token_program.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            check_token_account(escrow, ctx.accounts.bounty.key(), bounty_mint, true)?;
            check_token_account(destination, ctx.accounts.drawer.key(), bounty_mint, false)?;
            require!(escrow.amount >= bounty_amount, BountyError::InsufficientEscrow);
            token::transfer(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    Transfer {
                        from: escrow.to_account_info(),
                        to: destination.to_account_info(),
                        authority: ctx.accounts.bounty.to_account_info(),
                    },
                    signer_seeds,
                ),
                escrow.amount,
            )?;
            token::close_account(CpiContext::new_with_signer(
                token_program.to_account_info(),
                CloseAccount {
                    account: escrow.to_account_info(),
                    destination: ctx.accounts.drawer.to_account_info(),
                    authority: ctx.accounts.bounty.to_account_info(),
                },
                signer_seeds,
            ))?;
        }

        let bounty = &mut ctx.accounts.bounty;
        bounty.status = BountyStatus::Claimed;
        bounty.winner = ctx.accounts.drawer.key();
        bounty.winning_call = ctx.accounts.attempt.call;
        bounty.winning_receipt = ctx.accounts.receipt.key();
        bounty.claimed_slot = slot;

        emit_cpi!(BountyCollected {
            bounty: bounty.key(),
            attempt: ctx.accounts.attempt.key(),
            winner: bounty.winner,
            call: bounty.winning_call,
            receipt: bounty.winning_receipt,
            mint: bounty_mint,
            amount: bounty_amount,
            label,
            slot,
        });
        Ok(())
    }

    /// Invoked by `voynich::settle_call` immediately after writing the Receipt.
    /// Returns `Ok(())` without reverting settlement when the bounty is already closed or the label does not match.
    pub fn on_receipt<'info>(ctx: Context<'_, '_, 'info, 'info, OnReceipt<'info>>) -> Result<()> {
        require_keys_eq!(ctx.accounts.model.key(), ctx.accounts.bounty.model, BountyError::InvalidModel);
        let bounty_key = ctx.accounts.bounty.key();
        let bounty_mint = ctx.accounts.bounty.mint;
        let call_key = ctx.accounts.call.key();

        // Validate that Voynich owns `call`, that this bounty's caller PDA opened it, and read its recorded payout targets.
        let (expected_first_payout, expected_second_payout) = {
            let call_info = ctx.accounts.call.to_account_info();
            require_keys_eq!(*call_info.owner, voynich_cpi::ID, BountyError::InvalidCall);
            let data = call_info.try_borrow_data()?;
            require!(data.len() >= 340, BountyError::InvalidCall);
            let call_caller = Pubkey::new_from_array(data[8..40].try_into().map_err(|_| error!(BountyError::InvalidCall))?);
            let (expected_caller, _) = Pubkey::find_program_address(&[b"caller", bounty_key.as_ref()], &crate::ID);
            require_keys_eq!(call_caller, expected_caller, BountyError::InvalidCall);
            let callback_program = Pubkey::new_from_array(data[304..336].try_into().map_err(|_| error!(BountyError::InvalidCall))?);
            require_keys_eq!(callback_program, crate::ID, BountyError::InvalidCall);
            let cb_len = u32::from_le_bytes(data[336..340].try_into().map_err(|_| error!(BountyError::InvalidCall))?) as usize;
            let expected_len = if bounty_mint == Pubkey::default() { 4 } else { 6 };
            require!(cb_len == expected_len && data.len() >= 340 + 33 * cb_len, BountyError::InvalidCall);
            let read_cb_key = |idx: usize| -> Result<Pubkey> {
                let start = 340 + 33 * idx;
                Ok(Pubkey::new_from_array(data[start..start + 32].try_into().map_err(|_| error!(BountyError::InvalidCall))?))
            };
            require_keys_eq!(read_cb_key(0)?, bounty_key, BountyError::InvalidCall);
            if bounty_mint == Pubkey::default() {
                (read_cb_key(3)?, Pubkey::default())
            } else {
                (read_cb_key(3)?, read_cb_key(4)?)
            }
        };

        let parsed = voynich_cpi::read_receipt(
            &ctx.accounts.receipt.to_account_info(),
            &ctx.accounts.bounty.model,
            &call_key,
        )?;
        if ctx.accounts.bounty.status != BountyStatus::Open {
            return Ok(());
        }
        if parsed.answer_mode != AnswerMode::Open {
            return Ok(());
        }
        let Some(label) = parse_top_level_label(&parsed.open_answer) else {
            return Ok(());
        };
        if label != ctx.accounts.bounty.target_label {
            return Ok(());
        }

        let slot = Clock::get()?.slot;
        let bounty_amount = ctx.accounts.bounty.amount;
        let creator_key = ctx.accounts.bounty.creator;
        let nonce_bytes = ctx.accounts.bounty.nonce.to_le_bytes();
        let bump = [ctx.accounts.bounty.bump];
        let bounty_seeds: &[&[u8]] = &[b"bounty", creator_key.as_ref(), nonce_bytes.as_ref(), &bump];
        let signer_seeds = &[bounty_seeds];

        let winner = if bounty_mint == Pubkey::default() {
            require!(ctx.remaining_accounts.len() >= 1, BountyError::Unauthorized);
            let drawer_info = &ctx.remaining_accounts[0];
            require_keys_eq!(drawer_info.key(), expected_first_payout, BountyError::Unauthorized);
            pay_native_from_pda(
                &ctx.accounts.bounty.to_account_info(),
                drawer_info,
                bounty_amount,
            )?;
            drawer_info.key()
        } else {
            require!(ctx.remaining_accounts.len() >= 3, BountyError::InvalidTokenAccount);
            let escrow = Account::<TokenAccount>::try_from(&ctx.remaining_accounts[0])?;
            let destination = Account::<TokenAccount>::try_from(&ctx.remaining_accounts[1])?;
            let token_program = Program::<Token>::try_from(&ctx.remaining_accounts[2])?;
            require_keys_eq!(escrow.key(), expected_first_payout, BountyError::InvalidTokenAccount);
            require_keys_eq!(destination.key(), expected_second_payout, BountyError::Unauthorized);
            check_token_account(&escrow, bounty_key, bounty_mint, true)?;
            require_keys_eq!(destination.mint, bounty_mint, BountyError::InvalidTokenAccount);
            require!(escrow.amount >= bounty_amount, BountyError::InsufficientEscrow);
            token::transfer(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    Transfer {
                        from: escrow.to_account_info(),
                        to: destination.to_account_info(),
                        authority: ctx.accounts.bounty.to_account_info(),
                    },
                    signer_seeds,
                ),
                escrow.amount,
            )?;
            token::close_account(CpiContext::new_with_signer(
                token_program.to_account_info(),
                CloseAccount {
                    account: escrow.to_account_info(),
                    destination: ctx.accounts.bounty.to_account_info(),
                    authority: ctx.accounts.bounty.to_account_info(),
                },
                signer_seeds,
            ))?;
            destination.owner
        };

        let (attempt_key, _) = Pubkey::find_program_address(&[b"attempt", bounty_key.as_ref(), call_key.as_ref()], &crate::ID);
        let bounty = &mut ctx.accounts.bounty;
        bounty.status = BountyStatus::Claimed;
        bounty.winner = winner;
        bounty.winning_call = call_key;
        bounty.winning_receipt = ctx.accounts.receipt.key();
        bounty.claimed_slot = slot;

        emit_cpi!(BountyCollected {
            bounty: bounty.key(),
            attempt: attempt_key,
            winner: bounty.winner,
            call: bounty.winning_call,
            receipt: bounty.winning_receipt,
            mint: bounty_mint,
            amount: bounty_amount,
            label,
            slot,
        });
        Ok(())
    }

    pub fn cancel(ctx: Context<CancelBounty>) -> Result<()> {
        require!(ctx.accounts.bounty.status == BountyStatus::Open, BountyError::BountyNotOpen);
        let slot = Clock::get()?.slot;
        let bounty_mint = ctx.accounts.bounty.mint;
        let bounty_amount = ctx.accounts.bounty.amount;
        let creator_key = ctx.accounts.bounty.creator;
        let nonce_bytes = ctx.accounts.bounty.nonce.to_le_bytes();
        let bump = [ctx.accounts.bounty.bump];
        let bounty_seeds: &[&[u8]] = &[b"bounty", creator_key.as_ref(), nonce_bytes.as_ref(), &bump];
        let signer_seeds = &[bounty_seeds];

        if bounty_mint == Pubkey::default() {
            pay_native_from_pda(
                &ctx.accounts.bounty.to_account_info(),
                &ctx.accounts.creator.to_account_info(),
                bounty_amount,
            )?;
        } else {
            let escrow = ctx.accounts.bounty_tokens.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let destination = ctx.accounts.creator_tokens.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let token_program = ctx.accounts.token_program.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            check_token_account(escrow, ctx.accounts.bounty.key(), bounty_mint, true)?;
            check_token_account(destination, ctx.accounts.creator.key(), bounty_mint, false)?;
            require!(escrow.amount >= bounty_amount, BountyError::InsufficientEscrow);
            token::transfer(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    Transfer {
                        from: escrow.to_account_info(),
                        to: destination.to_account_info(),
                        authority: ctx.accounts.bounty.to_account_info(),
                    },
                    signer_seeds,
                ),
                escrow.amount,
            )?;
            token::close_account(CpiContext::new_with_signer(
                token_program.to_account_info(),
                CloseAccount {
                    account: escrow.to_account_info(),
                    destination: ctx.accounts.creator.to_account_info(),
                    authority: ctx.accounts.bounty.to_account_info(),
                },
                signer_seeds,
            ))?;
        }

        let bounty = &mut ctx.accounts.bounty;
        bounty.status = BountyStatus::Cancelled;

        emit_cpi!(BountyCancelled {
            bounty: bounty.key(),
            creator: creator_key,
            mint: bounty_mint,
            amount: bounty_amount,
            slot,
        });
        Ok(())
    }

    pub fn refund_attempt(ctx: Context<RefundAttempt>) -> Result<()> {
        require_keys_eq!(ctx.accounts.attempt.bounty, ctx.accounts.bounty.key(), BountyError::InvalidCall);
        require_keys_eq!(ctx.accounts.attempt.call, ctx.accounts.call.key(), BountyError::InvalidCall);
        require_keys_eq!(ctx.accounts.drawer.key(), ctx.accounts.attempt.drawer, BountyError::Unauthorized);

        let (price, price_mint) = {
            let call_info = ctx.accounts.call.to_account_info();
            require_keys_eq!(*call_info.owner, voynich_cpi::ID, BountyError::InvalidCall);
            let data = call_info.try_borrow_data()?;
            require!(data.len() >= 184, BountyError::InvalidCall);
            let mut price_bytes = [0u8; 8];
            price_bytes.copy_from_slice(&data[144..152]);
            let mut mint_bytes = [0u8; 32];
            mint_bytes.copy_from_slice(&data[152..184]);
            (u64::from_le_bytes(price_bytes), Pubkey::new_from_array(mint_bytes))
        };

        let bounty_key = ctx.accounts.bounty.key();
        let caller_bump = [ctx.bumps.caller];
        let caller_seeds: &[&[u8]] = &[b"caller", bounty_key.as_ref(), &caller_bump];
        let signer_seeds = &[caller_seeds];

        let cpi_accounts = RefundCall {
            actor: ctx.accounts.caller.to_account_info(),
            call: ctx.accounts.call.to_account_info(),
            caller: ctx.accounts.caller.to_account_info(),
            escrow_tokens: ctx.accounts.escrow_tokens.as_ref().map(|a| a.to_account_info()),
            caller_tokens: ctx.accounts.caller_tokens.as_ref().map(|a| a.to_account_info()),
            token_program: ctx.accounts.token_program.as_ref().map(|a| a.to_account_info()),
            event_authority: ctx.accounts.voynich_event_authority.to_account_info(),
            program: ctx.accounts.voynich_program.to_account_info(),
        };
        voynich_cpi::refund_call(CpiContext::new_with_signer(
            ctx.accounts.voynich_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        ))?;

        if price_mint == Pubkey::default() {
            if price > 0 {
                system_program::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.caller.to_account_info(),
                            to: ctx.accounts.drawer.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    price,
                )?;
            }
        } else {
            let caller_tokens = ctx.accounts.caller_tokens.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let drawer_tokens = ctx.accounts.drawer_tokens.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            let token_program = ctx.accounts.token_program.as_ref().ok_or(BountyError::InvalidTokenAccount)?;
            check_token_account(drawer_tokens, ctx.accounts.drawer.key(), price_mint, false)?;
            if price > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        token_program.to_account_info(),
                        Transfer {
                            from: caller_tokens.to_account_info(),
                            to: drawer_tokens.to_account_info(),
                            authority: ctx.accounts.caller.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    price,
                )?;
            }
        }

        let slot = Clock::get()?.slot;
        emit_cpi!(AttemptRefunded {
            bounty: bounty_key,
            attempt: ctx.accounts.attempt.key(),
            drawer: ctx.accounts.drawer.key(),
            call: ctx.accounts.call.key(),
            price_mint,
            amount: price,
            slot,
        });
        Ok(())
    }
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct PostBounty<'info> {
    #[account(mut)] pub creator: Signer<'info>,
    /// CHECK: verified in handler (owned by voynich_cpi::ID with Model discriminator).
    pub model: UncheckedAccount<'info>,
    #[account(
        init,
        payer = creator,
        space = Bounty::SPACE,
        seeds = [b"bounty", creator.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub bounty: Box<Account<'info, Bounty>>,
    pub mint: Option<Account<'info, Mint>>,
    #[account(mut)] pub creator_tokens: Option<Account<'info, TokenAccount>>,
    /// CHECK: verified and created idempotently as bounty ATA when SPL priced.
    #[account(mut)] pub bounty_tokens: Option<UncheckedAccount<'info>>,
    pub token_program: Option<Program<'info, Token>>,
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct DrawBounty<'info> {
    #[account(mut)] pub drawer: Signer<'info>,
    #[account(mut, seeds = [b"bounty", bounty.creator.as_ref(), &bounty.nonce.to_le_bytes()], bump = bounty.bump)]
    pub bounty: Box<Account<'info, Bounty>>,
    /// CHECK: system-owned caller PDA derived from bounty; signs voynich::open_call via invoke_signed.
    #[account(mut, seeds = [b"caller", bounty.key().as_ref()], bump)]
    pub caller: UncheckedAccount<'info>,
    #[account(
        init,
        payer = drawer,
        space = Attempt::SPACE,
        seeds = [b"attempt", bounty.key().as_ref(), call.key().as_ref()],
        bump
    )]
    pub attempt: Box<Account<'info, Attempt>>,
    /// CHECK: verified by voynich::open_call.
    pub config: UncheckedAccount<'info>,
    pub model: Box<Account<'info, voynich_cpi::voynich::state::Model>>,
    /// CHECK: verified by voynich::open_call.
    pub enclave: UncheckedAccount<'info>,
    /// CHECK: verified by voynich::open_call.
    pub attestation_record: UncheckedAccount<'info>,
    /// CHECK: verified by voynich::open_call.
    pub grant: UncheckedAccount<'info>,
    /// CHECK: initialized by voynich::open_call.
    #[account(mut)] pub call: UncheckedAccount<'info>,
    pub price_mint: Option<Account<'info, Mint>>,
    #[account(mut)] pub drawer_tokens: Option<Account<'info, TokenAccount>>,
    /// CHECK: verified and created idempotently as caller PDA ATA when SPL priced.
    #[account(mut)] pub caller_tokens: Option<UncheckedAccount<'info>>,
    /// CHECK: created/verified by voynich::open_call when SPL priced.
    #[account(mut)] pub escrow_tokens: Option<UncheckedAccount<'info>>,
    /// CHECK: optional bounty reward SPL mint when bounty.mint != default.
    pub bounty_mint: Option<UncheckedAccount<'info>>,
    /// CHECK: optional bounty reward escrow ATA when bounty.mint != default.
    #[account(mut)] pub bounty_tokens: Option<UncheckedAccount<'info>>,
    /// CHECK: optional drawer reward ATA created idempotently when bounty.mint != default.
    #[account(mut)] pub drawer_reward_tokens: Option<UncheckedAccount<'info>>,
    pub token_program: Option<Program<'info, Token>>,
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,
    pub system_program: Program<'info, System>,
    /// CHECK: voynich emit_cpi event authority PDA.
    pub voynich_event_authority: UncheckedAccount<'info>,
    pub voynich_program: Program<'info, Voynich>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct OnReceipt<'info> {
    /// CHECK: verified by voynich_cpi::read_receipt.
    pub receipt: UncheckedAccount<'info>,
    /// CHECK: verified against voynich::ID, caller PDA, callback accounts, and Receipt.call.
    pub call: UncheckedAccount<'info>,
    /// CHECK: verified against bounty.model.
    pub model: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"bounty", bounty.creator.as_ref(), &bounty.nonce.to_le_bytes()], bump = bounty.bump)]
    pub bounty: Box<Account<'info, Bounty>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CollectBounty<'info> {
    pub actor: Signer<'info>,
    #[account(mut, seeds = [b"bounty", bounty.creator.as_ref(), &bounty.nonce.to_le_bytes()], bump = bounty.bump)]
    pub bounty: Box<Account<'info, Bounty>>,
    #[account(seeds = [b"attempt", bounty.key().as_ref(), call.key().as_ref()], bump = attempt.bump)]
    pub attempt: Box<Account<'info, Attempt>>,
    /// CHECK: verified against attempt.call and Receipt.call.
    pub call: UncheckedAccount<'info>,
    /// CHECK: verified by voynich_cpi::read_receipt.
    pub receipt: UncheckedAccount<'info>,
    /// CHECK: exact winner checked against attempt.drawer.
    #[account(mut)] pub drawer: UncheckedAccount<'info>,
    #[account(mut)] pub bounty_tokens: Option<Account<'info, TokenAccount>>,
    #[account(mut)] pub drawer_tokens: Option<Account<'info, TokenAccount>>,
    pub token_program: Option<Program<'info, Token>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CancelBounty<'info> {
    #[account(mut)] pub creator: Signer<'info>,
    #[account(mut, seeds = [b"bounty", bounty.creator.as_ref(), &bounty.nonce.to_le_bytes()], bump = bounty.bump, has_one = creator @ BountyError::Unauthorized)]
    pub bounty: Box<Account<'info, Bounty>>,
    #[account(mut)] pub bounty_tokens: Option<Account<'info, TokenAccount>>,
    #[account(mut)] pub creator_tokens: Option<Account<'info, TokenAccount>>,
    pub token_program: Option<Program<'info, Token>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RefundAttempt<'info> {
    pub actor: Signer<'info>,
    #[account(seeds = [b"bounty", bounty.creator.as_ref(), &bounty.nonce.to_le_bytes()], bump = bounty.bump)]
    pub bounty: Box<Account<'info, Bounty>>,
    /// CHECK: system-owned caller PDA derived from bounty.
    #[account(mut, seeds = [b"caller", bounty.key().as_ref()], bump)]
    pub caller: UncheckedAccount<'info>,
    #[account(seeds = [b"attempt", bounty.key().as_ref(), call.key().as_ref()], bump = attempt.bump)]
    pub attempt: Box<Account<'info, Attempt>>,
    /// CHECK: verified against attempt.call and voynich_cpi::refund_call.
    #[account(mut)] pub call: UncheckedAccount<'info>,
    /// CHECK: exact drawer checked against attempt.drawer.
    #[account(mut)] pub drawer: UncheckedAccount<'info>,
    /// CHECK: verified by voynich::refund_call when SPL priced.
    #[account(mut)] pub escrow_tokens: Option<UncheckedAccount<'info>>,
    /// CHECK: verified by voynich::refund_call when SPL priced.
    #[account(mut)] pub caller_tokens: Option<UncheckedAccount<'info>>,
    #[account(mut)] pub drawer_tokens: Option<Account<'info, TokenAccount>>,
    pub token_program: Option<Program<'info, Token>>,
    pub system_program: Program<'info, System>,
    /// CHECK: voynich emit_cpi event authority PDA.
    pub voynich_event_authority: UncheckedAccount<'info>,
    pub voynich_program: Program<'info, Voynich>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_top_level_label_ignoring_nested_scores() {
        let payload = br#"{"scores":[{"label":"cat","probability":0.01}],"probability":0.97,"label":"clock"}"#;
        assert_eq!(parse_top_level_label(payload).as_deref(), Some("clock"));
    }

    #[test]
    fn parses_compact_and_escaped_label() {
        let compact = br#"{"label":"ice cream","probability":0.88}"#;
        assert_eq!(parse_top_level_label(compact).as_deref(), Some("ice cream"));
        let escaped = br#"{ "label" : "a\/b" }"#;
        assert_eq!(parse_top_level_label(escaped).as_deref(), Some("a/b"));
    }

    #[test]
    fn rejects_missing_or_non_string_label() {
        assert_eq!(parse_top_level_label(br#"{"scores":[{"label":"clock"}]}"#), None);
        assert_eq!(parse_top_level_label(br#"{"label":123}"#), None);
        assert_eq!(parse_top_level_label(b"not json"), None);
    }
}
