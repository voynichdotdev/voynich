use anchor_lang::{prelude::*, solana_program::hash::hashv, Discriminator};
use crate::{
    errors::VoynichError,
    state::{Model, Weights, CIPHER_CHUNK_BYTES, MAX_MERKLE_LEVELS, MAX_SEAL_RANGE_CHUNKS, MAX_WEIGHTS, WEIGHTS_HEADER},
};

const CHUNK_DOMAIN: &[u8] = b"voynich/chunk/v1";
const NODE_DOMAIN: &[u8] = b"voynich/node/v1";

fn header(data: &[u8]) -> Result<Weights> {
    require!(data.len() >= WEIGHTS_HEADER, VoynichError::InvalidWeights);
    Weights::try_deserialize(&mut &data[..]).map_err(|_| error!(VoynichError::InvalidWeights))
}

pub fn total_chunks(size_bytes: u64) -> Result<u32> {
    require!(size_bytes > 0, VoynichError::InvalidWeights);
    let chunk = CIPHER_CHUNK_BYTES as u64;
    let count = size_bytes
        .checked_add(chunk - 1)
        .ok_or(VoynichError::ArithmeticOverflow)?
        / chunk;
    u32::try_from(count).map_err(|_| error!(VoynichError::ArithmeticOverflow))
}

pub fn merkle_parent(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    hashv(&[NODE_DOMAIN, left, right]).to_bytes()
}

pub fn push_merkle_leaf(frontier: &mut Vec<[u8; 32]>, mask: &mut u32, leaf: [u8; 32]) -> Result<()> {
    let mut level: usize = 0;
    let mut h = leaf;
    while level < MAX_MERKLE_LEVELS && (*mask & (1u32 << level)) != 0 {
        let left = *frontier.get(level).ok_or(VoynichError::InvalidWeights)?;
        *mask &= !(1u32 << level);
        h = merkle_parent(&left, &h);
        level += 1;
    }
    require!(level < MAX_MERKLE_LEVELS, VoynichError::ArithmeticOverflow);
    if level >= frontier.len() {
        frontier.resize(level + 1, [0u8; 32]);
    }
    frontier[level] = h;
    *mask |= 1u32 << level;
    Ok(())
}

pub fn finalize_merkle(frontier: &[[u8; 32]], mask: u32) -> Result<[u8; 32]> {
    let mut acc: Option<[u8; 32]> = None;
    for (level, peak) in frontier.iter().enumerate() {
        if level < MAX_MERKLE_LEVELS && (mask & (1u32 << level)) != 0 {
            acc = Some(match acc {
                None => *peak,
                Some(right) => merkle_parent(peak, &right),
            });
        }
    }
    acc.ok_or_else(|| error!(VoynichError::UploadIncomplete))
}

/// Initializes a sequential batch of zero-header Weights accounts starting at `start_index` and `start_offset`.
/// Stores each account's global ciphertext offset in `Weights.reserved` (u32 covers up to 4 GiB).
pub fn initialize_batch(
    model: Pubkey,
    existing_keys: &[Pubkey],
    accounts: &[AccountInfo],
    start_offset: u64,
    total_size_bytes: u64,
) -> Result<Vec<Pubkey>> {
    require!(!accounts.is_empty(), VoynichError::InvalidWeights);
    require!(existing_keys.len() + accounts.len() <= MAX_WEIGHTS, VoynichError::InvalidWeights);
    let rent = Rent::get()?;
    let mut cursor = start_offset;
    let mut keys = Vec::with_capacity(accounts.len());
    for (offset_index, info) in accounts.iter().enumerate() {
        require_keys_eq!(*info.owner, crate::ID, VoynichError::InvalidWeights);
        require!(
            info.is_writable && info.data_len() > WEIGHTS_HEADER && info.data_len() <= 10 * 1024 * 1024,
            VoynichError::InvalidWeights
        );
        require!(rent.is_exempt(info.lamports(), info.data_len()), VoynichError::InvalidWeights);
        require!(!existing_keys.contains(info.key) && !keys.contains(info.key), VoynichError::InvalidWeights);
        let mut data = info.try_borrow_mut_data()?;
        require!(data[..WEIGHTS_HEADER].iter().all(|byte| *byte == 0), VoynichError::InvalidWeights);
        let bytes = (data.len() - WEIGHTS_HEADER) as u32;
        let global_offset = u32::try_from(cursor).map_err(|_| error!(VoynichError::ArithmeticOverflow))?;
        let index = u32::try_from(existing_keys.len() + offset_index).map_err(|_| error!(VoynichError::ArithmeticOverflow))?;
        Weights {
            model,
            index,
            size_bytes: bytes,
            written_bytes: 0,
            reserved: global_offset,
        }
        .try_serialize(&mut &mut data[..WEIGHTS_HEADER])?;
        cursor = cursor.checked_add(u64::from(bytes)).ok_or(VoynichError::ArithmeticOverflow)?;
        keys.push(*info.key);
    }
    require!(cursor <= total_size_bytes, VoynichError::InvalidWeights);
    Ok(keys)
}

/// Reads the cumulative end offset after the last currently attached Weights account.
pub fn attached_end_offset(model: Pubkey, model_data: &Model, last_info: &AccountInfo) -> Result<u64> {
    let last_index = model_data.weights.len().checked_sub(1).ok_or(VoynichError::InvalidWeights)?;
    require_keys_eq!(*last_info.key, model_data.weights[last_index], VoynichError::InvalidWeights);
    require_keys_eq!(*last_info.owner, crate::ID, VoynichError::InvalidWeights);
    let data = last_info.try_borrow_data()?;
    let record = header(&data)?;
    require_keys_eq!(record.model, model, VoynichError::InvalidWeights);
    require!(
        record.index as usize == last_index && data.len() == WEIGHTS_HEADER + record.size_bytes as usize,
        VoynichError::InvalidWeights
    );
    u64::from(record.reserved)
        .checked_add(u64::from(record.size_bytes))
        .ok_or_else(|| error!(VoynichError::ArithmeticOverflow))
}

pub fn write(model: Pubkey, model_data: &Model, info: &AccountInfo, offset: u32, bytes: &[u8]) -> Result<u32> {
    require_keys_eq!(*info.owner, crate::ID, VoynichError::InvalidWeights);
    let mut data = info.try_borrow_mut_data()?;
    let mut record = header(&data)?;
    require_keys_eq!(record.model, model, VoynichError::InvalidWeights);
    require!(model_data.weights.get(record.index as usize) == Some(info.key), VoynichError::InvalidWeights);
    require!(data.len() == WEIGHTS_HEADER + record.size_bytes as usize, VoynichError::InvalidWeights);
    let end = offset
        .checked_add(u32::try_from(bytes.len()).map_err(|_| error!(VoynichError::InvalidWrite))?)
        .ok_or(VoynichError::InvalidWrite)?;
    require!(!bytes.is_empty() && end <= record.size_bytes, VoynichError::InvalidWrite);
    data[WEIGHTS_HEADER + offset as usize..WEIGHTS_HEADER + end as usize].copy_from_slice(bytes);
    // Writes may land in any order (clients send them in parallel); written_bytes is the
    // high-water mark, and sealing hashes the whole ciphertext against the owner's commitment.
    record.written_bytes = record.written_bytes.max(end);
    record.try_serialize(&mut &mut data[..WEIGHTS_HEADER])?;
    Ok(record.written_bytes)
}

/// Hashes `chunk_count` consecutive 64 KiB ciphertext chunks starting at `model_data.sealed_chunks`
/// from the contiguous covering Weights accounts in `accounts` and updates the Merkle frontier.
pub fn hash_chunks(
    model: Pubkey,
    model_data: &mut Model,
    accounts: &[AccountInfo],
    chunk_count: u32,
) -> Result<(u32, u32)> {
    require!(chunk_count > 0 && chunk_count <= MAX_SEAL_RANGE_CHUNKS, VoynichError::InvalidWrite);
    require!(!accounts.is_empty(), VoynichError::InvalidWeights);
    let total = total_chunks(model_data.size_bytes)?;
    let start_chunk = model_data.sealed_chunks;
    let end_chunk = start_chunk.checked_add(chunk_count).ok_or(VoynichError::ArithmeticOverflow)?;
    require!(end_chunk <= total, VoynichError::InvalidWrite);

    let chunk_size = CIPHER_CHUNK_BYTES as u64;
    let range_start = u64::from(start_chunk) * chunk_size;
    let range_end = (u64::from(end_chunk) * chunk_size).min(model_data.size_bytes);

    let mut borrowed = Vec::with_capacity(accounts.len());
    let mut prev_index: Option<u32> = None;
    let mut prev_end: Option<u64> = None;
    for info in accounts {
        require_keys_eq!(*info.owner, crate::ID, VoynichError::InvalidWeights);
        let data = info.try_borrow_data()?;
        let record = header(&data)?;
        require_keys_eq!(record.model, model, VoynichError::InvalidWeights);
        require!(model_data.weights.get(record.index as usize) == Some(info.key), VoynichError::InvalidWeights);
        require!(data.len() == WEIGHTS_HEADER + record.size_bytes as usize, VoynichError::InvalidWeights);
        require!(record.written_bytes == record.size_bytes, VoynichError::UploadIncomplete);
        let acc_start = u64::from(record.reserved);
        let acc_end = acc_start.checked_add(u64::from(record.size_bytes)).ok_or(VoynichError::ArithmeticOverflow)?;
        if let (Some(pi), Some(pe)) = (prev_index, prev_end) {
            require!(record.index == pi + 1 && acc_start == pe, VoynichError::InvalidWeights);
        }
        prev_index = Some(record.index);
        prev_end = Some(acc_end);
        borrowed.push((record.index, acc_start, acc_end, data));
    }

    let (first_index, first_start, _, _) = borrowed.first().ok_or(VoynichError::InvalidWeights)?;
    let (last_index, _, last_end, _) = borrowed.last().ok_or(VoynichError::InvalidWeights)?;
    require!(*first_start <= range_start && *last_end >= range_end, VoynichError::InvalidWeights);
    if start_chunk == 0 {
        require!(*first_index == 0 && *first_start == 0, VoynichError::InvalidWeights);
    }
    if end_chunk == total {
        require!(
            *last_index as usize + 1 == model_data.weights.len() && *last_end == model_data.size_bytes,
            VoynichError::InvalidWeights
        );
    }

    let mut frontier = core::mem::take(&mut model_data.merkle_frontier);
    let mut mask = model_data.merkle_frontier_mask;
    for chunk_index in start_chunk..end_chunk {
        let c_start = u64::from(chunk_index) * chunk_size;
        let c_end = (c_start + chunk_size).min(model_data.size_bytes);
        let index_bytes = chunk_index.to_le_bytes();
        let mut slices: Vec<&[u8]> = Vec::with_capacity(borrowed.len() + 2);
        slices.push(CHUNK_DOMAIN);
        slices.push(&index_bytes);
        for (_, acc_start, acc_end, data) in &borrowed {
            if *acc_end <= c_start || *acc_start >= c_end {
                continue;
            }
            let local_start = (c_start.max(*acc_start) - *acc_start) as usize;
            let local_end = (c_end.min(*acc_end) - *acc_start) as usize;
            slices.push(&data[WEIGHTS_HEADER + local_start..WEIGHTS_HEADER + local_end]);
        }
        let leaf = hashv(&slices).to_bytes();
        push_merkle_leaf(&mut frontier, &mut mask, leaf)?;
    }
    model_data.merkle_frontier = frontier;
    model_data.merkle_frontier_mask = mask;
    model_data.sealed_chunks = end_chunk;
    Ok((start_chunk, end_chunk))
}

/// Legacy v0 single-transaction flat SHA-256 over all Weights accounts.
pub fn hash(model: Pubkey, model_data: &Model, accounts: &[AccountInfo]) -> Result<[u8; 32]> {
    require!(accounts.len() == model_data.weights.len(), VoynichError::InvalidWeights);
    let mut borrowed = Vec::with_capacity(accounts.len());
    for (index, info) in accounts.iter().enumerate() {
        require_keys_eq!(*info.key, model_data.weights[index], VoynichError::InvalidWeights);
        require_keys_eq!(*info.owner, crate::ID, VoynichError::InvalidWeights);
        let data = info.try_borrow_data()?;
        let record = header(&data)?;
        require_keys_eq!(record.model, model, VoynichError::InvalidWeights);
        require!(record.index as usize == index && data.len() == WEIGHTS_HEADER + record.size_bytes as usize, VoynichError::InvalidWeights);
        require!(record.written_bytes == record.size_bytes, VoynichError::UploadIncomplete);
        borrowed.push(data);
    }
    let slices: Vec<&[u8]> = borrowed.iter().map(|data| &data[WEIGHTS_HEADER..]).collect();
    Ok(hashv(&slices).to_bytes())
}

// Keep the raw account discriminator exposed through the IDL's Weights type.
const _: &[u8] = Weights::DISCRIMINATOR;

#[cfg(test)]
mod tests {
    use super::*;

    fn reference_merkle(chunks: &[Vec<u8>]) -> [u8; 32] {
        let mut frontier = Vec::new();
        let mut mask = 0u32;
        for (i, chunk) in chunks.iter().enumerate() {
            let idx = (i as u32).to_le_bytes();
            let leaf = hashv(&[CHUNK_DOMAIN, &idx, chunk]).to_bytes();
            push_merkle_leaf(&mut frontier, &mut mask, leaf).unwrap();
        }
        finalize_merkle(&frontier, mask).unwrap()
    }

    #[test]
    fn merkle_frontier_matches_explicit_tree_across_chunk_counts() {
        for count in [1usize, 2, 3, 4, 5, 8, 9, 17, 33] {
            let chunks: Vec<Vec<u8>> = (0..count).map(|i| vec![(i as u8).wrapping_mul(17); 64 + (i % 13)]).collect();
            let root = reference_merkle(&chunks);
            // Compute via explicit level-by-level reduction promoting odd nodes.
            let mut leaves: Vec<[u8; 32]> = chunks
                .iter()
                .enumerate()
                .map(|(i, c)| hashv(&[CHUNK_DOMAIN, &(i as u32).to_le_bytes(), c]).to_bytes())
                .collect();
            while leaves.len() > 1 {
                let mut next = Vec::with_capacity((leaves.len() + 1) / 2);
                let mut i = 0;
                while i + 1 < leaves.len() {
                    next.push(merkle_parent(&leaves[i], &leaves[i + 1]));
                    i += 2;
                }
                if i < leaves.len() {
                    next.push(leaves[i]);
                }
                leaves = next;
            }
            assert_eq!(root, leaves[0], "mismatch for count={count}");
        }
    }
}
