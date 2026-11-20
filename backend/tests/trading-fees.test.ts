import assert from 'node:assert/strict'
import test from 'node:test'
import { NATIVE_MINT } from '@solana/spl-token'
import { buybackShareOf, combineBuybackCredits, parseClaimedBalances } from '../src/chain/trading-fees.js'

const WSOL = NATIVE_MINT.toBase58()
const FEE_WALLET = 'HfuLG14BQwGxdKVGkf7tTVXcKyRXiHpG4B8T5QtfXV1n'
const POOL_AUTHORITY = 'FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM'
const VOYNICH_MINT = 'baQxEuzMJ69RExbkCGLSrdSueWXCfp4tbi4nKZQpvoy'

test('buybackShareOf computes exact 25% rounded down with zero/negative guards', () => {
  assert.equal(buybackShareOf(8_555_698_807n, 2500), 2_138_924_701n)
  assert.equal(buybackShareOf(10_003n, 2500), 2_500n)
  assert.equal(buybackShareOf(0n, 2500), 0n)
  assert.equal(buybackShareOf(-100n, 2500), 0n)
  assert.equal(buybackShareOf(8_555_698_807n, 0), 0n)
})

test('parseClaimedBalances uses WSOL vault outflow to exclude tx fees and ATA rent', () => {
  const result = parseClaimedBalances(
    {
      fee: 105_000,
      preBalances: [2_500_000_000, 1_000_000],
      postBalances: [11_055_593_807, 1_000_000],
      preTokenBalances: [
        { mint: WSOL, owner: POOL_AUTHORITY, uiTokenAmount: { amount: '33040952709' } },
        { mint: VOYNICH_MINT, owner: FEE_WALLET, uiTokenAmount: { amount: '1' } },
      ],
      postTokenBalances: [
        { mint: WSOL, owner: POOL_AUTHORITY, uiTokenAmount: { amount: '24485253902' } },
        { mint: VOYNICH_MINT, owner: FEE_WALLET, uiTokenAmount: { amount: '1' } },
      ],
    },
    FEE_WALLET,
    VOYNICH_MINT,
    [FEE_WALLET, POOL_AUTHORITY],
  )
  assert.equal(result.claimedSol, 8_555_698_807n)
  assert.equal(result.claimedBase, 0n)
})

test('parseClaimedBalances parses DAMM v2 dual-sided base + quote claim and SOL fallback', () => {
  const dammResult = parseClaimedBalances(
    {
      fee: 50_000,
      preBalances: [1_000_000_000],
      postBalances: [1_999_950_000],
      preTokenBalances: [
        { mint: VOYNICH_MINT, owner: FEE_WALLET, uiTokenAmount: { amount: '1' } },
      ],
      postTokenBalances: [
        { mint: VOYNICH_MINT, owner: FEE_WALLET, uiTokenAmount: { amount: '4000001' } },
      ],
    },
    FEE_WALLET,
    VOYNICH_MINT,
    [FEE_WALLET],
  )
  assert.equal(dammResult.claimedSol, 1_000_000_000n)
  assert.equal(dammResult.claimedBase, 4_000_000n)
})

test('combineBuybackCredits merges SOL trading fee share with protocol payments while keeping SPL separate', () => {
  const withProtocol = combineBuybackCredits(
    [
      { mint: null, amount: 500_000n },
      { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: 1_000_000n },
    ],
    2_138_924_701n,
  )
  assert.deepEqual(withProtocol, [
    { mint: null, amount: 2_139_424_701n },
    { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: 1_000_000n },
  ])

  const tradingOnly = combineBuybackCredits([], 2_138_924_701n)
  assert.deepEqual(tradingOnly, [{ mint: null, amount: 2_138_924_701n }])
})
