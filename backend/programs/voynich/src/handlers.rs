use anchor_lang::{prelude::*, system_program, Discriminator};
use crate::{attestation, contexts::*, ed25519, errors::VoynichError, events::*, money, state::*, weights};

fn valid_config(args: &ConfigArgs) -> Result<()> {
    require!(args.attestation_program != Pubkey::default() && args.fee_recipient != Pubkey::default() && args.record_layout_version > 0 && args.protocol_share_bps <= 10000 && args.call_deadline_slots > 0 && args.max_open_answer_bytes > 0 && args.max_open_answer_bytes <= MAX_OPEN_ANSWER_BYTES_LIMIT, VoynichError::InvalidConfig);
    Ok(())
}
fn assign_config(config: &mut Config, args: &ConfigArgs) {
    config.attestation_program = args.attestation_program;
    config.record_layout_version = args.record_layout_version;
    config.fee_recipient = args.fee_recipient;
    config.protocol_share_bps = args.protocol_share_bps;
    config.call_deadline_slots = args.call_deadline_slots;
    config.max_open_answer_bytes = args.max_open_answer_bytes;
}
pub fn initialize(ctx: Context<Initialize>, args: ConfigArgs) -> Result<()> {
    valid_config(&args)?;
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key(); config.bump = ctx.bumps.config;
    assign_config(config, &args);
    emit_cpi!(ConfigChanged { admin: config.admin, config: args });
    Ok(())
}
pub fn set_config(ctx: Context<SetConfig>, args: ConfigArgs) -> Result<()> {
    valid_config(&args)?;
    assign_config(&mut ctx.accounts.config, &args);
    emit_cpi!(ConfigChanged { admin: ctx.accounts.config.admin, config: args });
    Ok(())
}
pub fn migrate_config(ctx: Context<MigrateConfig>, max_open_answer_bytes: u16) -> Result<()> {
    require!(max_open_answer_bytes > 0 && max_open_answer_bytes <= MAX_OPEN_ANSWER_BYTES_LIMIT, VoynichError::InvalidConfig);
    let config_info = &ctx.accounts.config;
    require_keys_eq!(*config_info.owner, crate::ID, VoynichError::InvalidConfig);
    let (expected_key, expected_bump) = Pubkey::find_program_address(&[b"config"], &crate::ID);
    require_keys_eq!(config_info.key(), expected_key, VoynichError::InvalidConfig);
    require!(config_info.data_len() == Config::LEGACY_SPACE, VoynichError::InvalidConfig);
    let (admin, args) = {
        let data = config_info.try_borrow_data()?;
        require!(&data[..8] == Config::DISCRIMINATOR, VoynichError::InvalidConfig);
        let admin = Pubkey::try_from(&data[8..40]).map_err(|_| error!(VoynichError::InvalidConfig))?;
        require_keys_eq!(admin, ctx.accounts.admin.key(), VoynichError::Unauthorized);
        let attestation_program = Pubkey::try_from(&data[40..72]).map_err(|_| error!(VoynichError::InvalidConfig))?;
        let record_layout_version = data[72];
        let fee_recipient = Pubkey::try_from(&data[73..105]).map_err(|_| error!(VoynichError::InvalidConfig))?;
        let protocol_share_bps = u16::from_le_bytes([data[105], data[106]]);
        let call_deadline_slots = u64::from_le_bytes(data[107..115].try_into().map_err(|_| error!(VoynichError::InvalidConfig))?);
        let bump = data[115];
        require!(bump == expected_bump, VoynichError::InvalidConfig);
        (admin, ConfigArgs { attestation_program, record_layout_version, fee_recipient, protocol_share_bps, call_deadline_slots, max_open_answer_bytes })
    };
    let required_lamports = Rent::get()?.minimum_balance(Config::SPACE);
    if config_info.lamports() < required_lamports {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer { from: ctx.accounts.admin.to_account_info(), to: config_info.to_account_info() },
            ),
            required_lamports - config_info.lamports(),
        )?;
    }
    config_info.realloc(Config::SPACE, false)?;
    {
        let mut data = config_info.try_borrow_mut_data()?;
        data[116..118].copy_from_slice(&max_open_answer_bytes.to_le_bytes());
    }
    emit_cpi!(ConfigChanged { admin, config: args });
    Ok(())
}

pub fn create_model<'info>(ctx: Context<'_, '_, 'info, 'info, CreateModel<'info>>, args: CreateModelArgs) -> Result<()> {
    require!(!args.name.is_empty() && args.name.len() <= 32 && args.name.split('-').all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())), VoynichError::InvalidModel);
    require!(!args.manifest.is_empty() && args.manifest.len() <= MAX_MANIFEST && args.size_bytes > 16 && args.cipher == CIPHER, VoynichError::InvalidModel);
    require!(!args.allowed_measurements.is_empty() && args.allowed_measurements.len() <= MAX_MEASUREMENTS, VoynichError::InvalidModel);
    if let Some(ref base) = args.base {
        require!(base.is_valid(), VoynichError::InvalidModel);
    }
    require!(u32::from(args.operator_share_bps) + u32::from(ctx.accounts.config.protocol_share_bps) <= 10000, VoynichError::InvalidModel);
    require!(ctx.accounts.upload_key.key() != ctx.accounts.owner.key(), VoynichError::InvalidModel);
    require_keys_eq!(*ctx.accounts.upload_key.owner, system_program::ID, VoynichError::InvalidModel);
    require!(ctx.accounts.upload_key.data_is_empty(), VoynichError::InvalidModel);
    let extra_count = usize::from(args.extra_upload_key_count);
    require!(1 + extra_count <= MAX_UPLOAD_KEYS, VoynichError::InvalidModel);
    require!(ctx.remaining_accounts.len() > extra_count, VoynichError::InvalidWeights);
    let (weight_accounts, extra_upload_accounts) = ctx.remaining_accounts.split_at(ctx.remaining_accounts.len() - extra_count);
    let mut upload_keys = Vec::with_capacity(1 + extra_count);
    upload_keys.push(ctx.accounts.upload_key.key());
    for extra in extra_upload_accounts {
        require!(extra.is_writable, VoynichError::InvalidModel);
        require_keys_eq!(*extra.owner, system_program::ID, VoynichError::InvalidModel);
        require!(extra.data_is_empty(), VoynichError::InvalidModel);
        require!(extra.key() != ctx.accounts.owner.key(), VoynichError::InvalidModel);
        require!(!upload_keys.contains(&extra.key()), VoynichError::InvalidModel);
        upload_keys.push(extra.key());
    }
    let model = &mut ctx.accounts.model;
    let keys = weights::initialize_batch(model.key(), &[], weight_accounts, 0, args.size_bytes)?;
    model.owner = ctx.accounts.owner.key(); model.name = args.name.clone(); model.manifest = args.manifest.clone(); model.weights = keys;
    model.size_bytes = args.size_bytes; model.cipher = args.cipher.clone(); model.nonce_prefix = args.nonce_prefix;
    model.ciphertext_sha256 = [0;32]; model.allowed_measurements = args.allowed_measurements.clone();
    model.price = args.price; model.price_mint = args.price_mint; model.operator_share_bps = args.operator_share_bps;
    model.upload_key = ctx.accounts.upload_key.key(); model.upload_keys = upload_keys.clone(); model.status = ModelStatus::Uploading;
    model.created_slot = Clock::get()?.slot; model.sealed_slot = 0; model.calls_settled = 0; model.bump = ctx.bumps.model;
    model.hash_version = 1; model.sealed_chunks = 0; model.merkle_frontier = Vec::new(); model.merkle_frontier_mask = 0;
    model.base = args.base.clone();
    model.price_unit = args.price_unit;
    model.has_policy = false;
    let key_count = upload_keys.len() as u64;
    let base_funding = args.upload_funding_lamports / key_count;
    let primary_funding = base_funding + (args.upload_funding_lamports % key_count);
    system_program::transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer { from: ctx.accounts.owner.to_account_info(), to: ctx.accounts.upload_key.to_account_info() }), primary_funding)?;
    for extra in extra_upload_accounts {
        system_program::transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer { from: ctx.accounts.owner.to_account_info(), to: extra.clone() }), base_funding)?;
    }
    emit_cpi!(ModelCreated { model: model.key(), owner: model.owner, name: model.name.clone(), manifest: model.manifest.clone(), weights: model.weights.clone(), size_bytes: model.size_bytes, cipher: model.cipher.clone(), nonce_prefix: model.nonce_prefix, allowed_measurements: model.allowed_measurements.clone(), price: model.price, price_mint: model.price_mint, operator_share_bps: model.operator_share_bps, upload_key: model.upload_key, slot: model.created_slot, upload_keys, hash_version: model.hash_version, base: model.base.clone(), price_unit: model.price_unit });
    Ok(())
}
pub fn attach_weights<'info>(ctx: Context<'_, '_, '_, 'info, AttachWeights<'info>>) -> Result<()> {
    let model = &mut ctx.accounts.model;
    require!(model.status == ModelStatus::Uploading, VoynichError::ModelNotUploading);
    require!(ctx.remaining_accounts.len() >= 2, VoynichError::InvalidWeights);
    let last_info = &ctx.remaining_accounts[0];
    let new_accounts = &ctx.remaining_accounts[1..];
    let start_offset = weights::attached_end_offset(model.key(), model, last_info)?;
    let added = weights::initialize_batch(model.key(), &model.weights, new_accounts, start_offset, model.size_bytes)?;
    model.weights.extend_from_slice(&added);
    emit_cpi!(WeightsAttached { model: model.key(), weights: added });
    Ok(())
}
pub fn write_weights(ctx: Context<WriteWeights>, offset: u32, bytes: Vec<u8>) -> Result<()> {
    let model = &ctx.accounts.model;
    require!(model.status == ModelStatus::Uploading, VoynichError::ModelNotUploading);
    let written_bytes = weights::write(model.key(), model, &ctx.accounts.weights.to_account_info(), offset, &bytes)?;
    emit_cpi!(WeightsWritten { model: model.key(), weights: ctx.accounts.weights.key(), offset, length: bytes.len() as u32, written_bytes });
    Ok(())
}
fn parse_model_prefix(data: &[u8]) -> Result<(Pubkey, String, u8, usize)> {
    require!(data.len() >= 8 && &data[..8] == Model::DISCRIMINATOR, VoynichError::InvalidModel);
    let mut offset = 8usize;
    let take = |off: &mut usize, len: usize| -> Result<&[u8]> {
        let end = off.checked_add(len).ok_or(VoynichError::InvalidModel)?;
        require!(end <= data.len(), VoynichError::InvalidModel);
        let slice = &data[*off..end];
        *off = end;
        Ok(slice)
    };
    let read_u32 = |off: &mut usize| -> Result<usize> {
        let bytes: [u8; 4] = take(off, 4)?.try_into().map_err(|_| error!(VoynichError::InvalidModel))?;
        Ok(u32::from_le_bytes(bytes) as usize)
    };
    let skip_vec = |off: &mut usize, elem_size: usize| -> Result<()> {
        let count = read_u32(off)?;
        let bytes = count.checked_mul(elem_size).ok_or(VoynichError::InvalidModel)?;
        take(off, bytes)?;
        Ok(())
    };

    let owner = Pubkey::try_from(take(&mut offset, 32)?).map_err(|_| error!(VoynichError::InvalidModel))?;
    let name_len = read_u32(&mut offset)?;
    let name = core::str::from_utf8(take(&mut offset, name_len)?)
        .map_err(|_| error!(VoynichError::InvalidModel))?
        .to_string();
    skip_vec(&mut offset, 1)?; // manifest
    skip_vec(&mut offset, 32)?; // weights
    take(&mut offset, 8)?; // size_bytes
    skip_vec(&mut offset, 1)?; // cipher
    take(&mut offset, 16 + 32)?; // nonce_prefix + ciphertext_sha256
    skip_vec(&mut offset, 48)?; // allowed_measurements
    take(&mut offset, 8 + 32 + 2 + 32 + 1 + 8 + 8 + 8)?; // price..calls_settled
    let bump = take(&mut offset, 1)?[0];
    skip_vec(&mut offset, 32)?; // upload_keys
    take(&mut offset, 1 + 4)?; // hash_version + sealed_chunks
    skip_vec(&mut offset, 32)?; // merkle_frontier
    take(&mut offset, 4)?; // merkle_frontier_mask
    let base_tag = take(&mut offset, 1)?[0];
    match base_tag {
        0 => {}
        1 => {
            take(&mut offset, 32 + 8)?; // sha256 + size_bytes
            skip_vec(&mut offset, 1)?; // format
            skip_vec(&mut offset, 1)?; // source
        }
        _ => return err!(VoynichError::InvalidModel),
    }
    Ok((owner, name, bump, offset))
}

fn zero_model_tail(model: &Account<Model>) -> Result<()> {
    let mut serialized = Vec::new();
    model.try_serialize(&mut serialized)?;
    let info = model.to_account_info();
    let mut data = info.try_borrow_mut_data()?;
    require!(serialized.len() <= data.len(), VoynichError::InvalidModel);
    data[..serialized.len()].copy_from_slice(&serialized);
    data[serialized.len()..].fill(0);
    Ok(())
}

fn repair_model_tail_bytes(data: &mut [u8], prefix_end: usize) -> Result<()> {
    require!(prefix_end + 1 < data.len(), VoynichError::InvalidModel);
    if data[prefix_end] > 1 || data[prefix_end + 1] > 1 || data[prefix_end + 2..].iter().any(|&b| b != 0) {
        data[prefix_end] = 0;
        data[prefix_end + 1] = 0;
        data[prefix_end + 2..].fill(0);
    }
    Ok(())
}

pub fn migrate_model(ctx: Context<MigrateModel>) -> Result<()> {
    let model_info = &ctx.accounts.model;
    require_keys_eq!(*model_info.owner, crate::ID, VoynichError::InvalidModel);
    let prefix_end = {
        let data = model_info.try_borrow_data()?;
        let (owner, name, bump, prefix_end) = parse_model_prefix(&data)?;
        let (expected_key, expected_bump) = Pubkey::find_program_address(&[b"model", name.as_bytes()], &crate::ID);
        require!(model_info.key() == expected_key && bump == expected_bump, VoynichError::InvalidModel);
        let authority = ctx.accounts.authority.key();
        require!(authority == owner || authority == ctx.accounts.config.admin, VoynichError::Unauthorized);
        prefix_end
    };
    {
        let mut data = model_info.try_borrow_mut_data()?;
        repair_model_tail_bytes(&mut data, prefix_end)?;
    }
    let data = model_info.try_borrow_data()?;
    Model::try_deserialize(&mut &data[..]).map_err(|_| error!(VoynichError::InvalidModel))?;
    Ok(())
}

pub fn seal_range<'info>(ctx: Context<'_, '_, '_, 'info, SealRange<'info>>, chunk_count: u32) -> Result<()> {
    let model = &mut ctx.accounts.model;
    require!(model.status == ModelStatus::Uploading, VoynichError::ModelNotUploading);
    require!(model.hash_version == 1, VoynichError::InvalidModel);
    let (start_chunk, sealed_chunks) = weights::hash_chunks(model.key(), model, ctx.remaining_accounts, chunk_count)?;
    emit_cpi!(RangeSealed { model: model.key(), start_chunk, chunk_count, sealed_chunks });
    zero_model_tail(&ctx.accounts.model)?;
    Ok(())
}
pub fn seal_model<'info>(ctx: Context<'_, '_, '_, 'info, SealModel<'info>>, ciphertext_sha256: [u8;32]) -> Result<()> {
    let model = &mut ctx.accounts.model;
    require!(model.status == ModelStatus::Uploading, VoynichError::ModelNotUploading);
    if model.hash_version == 0 {
        require!(weights::hash(model.key(), model, ctx.remaining_accounts)? == ciphertext_sha256, VoynichError::CiphertextHashMismatch);
    } else {
        let total = weights::total_chunks(model.size_bytes)?;
        if model.sealed_chunks < total {
            let remaining = total - model.sealed_chunks;
            require!(remaining <= MAX_SEAL_RANGE_CHUNKS, VoynichError::UploadIncomplete);
            weights::hash_chunks(model.key(), model, ctx.remaining_accounts, remaining)?;
        }
        let root = weights::finalize_merkle(&model.merkle_frontier, model.merkle_frontier_mask)?;
        require!(root == ciphertext_sha256, VoynichError::CiphertextHashMismatch);
        model.merkle_frontier.clear();
        model.merkle_frontier_mask = 0;
    }
    model.ciphertext_sha256 = ciphertext_sha256; model.status = ModelStatus::Sealed;
    model.sealed_slot = Clock::get()?.slot; model.upload_key = Pubkey::default(); model.upload_keys.clear();
    emit_cpi!(ModelSealed { model: model.key(), ciphertext_sha256, slot: model.sealed_slot, base_sha256: model.base.as_ref().map(|b| b.sha256) });
    zero_model_tail(&ctx.accounts.model)?;
    Ok(())
}
pub fn set_price(ctx: Context<ModelOwner>, price: u64, price_mint: Pubkey, operator_share_bps: u16, price_unit: PriceUnit) -> Result<()> {
    require!(u32::from(operator_share_bps) + u32::from(ctx.accounts.config.protocol_share_bps) <= 10000, VoynichError::InvalidModel);
    let model = &mut ctx.accounts.model;
    model.price = price; model.price_mint = price_mint; model.operator_share_bps = operator_share_bps; model.price_unit = price_unit;
    emit_cpi!(ModelPriceChanged { model: model.key(), price, price_mint, operator_share_bps, price_unit });
    Ok(())
}
pub fn retire_model(ctx: Context<ModelOwner>) -> Result<()> {
    ctx.accounts.model.status = ModelStatus::Retired;
    emit_cpi!(ModelStatusChanged { model: ctx.accounts.model.key(), status: ModelStatus::Retired });
    Ok(())
}
pub fn set_allowed_measurements(ctx: Context<ModelOwner>, allowed_measurements: Vec<[u8; 48]>) -> Result<()> {
    require!(!allowed_measurements.is_empty() && allowed_measurements.len() <= MAX_MEASUREMENTS, VoynichError::InvalidModel);
    ctx.accounts.model.allowed_measurements = allowed_measurements.clone();
    emit_cpi!(ModelAllowedMeasurementsChanged { model: ctx.accounts.model.key(), allowed_measurements });
    zero_model_tail(&ctx.accounts.model)?;
    Ok(())
}

fn record(config: &Config, info: &AccountInfo, signing: &Pubkey) -> Result<attestation::VerifiedRecord> {
    attestation::verify(info, &config.attestation_program, config.record_layout_version, signing, Clock::get()?.slot)
        .map_err(|_| error!(VoynichError::InvalidAttestation))
}
fn current_record(config: &Config, enclave: &Enclave, info: &AccountInfo) -> Result<attestation::VerifiedRecord> {
    require_keys_eq!(*info.key, enclave.attestation_record, VoynichError::InvalidEnclave);
    let value = record(config, info, &enclave.signing_key)?;
    require!(value.hardware_type == enclave.hardware_type && value.measurement == enclave.measurement, VoynichError::InvalidEnclave);
    Ok(value)
}
fn allowed(model: &Model, measurement: &[u8;48]) -> Result<()> {
    require!(model.allowed_measurements.contains(measurement), VoynichError::MeasurementNotAllowed);
    Ok(())
}
fn valid_endpoint(endpoint: &str) -> Result<()> {
    require!(!endpoint.is_empty() && endpoint.len() <= MAX_ENDPOINT && (endpoint.starts_with("http://") || endpoint.starts_with("https://")), VoynichError::InvalidEnclave);
    Ok(())
}

pub fn register_enclave(ctx: Context<RegisterEnclave>, encryption_key: [u8;32], endpoint: String) -> Result<()> {
    valid_endpoint(&endpoint)?;
    require!(encryption_key != [0;32], VoynichError::InvalidEnclave);
    let value = record(&ctx.accounts.config, &ctx.accounts.attestation_record, &ctx.accounts.signing_key.key())?;
    let enclave = &mut ctx.accounts.enclave;
    enclave.signing_key = ctx.accounts.signing_key.key(); enclave.encryption_key = encryption_key;
    enclave.operator = ctx.accounts.operator.key(); enclave.endpoint = endpoint;
    enclave.attestation_record = ctx.accounts.attestation_record.key(); enclave.hardware_type = value.hardware_type;
    enclave.measurement = value.measurement; enclave.recorded_slot = value.recorded_slot; enclave.expires_at_slot = value.expires_at_slot;
    enclave.calls_settled = 0; enclave.bump = ctx.bumps.enclave;
    emit_cpi!(EnclaveChanged { enclave: enclave.key(), signing_key: enclave.signing_key, encryption_key: enclave.encryption_key, operator: enclave.operator, endpoint: enclave.endpoint.clone(), record: enclave.attestation_record, hardware_type: enclave.hardware_type, measurement: enclave.measurement, recorded_slot: enclave.recorded_slot, expires_at_slot: enclave.expires_at_slot });
    Ok(())
}
pub fn refresh_enclave(ctx: Context<RefreshEnclave>, endpoint: String) -> Result<()> {
    valid_endpoint(&endpoint)?;
    let value = record(&ctx.accounts.config, &ctx.accounts.attestation_record, &ctx.accounts.signing_key.key())?;
    let enclave = &mut ctx.accounts.enclave;
    enclave.endpoint = endpoint; enclave.attestation_record = ctx.accounts.attestation_record.key();
    enclave.hardware_type = value.hardware_type; enclave.measurement = value.measurement;
    enclave.recorded_slot = value.recorded_slot; enclave.expires_at_slot = value.expires_at_slot;
    emit_cpi!(EnclaveChanged { enclave: enclave.key(), signing_key: enclave.signing_key, encryption_key: enclave.encryption_key, operator: enclave.operator, endpoint: enclave.endpoint.clone(), record: enclave.attestation_record, hardware_type: enclave.hardware_type, measurement: enclave.measurement, recorded_slot: enclave.recorded_slot, expires_at_slot: enclave.expires_at_slot });
    Ok(())
}

fn load_model_policy(model_key: Pubkey, has_policy: bool, remaining_accounts: &[AccountInfo]) -> Result<Option<Policy>> {
    if !has_policy {
        return Ok(None);
    }
    let (expected_key, _) = Pubkey::find_program_address(&[b"policy", model_key.as_ref()], &crate::ID);
    let info = remaining_accounts
        .iter()
        .find(|acc| acc.key() == expected_key && *acc.owner == crate::ID)
        .ok_or_else(|| error!(VoynichError::PolicyRequired))?;
    let data = info.try_borrow_data()?;
    let policy = Policy::try_deserialize(&mut &data[..]).map_err(|_| error!(VoynichError::PolicyRequired))?;
    require!(policy.model == model_key, VoynichError::PolicyRequired);
    Ok(Some(policy))
}

fn load_grant(info: &AccountInfo, expected_model: Pubkey, expected_enclave: Option<Pubkey>, expected_bump: Option<u8>) -> Result<Grant> {
    require_keys_eq!(*info.owner, crate::ID, VoynichError::GrantRequired);
    let data = info.try_borrow_data()?;
    require!(data.len() >= Grant::BASE_SPACE && &data[..8] == Grant::DISCRIMINATOR, VoynichError::GrantRequired);
    let mut slice = &data[8..];
    let model = Pubkey::deserialize(&mut slice).map_err(|_| error!(VoynichError::GrantRequired))?;
    let enclave = Pubkey::deserialize(&mut slice).map_err(|_| error!(VoynichError::GrantRequired))?;
    let wrapped_key = Vec::<u8>::deserialize(&mut slice).map_err(|_| error!(VoynichError::GrantRequired))?;
    let granted_by = Pubkey::deserialize(&mut slice).map_err(|_| error!(VoynichError::GrantRequired))?;
    let granted_slot = u64::deserialize(&mut slice).map_err(|_| error!(VoynichError::GrantRequired))?;
    let revoked = bool::deserialize(&mut slice).map_err(|_| error!(VoynichError::GrantRequired))?;
    let bump = u8::deserialize(&mut slice).map_err(|_| error!(VoynichError::GrantRequired))?;
    let quoted_operator_share_bps = if slice.is_empty() {
        None
    } else {
        Option::<u16>::deserialize(&mut slice).map_err(|_| error!(VoynichError::InvalidQuote))?
    };
    require!(model == expected_model, VoynichError::GrantRequired);
    if let Some(enclave_key) = expected_enclave {
        require!(enclave == enclave_key, VoynichError::GrantRequired);
    }
    if let Some(b) = expected_bump {
        require!(bump == b, VoynichError::GrantRequired);
    } else {
        let (expected_pda, derived_bump) = Pubkey::find_program_address(&[b"grant", model.as_ref(), enclave.as_ref()], &crate::ID);
        require_keys_eq!(info.key(), expected_pda, VoynichError::GrantRequired);
        require!(bump == derived_bump, VoynichError::GrantRequired);
    }
    Ok(Grant {
        model,
        enclave,
        wrapped_key,
        granted_by,
        granted_slot,
        revoked,
        bump,
        quoted_operator_share_bps,
    })
}

fn assign_grant(grant: &mut Grant, model: Pubkey, enclave: Pubkey, wrapped_key: Vec<u8>, granted_by: Pubkey, bump: u8) -> Result<()> {
    require!(wrapped_key.len() == 105 && wrapped_key[0] == 1, VoynichError::InvalidWrappedKey);
    grant.model = model; grant.enclave = enclave; grant.wrapped_key = wrapped_key;
    grant.granted_by = granted_by; grant.granted_slot = Clock::get()?.slot; grant.revoked = false; grant.bump = bump;
    grant.quoted_operator_share_bps = None;
    Ok(())
}
pub fn grant_by_owner(ctx: Context<GrantByOwner>, wrapped_key: Vec<u8>) -> Result<()> {
    let model = &mut ctx.accounts.model;
    require!(model.status == ModelStatus::Sealed || model.status == ModelStatus::Live, VoynichError::ModelNotSealed);
    let value = current_record(&ctx.accounts.config, &ctx.accounts.target_enclave, &ctx.accounts.target_attestation_record)?;
    allowed(model, &value.measurement)?;
    if let Some(policy) = load_model_policy(model.key(), model.has_policy, ctx.remaining_accounts)? {
        if !policy.allowed_operators.is_empty() {
            require!(policy.allowed_operators.contains(&ctx.accounts.target_enclave.operator), VoynichError::PolicyOperatorDenied);
        }
    }
    let grant = &mut ctx.accounts.grant;
    assign_grant(grant, model.key(), ctx.accounts.target_enclave.key(), wrapped_key, ctx.accounts.owner.key(), ctx.bumps.grant)?;
    model.status = ModelStatus::Live;
    emit_cpi!(GrantChanged { grant: grant.key(), model: grant.model, enclave: grant.enclave, wrapped_key: grant.wrapped_key.clone(), granted_by: grant.granted_by, slot: grant.granted_slot, revoked: false });
    emit_cpi!(ModelStatusChanged { model: model.key(), status: ModelStatus::Live });
    Ok(())
}
pub fn grant_by_enclave(ctx: Context<GrantByEnclave>, wrapped_key: Vec<u8>) -> Result<()> {
    let model = &mut ctx.accounts.model;
    require!(model.status == ModelStatus::Live, VoynichError::ModelNotLive);
    require!(ctx.accounts.source_enclave.key() != ctx.accounts.target_enclave.key(), VoynichError::InvalidEnclave);
    let source_grant = load_grant(&ctx.accounts.source_grant, model.key(), Some(ctx.accounts.source_enclave.key()), Some(ctx.bumps.source_grant))?;
    require!(!source_grant.revoked, VoynichError::GrantRequired);
    let source = current_record(&ctx.accounts.config, &ctx.accounts.source_enclave, &ctx.accounts.source_attestation_record)?;
    let target = current_record(&ctx.accounts.config, &ctx.accounts.target_enclave, &ctx.accounts.target_attestation_record)?;
    allowed(model, &source.measurement)?; allowed(model, &target.measurement)?;
    if let Some(policy) = load_model_policy(model.key(), model.has_policy, ctx.remaining_accounts)? {
        if !policy.allowed_operators.is_empty() {
            require!(policy.allowed_operators.contains(&ctx.accounts.target_enclave.operator), VoynichError::PolicyOperatorDenied);
        }
    }
    let grant = &mut ctx.accounts.grant;
    assign_grant(grant, model.key(), ctx.accounts.target_enclave.key(), wrapped_key, ctx.accounts.source_enclave.key(), ctx.bumps.grant)?;
    emit_cpi!(GrantChanged { grant: grant.key(), model: grant.model, enclave: grant.enclave, wrapped_key: grant.wrapped_key.clone(), granted_by: grant.granted_by, slot: grant.granted_slot, revoked: false });
    Ok(())
}
pub fn revoke_grant(ctx: Context<RevokeGrant>) -> Result<()> {
    let mut grant = load_grant(&ctx.accounts.grant, ctx.accounts.model.key(), None, None)?;
    grant.revoked = true;
    {
        let mut data = ctx.accounts.grant.try_borrow_mut_data()?;
        let len = data.len();
        if len >= Grant::SPACE {
            data.fill(0);
            grant.try_serialize(&mut &mut data[..])?;
        } else {
            // Legacy 223-byte Grant account: revoked bool sits at fixed offset 221.
            data[Grant::BASE_SPACE - 2] = 1;
        }
    }
    emit_cpi!(GrantChanged { grant: ctx.accounts.grant.key(), model: grant.model, enclave: grant.enclave, wrapped_key: grant.wrapped_key.clone(), granted_by: grant.granted_by, slot: Clock::get()?.slot, revoked: true });
    Ok(())
}
pub fn set_quote(ctx: Context<SetQuote>, operator_share_bps: Option<u16>) -> Result<()> {
    let model = &ctx.accounts.model;
    let grant_info = &ctx.accounts.grant;
    let mut grant = load_grant(grant_info, model.key(), Some(ctx.accounts.enclave.key()), Some(ctx.bumps.grant))?;
    require!(!grant.revoked, VoynichError::GrantRequired);
    if let Some(bps) = operator_share_bps {
        require!(bps <= model.operator_share_bps, VoynichError::InvalidQuote);
    }
    if grant_info.data_len() < Grant::SPACE {
        let required_lamports = Rent::get()?.minimum_balance(Grant::SPACE);
        if grant_info.lamports() < required_lamports {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer { from: ctx.accounts.operator.to_account_info(), to: grant_info.to_account_info() },
                ),
                required_lamports - grant_info.lamports(),
            )?;
        }
        grant_info.realloc(Grant::SPACE, false)?;
    }
    grant.quoted_operator_share_bps = operator_share_bps;
    {
        let mut data = grant_info.try_borrow_mut_data()?;
        data.fill(0);
        grant.try_serialize(&mut &mut data[..])?;
    }
    emit_cpi!(GrantQuoteUpdated {
        model: grant.model,
        enclave: grant.enclave,
        operator: ctx.accounts.operator.key(),
        quoted_operator_share_bps: grant.quoted_operator_share_bps,
        slot: Clock::get()?.slot,
    });
    Ok(())
}

fn open_call_inner(ctx: Context<OpenCall>, nonce: u64, input_hash: [u8;32], answer_mode: AnswerMode, callback: Option<CallbackSpec>, price_unit: PriceUnit, ceiling: u64) -> Result<()> {
    let model = &ctx.accounts.model;
    require!(model.status == ModelStatus::Live, VoynichError::ModelNotLive);
    let grant = load_grant(&ctx.accounts.grant, model.key(), Some(ctx.accounts.enclave.key()), Some(ctx.bumps.grant))?;
    require!(!grant.revoked, VoynichError::GrantRequired);
    let value = current_record(&ctx.accounts.config, &ctx.accounts.enclave, &ctx.accounts.attestation_record)?;
    allowed(model, &value.measurement)?;
    if let Some(policy) = load_model_policy(model.key(), model.has_policy, ctx.remaining_accounts)? {
        if policy.allow_list_enabled {
            require!(policy.allowed_callers.contains(&ctx.accounts.caller.key()), VoynichError::PolicyCallerDenied);
        }
    }
    let effective_operator_share_bps = grant
        .quoted_operator_share_bps
        .map(|q| q.min(model.operator_share_bps))
        .unwrap_or(model.operator_share_bps);
    require!(u32::from(effective_operator_share_bps) + u32::from(ctx.accounts.config.protocol_share_bps) <= 10000, VoynichError::InvalidConfig);
    let (callback_program, callback_accounts) = match callback {
        Some(spec) => {
            require!(spec.program != Pubkey::default() && spec.program != crate::ID, VoynichError::InvalidCallback);
            require!(spec.accounts.len() <= MAX_CALLBACK_ACCOUNTS, VoynichError::InvalidCallback);
            (spec.program, spec.accounts)
        }
        None => (Pubkey::default(), Vec::new()),
    };
    let call = &mut ctx.accounts.call;
    call.caller = ctx.accounts.caller.key(); call.model = model.key(); call.enclave = ctx.accounts.enclave.key(); call.nonce = nonce;
    call.input_hash = input_hash; call.price = model.price; call.price_mint = model.price_mint;
    call.owner = model.owner; call.operator = ctx.accounts.enclave.operator; call.fee_recipient = ctx.accounts.config.fee_recipient;
    call.operator_share_bps = effective_operator_share_bps; call.protocol_share_bps = ctx.accounts.config.protocol_share_bps;
    call.opened_slot = Clock::get()?.slot;
    call.deadline_slot = call.opened_slot.checked_add(ctx.accounts.config.call_deadline_slots).ok_or(VoynichError::ArithmeticOverflow)?;
    call.status = CallStatus::Open; call.bump = ctx.bumps.call; call.answer_mode = answer_mode;
    call.caller_is_program = anchor_lang::solana_program::instruction::get_stack_height()
        > anchor_lang::solana_program::instruction::TRANSACTION_LEVEL_STACK_HEIGHT;
    call.callback_program = callback_program;
    call.callback_accounts = callback_accounts;
    call.price_unit = price_unit;
    call.ceiling = ceiling;
    money::deposit(&ctx)?;
    let call = &ctx.accounts.call;
    emit_cpi!(CallOpened { call: call.key(), caller: call.caller, model: call.model, enclave: call.enclave, nonce: call.nonce, input_hash: call.input_hash, price: call.price, price_mint: call.price_mint, owner: call.owner, operator: call.operator, fee_recipient: call.fee_recipient, operator_share_bps: call.operator_share_bps, protocol_share_bps: call.protocol_share_bps, opened_slot: call.opened_slot, deadline_slot: call.deadline_slot, answer_mode: call.answer_mode, caller_is_program: call.caller_is_program, callback_program: call.callback_program, callback_accounts: call.callback_accounts.clone(), price_unit: call.price_unit, ceiling: call.ceiling });
    Ok(())
}
pub fn open_call(ctx: Context<OpenCall>, nonce: u64, input_hash: [u8;32], answer_mode: AnswerMode, callback: Option<CallbackSpec>) -> Result<()> {
    let price = ctx.accounts.model.price;
    require!(ctx.accounts.model.price_unit == PriceUnit::Call, VoynichError::InvalidCall);
    open_call_inner(ctx, nonce, input_hash, answer_mode, callback, PriceUnit::Call, price)
}
pub fn open_metered_call(ctx: Context<OpenCall>, nonce: u64, input_hash: [u8;32], answer_mode: AnswerMode, callback: Option<CallbackSpec>, ceiling: u64) -> Result<()> {
    let model = &ctx.accounts.model;
    require!(model.price_unit == PriceUnit::Token, VoynichError::InvalidCall);
    require!(ceiling >= model.price, VoynichError::InvalidCall);
    require!(model.price == 0 || ceiling > 0, VoynichError::InvalidCall);
    open_call_inner(ctx, nonce, input_hash, answer_mode, callback, PriceUnit::Token, ceiling)
}
pub fn build_receipt_message(call: &Pubkey, input_hash: &[u8; 32], output_hash: &[u8; 32], base_sha256: Option<&[u8; 32]>) -> Vec<u8> {
    match base_sha256 {
        Some(base) => {
            let mut message = Vec::with_capacity(146);
            message.extend_from_slice(b"voynich/receipt/v2");
            message.extend_from_slice(call.as_ref());
            message.extend_from_slice(input_hash);
            message.extend_from_slice(output_hash);
            message.extend_from_slice(base);
            message
        }
        None => {
            let mut message = Vec::with_capacity(114);
            message.extend_from_slice(b"voynich/receipt/v1");
            message.extend_from_slice(call.as_ref());
            message.extend_from_slice(input_hash);
            message.extend_from_slice(output_hash);
            message
        }
    }
}

pub fn build_piece_message(call: &Pubkey, input_hash: &[u8; 32], count: u64, running_hash: &[u8; 32], base_sha256: Option<&[u8; 32]>) -> Vec<u8> {
    let count_bytes = count.to_le_bytes();
    match base_sha256 {
        Some(base) => {
            let mut message = Vec::with_capacity(152);
            message.extend_from_slice(b"voynich/piece/v2");
            message.extend_from_slice(call.as_ref());
            message.extend_from_slice(input_hash);
            message.extend_from_slice(&count_bytes);
            message.extend_from_slice(running_hash);
            message.extend_from_slice(base);
            message
        }
        None => {
            let mut message = Vec::with_capacity(120);
            message.extend_from_slice(b"voynich/piece/v1");
            message.extend_from_slice(call.as_ref());
            message.extend_from_slice(input_hash);
            message.extend_from_slice(&count_bytes);
            message.extend_from_slice(running_hash);
            message
        }
    }
}

pub fn settle_call<'info>(ctx: Context<'_, '_, '_, 'info, SettleCall<'info>>, output_hash: [u8;32], signature: [u8;64], ed25519_instruction_index: u16, open_answer: Vec<u8>) -> Result<()> {
    let call = &ctx.accounts.call;
    require!(call.status == CallStatus::Open, VoynichError::CallNotOpen);
    require!(call.price_unit == PriceUnit::Call, VoynichError::InvalidCall);
    let slot = Clock::get()?.slot;
    require!(slot <= call.deadline_slot, VoynichError::CallDeadlinePassed);
    match call.answer_mode {
        AnswerMode::Sealed => {
            require!(open_answer.is_empty(), VoynichError::InvalidOpenAnswer);
        }
        AnswerMode::Open => {
            require!(!open_answer.is_empty() && open_answer.len() <= usize::from(ctx.accounts.config.max_open_answer_bytes), VoynichError::InvalidOpenAnswer);
            require!(anchor_lang::solana_program::hash::hash(&open_answer).to_bytes() == output_hash, VoynichError::InvalidOpenAnswer);
        }
    }
    let value = current_record(&ctx.accounts.config, &ctx.accounts.enclave, &ctx.accounts.attestation_record)?;
    allowed(&ctx.accounts.model, &value.measurement)?;
    let base_sha256 = ctx.accounts.model.base.as_ref().map(|b| &b.sha256);
    let message = build_receipt_message(&call.key(), &call.input_hash, &output_hash, base_sha256);
    ed25519::verify(&ctx.accounts.instructions, ed25519_instruction_index, &ctx.accounts.enclave.signing_key, &message, &signature).map_err(|_| error!(VoynichError::InvalidSignature))?;
    let operator_amount = ((u128::from(call.price) * u128::from(call.operator_share_bps)) / 10000) as u64;
    let protocol_amount = ((u128::from(call.price) * u128::from(call.protocol_share_bps)) / 10000) as u64;
    let owner_amount = call.price.checked_sub(operator_amount).and_then(|value| value.checked_sub(protocol_amount)).ok_or(VoynichError::ArithmeticOverflow)?;
    let call = &mut ctx.accounts.call;
    let receipt = &mut ctx.accounts.receipt;
    receipt.call = call.key(); receipt.model = call.model; receipt.enclave = call.enclave;
    receipt.input_hash = call.input_hash; receipt.output_hash = output_hash; receipt.signature = signature; receipt.slot = slot;
    receipt.price_mint = call.price_mint; receipt.total = call.price; receipt.owner = call.owner; receipt.operator = call.operator; receipt.fee_recipient = call.fee_recipient;
    receipt.owner_amount = owner_amount; receipt.operator_amount = operator_amount; receipt.protocol_amount = protocol_amount; receipt.bump = ctx.bumps.receipt;
    receipt.answer_mode = call.answer_mode; receipt.open_answer = open_answer.clone(); receipt.caller_is_program = call.caller_is_program;
    call.status = CallStatus::Settled;
    ctx.accounts.model.calls_settled = ctx.accounts.model.calls_settled.checked_add(1).ok_or(VoynichError::ArithmeticOverflow)?;
    ctx.accounts.enclave.calls_settled = ctx.accounts.enclave.calls_settled.checked_add(1).ok_or(VoynichError::ArithmeticOverflow)?;
    emit_cpi!(CallSettled { call: call.key(), receipt: receipt.key(), model: call.model, enclave: call.enclave, input_hash: call.input_hash, output_hash, signature, slot, price_mint: call.price_mint, total: call.price, owner: call.owner, operator: call.operator, fee_recipient: call.fee_recipient, owner_amount, operator_amount, protocol_amount, answer_mode: call.answer_mode, open_answer, caller_is_program: call.caller_is_program, delivered_count: None, returned_amount: None });

    let callback_program = ctx.accounts.call.callback_program;
    if callback_program != Pubkey::default() {
        let callback_accounts = ctx.accounts.call.callback_accounts.clone();
        // Flush Anchor accounts before CPI so the callback program reads finalized Receipt and Call bytes.
        ctx.accounts.receipt.exit(&crate::ID)?;
        ctx.accounts.call.exit(&crate::ID)?;
        ctx.accounts.model.exit(&crate::ID)?;
        ctx.accounts.enclave.exit(&crate::ID)?;

        require!(ctx.remaining_accounts.len() == 1 + callback_accounts.len(), VoynichError::InvalidCallback);
        let target_program = &ctx.remaining_accounts[0];
        require_keys_eq!(target_program.key(), callback_program, VoynichError::InvalidCallback);
        require!(target_program.executable, VoynichError::InvalidCallback);

        let mut metas = Vec::with_capacity(3 + callback_accounts.len());
        metas.push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(ctx.accounts.receipt.key(), false));
        metas.push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(ctx.accounts.call.key(), false));
        metas.push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(ctx.accounts.model.key(), false));

        let mut infos = Vec::with_capacity(4 + callback_accounts.len());
        infos.push(ctx.accounts.receipt.to_account_info());
        infos.push(ctx.accounts.call.to_account_info());
        infos.push(ctx.accounts.model.to_account_info());

        for (index, spec) in callback_accounts.iter().enumerate() {
            let info = &ctx.remaining_accounts[1 + index];
            require_keys_eq!(info.key(), spec.pubkey, VoynichError::InvalidCallback);
            require!(!spec.is_writable || info.is_writable, VoynichError::InvalidCallback);
            metas.push(if spec.is_writable {
                anchor_lang::solana_program::instruction::AccountMeta::new(spec.pubkey, false)
            } else {
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(spec.pubkey, false)
            });
            infos.push(info.clone());
        }
        infos.push(target_program.clone());

        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: callback_program,
            accounts: metas,
            data: ON_RECEIPT_DISCRIMINATOR.to_vec(),
        };
        anchor_lang::solana_program::program::invoke(&ix, &infos)?;
    }
    // Settle SOL/SPL escrow after any callback CPI so direct lamport debits from Call stay balanced across CPI boundaries.
    money::settle(&ctx, owner_amount, operator_amount, protocol_amount)?;
    Ok(())
}

pub fn settle_metered_call<'info>(
    ctx: Context<'_, '_, '_, 'info, SettleMeteredCall<'info>>,
    count: u64,
    running_hash: [u8; 32],
    signature: [u8; 64],
    ed25519_instruction_index: u16,
) -> Result<()> {
    let call = &ctx.accounts.call;
    require!(
        ctx.accounts.payer.key() == call.operator || ctx.accounts.payer.key() == call.caller,
        VoynichError::Unauthorized
    );
    require!(call.status == CallStatus::Open, VoynichError::CallNotOpen);
    require!(call.price_unit == PriceUnit::Token, VoynichError::InvalidCall);
    require!(call.answer_mode == AnswerMode::Sealed, VoynichError::InvalidOpenAnswer);
    let slot = Clock::get()?.slot;
    require!(slot <= call.deadline_slot, VoynichError::CallDeadlinePassed);
    let value = current_record(&ctx.accounts.config, &ctx.accounts.enclave, &ctx.accounts.attestation_record)?;
    allowed(&ctx.accounts.model, &value.measurement)?;

    let total = count.checked_mul(call.price).ok_or(VoynichError::ArithmeticOverflow)?;
    require!(total <= call.ceiling, VoynichError::InsufficientEscrow);
    let returned_amount = call.ceiling.checked_sub(total).ok_or(VoynichError::ArithmeticOverflow)?;

    let base_sha256 = ctx.accounts.model.base.as_ref().map(|b| &b.sha256);
    let call_key = call.key();
    let message = build_piece_message(&call_key, &call.input_hash, count, &running_hash, base_sha256);
    ed25519::verify(
        &ctx.accounts.instructions,
        ed25519_instruction_index,
        &ctx.accounts.enclave.signing_key,
        &message,
        &signature,
    ).map_err(|_| error!(VoynichError::InvalidSignature))?;

    let operator_amount = ((u128::from(total) * u128::from(call.operator_share_bps)) / 10000) as u64;
    let protocol_amount = ((u128::from(total) * u128::from(call.protocol_share_bps)) / 10000) as u64;
    let owner_amount = total
        .checked_sub(operator_amount)
        .and_then(|v| v.checked_sub(protocol_amount))
        .ok_or(VoynichError::ArithmeticOverflow)?;

    // DoS-proof init of the canonical 423B receipt PDA (handles pre-funded dusting cleanly).
    let receipt_info = ctx.accounts.receipt.to_account_info();
    require!(receipt_info.data_is_empty() && *receipt_info.owner == system_program::ID, VoynichError::InvalidCall);
    let rent_lamports = Rent::get()?.minimum_balance(Receipt::METERED_SPACE);
    let bump = [ctx.bumps.receipt];
    let receipt_seeds: &[&[u8]] = &[b"receipt", call_key.as_ref(), &bump];
    let existing_lamports = receipt_info.lamports();
    if existing_lamports == 0 {
        system_program::create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::CreateAccount {
                    from: ctx.accounts.payer.to_account_info(),
                    to: receipt_info.clone(),
                },
                &[receipt_seeds],
            ),
            rent_lamports,
            Receipt::METERED_SPACE as u64,
            &crate::ID,
        )?;
    } else {
        let shortfall = rent_lamports.saturating_sub(existing_lamports);
        if shortfall > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: receipt_info.clone(),
                    },
                ),
                shortfall,
            )?;
        }
        system_program::allocate(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Allocate { account_to_allocate: receipt_info.clone() },
                &[receipt_seeds],
            ),
            Receipt::METERED_SPACE as u64,
        )?;
        system_program::assign(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Assign { account_to_assign: receipt_info.clone() },
                &[receipt_seeds],
            ),
            &crate::ID,
        )?;
    }

    let receipt_record = Receipt {
        call: call_key,
        model: call.model,
        enclave: call.enclave,
        input_hash: call.input_hash,
        output_hash: running_hash,
        signature,
        slot,
        price_mint: call.price_mint,
        total,
        owner: call.owner,
        operator: call.operator,
        fee_recipient: call.fee_recipient,
        owner_amount,
        operator_amount,
        protocol_amount,
        bump: ctx.bumps.receipt,
        answer_mode: call.answer_mode,
        open_answer: Vec::new(),
        caller_is_program: call.caller_is_program,
    };
    {
        let mut data = receipt_info.try_borrow_mut_data()?;
        let prefix_len = Receipt::space(0);
        let mut cursor: &mut [u8] = &mut data[..prefix_len];
        receipt_record.try_serialize(&mut cursor)?;
        require!(cursor.is_empty(), VoynichError::InvalidCall);
        data[prefix_len..prefix_len + 8].copy_from_slice(&count.to_le_bytes());
        data[prefix_len + 8..Receipt::METERED_SPACE].copy_from_slice(&returned_amount.to_le_bytes());
    }

    let call = &mut ctx.accounts.call;
    call.status = CallStatus::Settled;
    ctx.accounts.model.calls_settled = ctx.accounts.model.calls_settled.checked_add(1).ok_or(VoynichError::ArithmeticOverflow)?;
    ctx.accounts.enclave.calls_settled = ctx.accounts.enclave.calls_settled.checked_add(1).ok_or(VoynichError::ArithmeticOverflow)?;
    emit_cpi!(CallSettled {
        call: call_key,
        receipt: ctx.accounts.receipt.key(),
        model: call.model,
        enclave: call.enclave,
        input_hash: call.input_hash,
        output_hash: running_hash,
        signature,
        slot,
        price_mint: call.price_mint,
        total,
        owner: call.owner,
        operator: call.operator,
        fee_recipient: call.fee_recipient,
        owner_amount,
        operator_amount,
        protocol_amount,
        answer_mode: call.answer_mode,
        open_answer: Vec::new(),
        caller_is_program: call.caller_is_program,
        delivered_count: Some(count),
        returned_amount: Some(returned_amount),
    });

    let callback_program = ctx.accounts.call.callback_program;
    if callback_program != Pubkey::default() {
        let callback_accounts = ctx.accounts.call.callback_accounts.clone();
        ctx.accounts.call.exit(&crate::ID)?;
        ctx.accounts.model.exit(&crate::ID)?;
        ctx.accounts.enclave.exit(&crate::ID)?;

        require!(ctx.remaining_accounts.len() == 1 + callback_accounts.len(), VoynichError::InvalidCallback);
        let target_program = &ctx.remaining_accounts[0];
        require_keys_eq!(target_program.key(), callback_program, VoynichError::InvalidCallback);
        require!(target_program.executable, VoynichError::InvalidCallback);

        let mut metas = Vec::with_capacity(3 + callback_accounts.len());
        metas.push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(ctx.accounts.receipt.key(), false));
        metas.push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(ctx.accounts.call.key(), false));
        metas.push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(ctx.accounts.model.key(), false));

        let mut infos = Vec::with_capacity(4 + callback_accounts.len());
        infos.push(ctx.accounts.receipt.to_account_info());
        infos.push(ctx.accounts.call.to_account_info());
        infos.push(ctx.accounts.model.to_account_info());

        for (index, spec) in callback_accounts.iter().enumerate() {
            let info = &ctx.remaining_accounts[1 + index];
            require_keys_eq!(info.key(), spec.pubkey, VoynichError::InvalidCallback);
            require!(!spec.is_writable || info.is_writable, VoynichError::InvalidCallback);
            metas.push(if spec.is_writable {
                anchor_lang::solana_program::instruction::AccountMeta::new(spec.pubkey, false)
            } else {
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(spec.pubkey, false)
            });
            infos.push(info.clone());
        }
        infos.push(target_program.clone());

        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: callback_program,
            accounts: metas,
            data: ON_RECEIPT_DISCRIMINATOR.to_vec(),
        };
        anchor_lang::solana_program::program::invoke(&ix, &infos)?;
    }

    money::settle_metered(&ctx, total, owner_amount, operator_amount, protocol_amount, returned_amount)?;
    Ok(())
}
pub fn refund_call(ctx: Context<RefundCall>) -> Result<()> {
    require!(ctx.accounts.call.status == CallStatus::Open, VoynichError::CallNotOpen);
    let slot = Clock::get()?.slot;
    require!(slot > ctx.accounts.call.deadline_slot, VoynichError::CallNotRefundable);
    let amount = ctx.accounts.call.escrow_amount();
    money::refund(&ctx)?;
    let call = &mut ctx.accounts.call; call.status = CallStatus::Refunded;
    emit_cpi!(CallRefunded { call: call.key(), caller: call.caller, price_mint: call.price_mint, amount, slot, status: CallStatus::Refunded });
    Ok(())
}

pub fn publish_measurement(
    ctx: Context<PublishMeasurement>,
    digest: [u8; 48],
    source_repo: String,
    commit_sha: String,
    recipe_hash: [u8; 32],
    version: String,
) -> Result<()> {
    require!(digest != [0u8; 48], VoynichError::InvalidMeasurement);
    require!(recipe_hash != [0u8; 32], VoynichError::InvalidMeasurement);
    require!(
        !source_repo.is_empty()
            && source_repo.len() <= MAX_SOURCE_REPO
            && !source_repo.bytes().any(|b| b.is_ascii_whitespace() || b.is_ascii_control()),
        VoynichError::InvalidMeasurement
    );
    require!(
        commit_sha.len() >= 7
            && commit_sha.len() <= MAX_COMMIT_SHA
            && commit_sha.bytes().all(|b| b.is_ascii_hexdigit()),
        VoynichError::InvalidMeasurement
    );
    require!(
        !version.is_empty()
            && version.len() <= MAX_MEASUREMENT_VERSION
            && !version.bytes().any(|b| b.is_ascii_whitespace() || b.is_ascii_control()),
        VoynichError::InvalidMeasurement
    );
    let slot = Clock::get()?.slot;
    let m = &mut ctx.accounts.measurement;
    m.digest = digest;
    m.publisher = ctx.accounts.publisher.key();
    m.source_repo = source_repo.clone();
    m.commit_sha = commit_sha.clone();
    m.recipe_hash = recipe_hash;
    m.version = version.clone();
    m.created_slot = slot;
    m.status = MeasurementStatus::Active;
    m.bump = ctx.bumps.measurement;
    emit_cpi!(MeasurementPublished {
        measurement: m.key(),
        digest,
        publisher: m.publisher,
        source_repo,
        commit_sha,
        recipe_hash,
        version,
        created_slot: slot,
        status: MeasurementStatus::Active,
    });
    Ok(())
}

pub fn deprecate_measurement(ctx: Context<DeprecateMeasurement>) -> Result<()> {
    let m = &mut ctx.accounts.measurement;
    require!(m.status == MeasurementStatus::Active, VoynichError::InvalidMeasurement);
    let slot = Clock::get()?.slot;
    m.status = MeasurementStatus::Deprecated;
    emit_cpi!(MeasurementDeprecated {
        measurement: m.key(),
        digest: m.digest,
        authority: ctx.accounts.authority.key(),
        slot,
        status: MeasurementStatus::Deprecated,
    });
    Ok(())
}

pub fn set_policy(ctx: Context<SetPolicy>, args: PolicyArgs) -> Result<()> {
    require!(args.allowed_callers.len() <= MAX_POLICY_CALLERS, VoynichError::InvalidPolicy);
    require!(args.allowed_operators.len() <= MAX_POLICY_OPERATORS, VoynichError::InvalidPolicy);
    require!(args.allowed_regions.len() <= MAX_POLICY_REGIONS, VoynichError::InvalidPolicy);
    require!(
        (args.max_calls_per_caller_per_window == 0 && args.window_slots == 0)
            || (args.max_calls_per_caller_per_window > 0 && args.window_slots > 0),
        VoynichError::InvalidPolicy
    );
    for (i, caller) in args.allowed_callers.iter().enumerate() {
        require!(*caller != Pubkey::default(), VoynichError::InvalidPolicy);
        require!(!args.allowed_callers[..i].contains(caller), VoynichError::InvalidPolicy);
    }
    for (i, op) in args.allowed_operators.iter().enumerate() {
        require!(*op != Pubkey::default(), VoynichError::InvalidPolicy);
        require!(!args.allowed_operators[..i].contains(op), VoynichError::InvalidPolicy);
    }
    for (i, region) in args.allowed_regions.iter().enumerate() {
        require!(
            !region.is_empty()
                && region.len() <= MAX_POLICY_REGION_LEN
                && region.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
            VoynichError::InvalidPolicy
        );
        require!(!args.allowed_regions[..i].contains(region), VoynichError::InvalidPolicy);
    }
    let slot = Clock::get()?.slot;
    let p = &mut ctx.accounts.policy;
    p.model = ctx.accounts.model.key();
    p.allow_list_enabled = args.allow_list_enabled;
    p.allowed_callers = args.allowed_callers.clone();
    p.max_calls_per_caller_per_window = args.max_calls_per_caller_per_window;
    p.window_slots = args.window_slots;
    p.allowed_operators = args.allowed_operators.clone();
    p.allowed_regions = args.allowed_regions.clone();
    p.updated_slot = slot;
    p.bump = ctx.bumps.policy;
    ctx.accounts.model.has_policy = true;
    emit_cpi!(PolicyUpdated {
        policy: p.key(),
        model: p.model,
        allow_list_enabled: args.allow_list_enabled,
        allowed_callers: args.allowed_callers,
        max_calls_per_caller_per_window: args.max_calls_per_caller_per_window,
        window_slots: args.window_slots,
        allowed_operators: args.allowed_operators,
        allowed_regions: args.allowed_regions,
        updated_slot: slot,
    });
    zero_model_tail(&ctx.accounts.model)?;
    Ok(())
}

pub fn clear_policy(ctx: Context<ClearPolicy>) -> Result<()> {
    let slot = Clock::get()?.slot;
    ctx.accounts.model.has_policy = false;
    emit_cpi!(PolicyCleared {
        policy: ctx.accounts.policy.key(),
        model: ctx.accounts.model.key(),
        slot,
    });
    zero_model_tail(&ctx.accounts.model)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receipt_message_v1_and_v2_match_expected_wire_layouts() {
        let call = Pubkey::new_from_array([0x11; 32]);
        let input_hash = [0x22; 32];
        let output_hash = [0x33; 32];
        let base_sha256 = [0x44; 32];

        let v1 = build_receipt_message(&call, &input_hash, &output_hash, None);
        assert_eq!(v1.len(), 114);
        assert_eq!(&v1[..18], b"voynich/receipt/v1");
        assert_eq!(&v1[18..50], call.as_ref());
        assert_eq!(&v1[50..82], &input_hash);
        assert_eq!(&v1[82..114], &output_hash);

        let v2 = build_receipt_message(&call, &input_hash, &output_hash, Some(&base_sha256));
        assert_eq!(v2.len(), 146);
        assert_eq!(&v2[..18], b"voynich/receipt/v2");
        assert_eq!(&v2[18..50], call.as_ref());
        assert_eq!(&v2[50..82], &input_hash);
        assert_eq!(&v2[82..114], &output_hash);
        assert_eq!(&v2[114..146], &base_sha256);
    }

    #[test]
    fn receipt_space_preserves_voynich_cpi_layout() {
        assert_eq!(Receipt::BASE_SPACE, 401);
        assert_eq!(Receipt::space(0), 407);
        assert_eq!(Receipt::space(64), 471);
        assert_eq!(Receipt::METERED_EXTENSION, 16);
        assert_eq!(Receipt::METERED_SPACE, 423);
    }

    #[test]
    fn piece_message_v1_and_v2_match_expected_wire_layouts() {
        let call = Pubkey::new_from_array([0x11; 32]);
        let input_hash = [0x22; 32];
        let count = 61u64;
        let running_hash = [0x33; 32];
        let base_sha256 = [0x44; 32];

        let v1 = build_piece_message(&call, &input_hash, count, &running_hash, None);
        assert_eq!(v1.len(), 120);
        assert_eq!(&v1[..16], b"voynich/piece/v1");
        assert_eq!(&v1[16..48], call.as_ref());
        assert_eq!(&v1[48..80], &input_hash);
        assert_eq!(&v1[80..88], &count.to_le_bytes());
        assert_eq!(&v1[88..120], &running_hash);

        let v2 = build_piece_message(&call, &input_hash, count, &running_hash, Some(&base_sha256));
        assert_eq!(v2.len(), 152);
        assert_eq!(&v2[..16], b"voynich/piece/v2");
        assert_eq!(&v2[16..48], call.as_ref());
        assert_eq!(&v2[48..80], &input_hash);
        assert_eq!(&v2[80..88], &count.to_le_bytes());
        assert_eq!(&v2[88..120], &running_hash);
        assert_eq!(&v2[120..152], &base_sha256);
    }

    #[test]
    fn repair_model_tail_cleans_stale_slack_and_preserves_clean_token() {
        let owner = Pubkey::new_from_array([0x07; 32]);
        for with_base in [false, true] {
            let model = Model {
                owner,
                name: "text-1m".to_string(),
                manifest: b"{}".to_vec(),
                weights: vec![Pubkey::new_from_array([0x08; 32])],
                size_bytes: 214_737,
                cipher: CIPHER.to_string(),
                nonce_prefix: [0x09; 16],
                ciphertext_sha256: [0x0a; 32],
                allowed_measurements: vec![[0x0b; 48], [0x0c; 48]],
                price: 5_000_000,
                price_mint: Pubkey::default(),
                operator_share_bps: 2500,
                upload_key: Pubkey::default(),
                status: ModelStatus::Live,
                created_slot: 100,
                sealed_slot: 200,
                calls_settled: 2,
                bump: 251,
                upload_keys: Vec::new(),
                hash_version: 1,
                sealed_chunks: 4,
                merkle_frontier: Vec::new(),
                merkle_frontier_mask: 0,
                base: if with_base {
                    Some(ModelBase {
                        sha256: [0x0d; 32],
                        size_bytes: 6_143_522,
                        format: "onnx".to_string(),
                        source: "https://example.com/base.onnx".to_string(),
                    })
                } else {
                    None
                },
                price_unit: PriceUnit::Token,
                has_policy: false,
            };

            let mut encoded = Vec::new();
            model.try_serialize(&mut encoded).unwrap();
            let mut buf = vec![0u8; Model::SPACE];
            buf[..encoded.len()].copy_from_slice(&encoded);

            let (parsed_owner, parsed_name, parsed_bump, prefix_end) = parse_model_prefix(&buf).unwrap();
            assert_eq!(parsed_owner, owner);
            assert_eq!(parsed_name, "text-1m");
            assert_eq!(parsed_bump, 251);
            assert_eq!(prefix_end, encoded.len() - 2);

            // Clean PriceUnit::Token with zero tail stays untouched.
            repair_model_tail_bytes(&mut buf, prefix_end).unwrap();
            let token_decoded = Model::try_deserialize(&mut &buf[..]).unwrap();
            assert_eq!(token_decoded.price_unit, PriceUnit::Token);
            assert_eq!(token_decoded.has_policy, false);

            // Dirty slack past prefix_end fails deserialization until repaired to PriceUnit::Call + zero tail.
            let stale = b".mypinata.";
            buf[prefix_end..prefix_end + stale.len()].copy_from_slice(stale);
            assert!(Model::try_deserialize(&mut &buf[..]).is_err());

            repair_model_tail_bytes(&mut buf, prefix_end).unwrap();
            let repaired = Model::try_deserialize(&mut &buf[..]).unwrap();
            assert_eq!(repaired.price_unit, PriceUnit::Call);
            assert_eq!(repaired.has_policy, false);
            assert!(buf[prefix_end + 2..].iter().all(|&b| b == 0));
        }
    }
}
