import type { Metadata } from 'next'
import Link from 'next/link'
import { api, fixtureFrom, read, type Read } from '@/lib/api'
import { CRYPTO, HARDWARE, LINKS, RECEIPT_CHECKS, SKETCH32 } from '@/lib/facts'
import { b64ToBytes, group, hardware } from '@/lib/format'
import { Amount, Failed, Hash, Size } from '@/components/ui/kit'
import { ByteTiles, State } from '@/components/tile/Tile'
import { Tick } from '@/components/drawn/Drawn'
import { Life, Track } from '@/components/enclave/parts'
import { Live, Opening, missing } from '@/components/pages/parts'
import { Wall } from '@/components/pages/Diagram'
import { GrantWrap, KeyPath } from '@/components/pages/diagrams'
import s from '@/components/pages/pages.module.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Sealing',
  description: 'How a model stays closed in public: the model key from the owner’s device, through the attestation record and the grant, to a receipt.',
}

const then = <T, U>(r: Read<T>, f: (t: T) => U): Read<U> => (r.ok ? { ok: true, data: f(r.data) } : r)
const caps = (address: string) => Array.from(address.slice(0, 4), (c) => c.charCodeAt(0))

export default async function Sealing({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const fixture = fixtureFrom(await searchParams)
  const q = fixture ? `?fixture=${fixture}` : ''
  const a = api(fixture)
  const id = SKETCH32.id
  const [model, weights, enclaves, receipts, stats] = await Promise.all([
    read(a.model(id)), read(a.weights(id, { length: 2048 })), read(a.modelEnclaves(id)), read(a.modelReceipts(id, { limit: 1 })), read(a.stats()),
  ])
  const held = then(enclaves, (d) => d.items.find((x) => x.grant.status === 'live') ?? d.items[0] ?? null)
  const receipt = then(receipts, (d) => d.items[0] ?? null)
  const call = receipt.ok && receipt.data ? await read(a.call(receipt.data.call)) : then(receipt, () => null)

  const cipher = weights.ok ? b64ToBytes(weights.data.bytesBase64) : undefined
  const m = model.ok ? model.data : undefined
  const h = held.ok ? held.data ?? undefined : undefined
  const rc = receipt.ok ? receipt.data ?? undefined : undefined
  const now = stats.ok ? stats.data.currentSlot : undefined

  return (
    <>
      <Opening title="How a model stays closed in public" form={5} bytes={cipher}>
        The weights of a sealed model are on Solana for anyone to fetch. This page follows the one key that opens them, from the owner&rsquo;s device to the receipt an answer leaves.
      </Opening>

      <article className={`container ${s.article}`}>
        <section className={s.sec} aria-labelledby="key">
          <div className={`grid ${s.pathHead}`}>
            <h2 id="key" className="t-h2">Where the model key exists</h2>
            <p className="t-body" data-more>
              The key is in plaintext in two kinds of place only: the owner&rsquo;s device at sealing, and enclaves that hold a grant under an unexpired attestation record. On chain it appears wrapped, never open.
            </p>
          </div>
          <KeyPath cipher={cipher} model={m} held={h} receipt={rc} />
        </section>

        <section className={`grid ${s.sec} ${s.split}`} data-lead="held" aria-labelledby="bytes">
          <div className={s.held}>
            {!weights.ok && !missing(weights) ? (
              <Failed title={`The ciphertext of ${SKETCH32.name} did not load`} message={weights.message} />
            ) : !cipher?.length ? (
              <p className={s.none}>No model is sealed under the name {SKETCH32.name}.</p>
            ) : (
              <>
                <div className={s.bytesHead}>
                  <span className={s.bytesName}>{SKETCH32.name}</span>
                  {m ? <State state={m.status} /> : null}
                </div>
                <Wall bytes={cipher} n={480} size="m" className={s.bytesWall} />
              </>
            )}
            {!model.ok ? (missing(model) ? null : <Failed title={`${SKETCH32.name} did not load`} message={model.message} />) : ((d) => (
                <>
                  <dl className={s.facts}>
                    <div><dt>Ciphertext</dt><dd><Size n={d.sizeBytes} /></dd></div>
                    <div><dt>{CRYPTO.hash}</dt><dd>{d.ciphertextSha256 ? <Hash value={d.ciphertextSha256} chars={6} label="ciphertext hash" /> : <span className="dim">fixed at sealing</span>}</dd></div>
                    <div><dt>Sealed at slot</dt><dd className="mono">{d.sealedSlot ? group(d.sealedSlot) : <span className="dim">not sealed</span>}</dd></div>
                  </dl>
                  <p className={s.more}>
                    <span data-more>The first bytes of the ciphertext, as the chain holds them.</span>
                    <Link className="link" data-arrow href={`/models/${d.name}${q}`}>Open {d.name}</Link>
                  </p>
                </>
              ))(model.data)}
          </div>
          <div className={s.text}>
            <h2 id="bytes" className="t-h2">The weights are public bytes</h2>
            <p className="t-body">
              Sealing starts on the owner&rsquo;s device. It draws a random {CRYPTO.weightsKeyBits}-bit model key and encrypts the weights under it with {CRYPTO.weights}, in chunks, so any range of the file verifies on its own.
            </p>
            <p className="t-body" data-more>
              The ciphertext is written into Solana accounts, and sealing fixes its {CRYPTO.hash}. From that slot the bytes cannot change. Anyone can fetch every byte, and the bytes say nothing without the key.
            </p>
            <Link className={`link ${s.docs}`} data-arrow href={LINKS.concepts.models}>Sealed models in the docs</Link>
          </div>
        </section>

        <section className={`grid ${s.sec} ${s.split}`} data-lead="text" aria-labelledby="record">
          <div className={s.text}>
            <h2 id="record" className="t-h2">What the chain records about the enclave</h2>
            <p className="t-body">
              An enclave runs the enclave runtime on a standard server at mainnet launch, or inside a confidential VM once {HARDWARE.attestation} opens on mainnet. At boot it makes two keys: an {CRYPTO.signatures} signing key and an X25519 encryption key, and binds the signing key and software measurement to a recent Solana slot.
            </p>
            <p className="t-body" data-more>
              The configured verifier (<span className="mono">{HARDWARE.launchVerifier}</span> at launch, switching via <span className="mono">set_config</span> to {HARDWARE.attestation}) verifies that report on chain and writes an attestation record. The owner of a model lists the measurements allowed to open it, so the record decides whether an enclave can be granted.
            </p>
            <Link className={`link ${s.docs}`} data-arrow href={LINKS.concepts.enclaves}>Enclaves and attestation in the docs</Link>
          </div>
          <div className={s.held}>
            <Live of={held} title={`The record of the enclave holding ${SKETCH32.name}`} none={`No enclave holds a grant to ${SKETCH32.name} yet.`}>
              {(d) => {
                const r = d.enclave.attestation
                const expired = d.enclave.status === 'expired'
                return (
                  <section className={s.object} data-expired={expired || undefined} aria-label={`The attestation record of the enclave holding ${SKETCH32.name}`}>
                    <div className={s.objectHead}>
                      <div className={s.objectName}>
                        <ByteTiles bytes={caps(r.address)} size={28} />
                        <h3>Attestation record</h3>
                      </div>
                      <State state={expired ? 'expired' : 'sealed'} label={expired ? 'Expired' : 'Recorded'} />
                    </div>
                    <dl className={s.objectList}>
                      <dt data-more>Signing key</dt><dd data-more><Hash value={r.signingKey} full label="signing key" /></dd>
                      <dt data-more>Encryption key</dt><dd data-more><Hash value={r.encryptionKey} full label="encryption key" /></dd>
                      <dt>Hardware type</dt><dd>{hardware(r.hardwareType)}</dd>
                      <dt data-more>Measurement</dt><dd data-more><Hash value={r.measurement} full label="measurement" /></dd>
                    </dl>
                    {now ? <Life record={r} currentSlot={now} expired={expired} cells={40} /> : (
                      <p className="t-small">Recorded at slot <span className="mono">{group(r.recordedSlot)}</span>. Expires at slot <span className={`mono ${expired ? 'bad' : ''}`}>{group(r.expiresAtSlot)}</span>.</p>
                    )}
                    <p className={s.more}>
                      <span data-more>Its grants, receipts and earnings</span>
                      <Link className="link" data-arrow href={`/enclaves/${d.enclave.address}${q}`}>Open this enclave</Link>
                    </p>
                  </section>
                )
              }}
            </Live>
          </div>
        </section>

        <section className={`${s.sec} ${s.alone}`} aria-labelledby="grant">
          <h2 id="grant" className="t-h2">A grant is the model key, wrapped</h2>
          <GrantWrap grant={h?.grant} />
          <div className={`grid ${s.aloneText}`}>
            <p className="t-body">
              A grant is the model key wrapped to one enclave&rsquo;s encryption key, with {CRYPTO.wrap}. It sits on chain beside the model, and only the enclave it names can unwrap it, inside its runtime.
            </p>
            <p className="t-body" data-more>
              The owner makes the first grant. After that a granted enclave can grant the next one: it checks the newcomer&rsquo;s record, wraps the key inside the enclave and signs the grant. Capacity grows while the owner is offline.
            </p>
            <div className={s.held}>
              <Live of={held} title={`The grant to ${SKETCH32.name}`} none={`${SKETCH32.name} has no grant yet.`}>
                {(d) => (
                  <dl className={s.facts}>
                    <div><dt>Granted to</dt><dd><Hash value={d.enclave && d.enclave.address === d.grant.enclave ? d.enclave.signingKey : d.grant.enclave} chars={4} href={`/enclaves/${d.grant.enclave}${q}`} label="enclave address" /></dd></div>
                    <div><dt>Granted by</dt><dd><Hash value={d.grant.grantedBy} chars={4} label="granting key" />{m && d.grant.grantedBy === m.owner ? <span className="dim"> owner</span> : null}</dd></div>
                    <div><dt>Granted at slot</dt><dd className="mono">{group(d.grant.grantedSlot)}</dd></div>
                    <div data-more><dt>Status</dt><dd><State state={d.grant.status} label={d.grant.status === 'live' ? 'Live' : d.grant.status === 'expired' ? 'Expired' : 'Revoked'} /></dd></div>
                  </dl>
                )}
              </Live>
              <Link className={`link ${s.docs}`} data-arrow href={LINKS.concepts.grants}>Grants in the docs</Link>
            </div>
          </div>
        </section>

        <section className={`grid ${s.sec} ${s.split}`} data-lead="held" aria-labelledby="call">
          <div className={s.held}>
            <Live of={call} title={`The latest call to ${SKETCH32.name}`} none={`No call has been opened on ${SKETCH32.name} yet.`}>
              {(d) => {
                const from = BigInt(d.openedSlot), to = BigInt(d.deadlineSlot)
                const span = to > from ? to - from : 1n
                const at = d.status === 'settled' && rc ? BigInt(rc.slot) : now ? BigInt(now) : from
                const over = d.status === 'refundable' || d.status === 'refunded'
                const gone = at <= from ? 0 : at >= to ? 1 : Number(((at - from) * 1000n) / span) / 1000
                return (
                  <>
                    <div className={s.escrow}>
                      <div className={s.escrowSum}>
                        <span className="t-label">Price in escrow, the latest call to {SKETCH32.name}</span>
                        <Amount value={d.price} size="l" />
                      </div>
                      <State state={d.status} label={d.status.charAt(0).toUpperCase() + d.status.slice(1)} />
                    </div>
                    <div className={s.deadline}>
                      <div className={s.deadlineEnds}>
                        <span><span className="t-label">Opened at slot</span> <span className="mono">{group(d.openedSlot)}</span></span>
                        <span><span className="t-label">Deadline slot</span> <span className={`mono ${over ? 'bad' : ''}`}>{group(d.deadlineSlot)}</span></span>
                      </div>
                      <Track gone={gone} over={over} cells={40}>
                        {d.status === 'settled' && rc ? <>Settled at slot <span className="mono">{group(rc.slot)}</span></>
                          : over ? <>Deadline passed, {d.status}</>
                          : <><span className="mono">{group((to > at ? to - at : 0n).toString())}</span> slots to the deadline</>}
                      </Track>
                    </div>
                    <dl className={s.facts}>
                      <div><dt>Call</dt><dd><Hash value={d.address} chars={6} label="call address" /></dd></div>
                      <div><dt>Caller</dt><dd><Hash value={d.caller} chars={6} label="caller" /></dd></div>
                      <div data-more><dt>Input hash</dt><dd><Hash value={d.inputHash} chars={6} label="input hash" /></dd></div>
                    </dl>
                  </>
                )
              }}
            </Live>
          </div>
          <div className={s.text}>
            <h2 id="call" className="t-h2">A call holds a price and a deadline</h2>
            <p className="t-body">
              A caller&rsquo;s input is encrypted on their device to the enclave&rsquo;s encryption key. The caller signs once. That opens a call on chain holding the hash of the encrypted input, the model&rsquo;s price in escrow and a deadline slot.
            </p>
            <p className="t-body" data-more>
              The enclave runs the model and encrypts the output to a key the caller made for this one call. A call not settled by its deadline is refunded to the caller in full.
            </p>
            <Link className={`link ${s.docs}`} data-arrow href={LINKS.concepts.calls}>Calls and receipts in the docs</Link>
          </div>
        </section>

        <section className={s.sec} aria-labelledby="receipt">
          <div className={`grid ${s.proofHead}`}>
            <h2 id="receipt" className="t-h2">What a receipt proves</h2>
            <p className="t-body">
              When the enclave answers, it signs the call, the input hash and the output hash with its {CRYPTO.signatures} key. The program checks that signature, writes the receipt, and pays the owner, the operator and the protocol share in the same instruction. Anyone can run the same checks in a browser.
            </p>
          </div>
          <ol className={s.checks}>
            {RECEIPT_CHECKS.map((c) => (
              <li key={c.id} className={s.check}>
                <Tick size={44} />
                <h3>{c.label}</h3>
                <p>{c.says}</p>
              </li>
            ))}
          </ol>
          <div className={s.proofFoot}>
            <Live of={receipt} title={`The latest receipt of ${SKETCH32.name}`} none={`${SKETCH32.name} has not settled a call yet.`}>
              {(d) => (
                <>
                  <div className={s.proofOf}>
                    <span>The latest receipt of {SKETCH32.name}</span>
                    <Hash value={d.address} chars={6} href={`/receipts/${d.address}${q}`} label="receipt address" />
                    <span>settled at slot <span className="mono">{group(d.slot)}</span></span>
                  </div>
                  <div className={s.proofActs}>
                    <Link className={`link ${s.docs}`} style={{ marginTop: 0 }} data-arrow href={LINKS.verifyGuide}>Verify a receipt in the docs</Link>
                    <Link className="btn" href={`/receipts/${d.address}${q}`}>Verify</Link>
                  </div>
                </>
              )}
            </Live>
          </div>
        </section>

        <div className={s.close}>
          <p className="t-lead">
            <span className="mono" style={{ fontSize: '0.9em', color: 'var(--text)' }}>{SKETCH32.name}</span> is sealed this way. Draw something, and read the receipt it leaves.
          </p>
          <div className={s.closeActs}>
            <Link href={`/models/${SKETCH32.id}${q}`} className="btn" data-kind="primary">Call {SKETCH32.name}</Link>
          </div>
        </div>
      </article>
    </>
  )
}
