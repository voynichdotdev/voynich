import type { Metadata } from 'next'
import Link from 'next/link'
import { api, fixtureFrom, read } from '@/lib/api'
import { HARDWARE, LINKS, SKETCH32 } from '@/lib/facts'
import { b64ToBytes, bps, group } from '@/lib/format'
import { Amount, Failed, Stat } from '@/components/ui/kit'
import { State, TileStrip } from '@/components/tile/Tile'
import { capFill } from '@/components/field/ramp'
import { Opening, missing } from '@/components/pages/parts'
import { OperatorSteps } from '@/components/pages/diagrams'
import s from '@/components/pages/pages.module.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Operators',
  description: 'Run an enclave: what an operator runs, the attestation modes and hardware types, how grants arrive, and what each settled call pays.',
}

const OWNER = 6, PROTOCOL = 12

export default async function Operators({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const fixture = fixtureFrom(await searchParams)
  const q = fixture ? `?fixture=${fixture}` : ''
  const a = api(fixture)
  const [stats, enclaves, model, weights] = await Promise.all([read(a.stats()), read(a.enclaves()), read(a.model(SKETCH32.id)), read(a.weights(SKETCH32.id, { length: 2048 }))])

  const settled = enclaves.ok ? enclaves.data.items.reduce((n, e) => n + BigInt(e.callsSettled), 0n) : 0n
  const live = enclaves.ok ? enclaves.data.items.filter((e) => e.status === 'live').length : 0

  const m = model.ok ? model.data : null
  const split = m ? (() => {
    const total = BigInt(m.price.amount)
    const operator = (total * BigInt(m.operatorShareBps)) / 10000n
    const protocol = m.protocolShareBps === null ? null : (total * BigInt(m.protocolShareBps)) / 10000n
    const owner = total - operator - (protocol ?? 0n)
    const of = (v: bigint) => ({ ...m.price, amount: v.toString() })
    const share = (v: bigint) => (total > 0n ? Number((v * 10000n) / total) / 10000 : 0)
    return { total, operator, protocol, owner, of, share }
  })() : null

  return (
    <>
      <Opening title="Run an enclave" form={7} side="left" bytes={weights.ok ? b64ToBytes(weights.data.bytesBase64) : undefined}>
        An operator runs the enclave runtime, receives grants to sealed models, and is paid a share of every call the enclave settles.
      </Opening>

      <article className={`container ${s.article}`}>
        <section className={`grid ${s.sec} ${s.duo}`}>
          <div className={s.col}>
            <h2 id="runs" className="t-h2">What an operator runs</h2>
            <p className="t-body">
              One process: the enclave runtime. It makes its own keys, attests on chain, registers, watches for grants, fetches a model&rsquo;s ciphertext from chain and opens it in memory, answers encrypted calls, signs each answer and settles it.
            </p>
            <p className="t-body">
              There is no deal to strike with a model&rsquo;s owner. The owner lists the measurements allowed to open the model, and any enclave running that software can be granted it, by the owner or by an enclave that already holds it.
            </p>
            <Link className={`link ${s.docs}`} data-arrow href={LINKS.operators.run}>Run the enclave runtime</Link>
            <div className={s.colData}>
              {!stats.ok ? (
                <Failed title="The figures did not load" message={stats.message} />
              ) : (
                <div className={s.figures}>
                  <div className={s.figure}>
                    <Stat label="Enclaves registered" note={enclaves.ok ? <Link className="link" href={`/enclaves${q}`}>{group(live)} live</Link> : undefined}>
                      <span className="t-fig t-fig-m">{group(enclaves.ok && !enclaves.data.page.hasMore ? enclaves.data.items.length : stats.data.enclaves)}</span>
                    </Stat>
                  </div>
                  <div className={s.figure}>
                    <Stat label="Calls settled" note="each with a receipt">
                      <span className="t-fig t-fig-m">{group(enclaves.ok ? settled.toString() : stats.data.callsSettled)}</span>
                    </Stat>
                  </div>
                  <div className={s.figure}>
                    <Stat label="Paid to operators" note={stats.data.operatorEarnings.length ? 'at settlement' : 'from the first settled call'}>
                      {stats.data.operatorEarnings.length ? (
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {stats.data.operatorEarnings.map((e) => <Amount key={e.mint ?? 'sol'} value={e} size="m" />)}
                        </span>
                      ) : (
                        <span className="t-fig t-fig-m">0</span>
                      )}
                    </Stat>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={s.col}>
            <h2 id="hardware" className="t-h2">Attestation records and runtime modes</h2>
            <p className="t-body">
              An enclave is trusted because of its onchain attestation record. Mainnet launches with the <span className="mono">{HARDWARE.launchVerifier}</span> program verifying signed reports for standard-server enclaves (<span className="mono">dev</span>) without TDX or SEV-SNP hardware.
            </p>
            <p className="t-body">
              Voynich reads the record from whichever verifier <span className="mono">Config.attestation_program</span> names at registration, at every grant and at every settlement. Once {HARDWARE.attestation}&rsquo;s mainnet verifier opens, <span className="mono">set_config</span> switches to it for Intel TDX and AMD SEV-SNP confidential VMs.
            </p>
            <Link className={`link ${s.docs}`} data-arrow href={LINKS.operators.hardware}>Hardware in the docs</Link>
            <div className={s.colData}>
              <ul className={s.hardware}>
                <li><span className={s.hwName}>{HARDWARE.launchMode}</span><State state="live" label={`Active on ${HARDWARE.launchVerifier}`} /></li>
                {HARDWARE.attested.map((h) => (
                  <li key={h} data-pending=""><span className={s.hwName}>{h}</span><State state="waiting" label="Via set_config when verifier opens" /></li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={s.sec} aria-labelledby="steps">
          <div className={`grid ${s.lede}`}>
            <h2 id="steps" className="t-h2">From boot to a paid call</h2>
            <div className={s.ledeSays}>
              <p className="t-body">
                The operator starts the runtime. From there the enclave attests, registers and serves on its own, and the grant comes to it.
              </p>
              <Link className={`link ${s.docs}`} data-arrow href={LINKS.operators.register}>Register and get granted</Link>
            </div>
          </div>
          <OperatorSteps />
        </section>

        <section className={`grid ${s.sec} ${s.split}`} data-lead="text" aria-labelledby="pays">
          <div className={s.text}>
            <h2 id="pays" className="t-h2">What a call pays and where it lands</h2>
            <p className="t-body">
              A model&rsquo;s owner sets its price per call and the operator share of that price. The caller&rsquo;s payment waits in escrow until the enclave settles the call with its signed answer.
            </p>
            <p className="t-body">
              Settlement splits the price in one instruction: the operator share to the operator&rsquo;s wallet, the protocol share, and the rest to the owner. There is nothing to claim afterwards. The payment and the receipt arrive together.
            </p>
            <Link className={`link ${s.docs}`} data-arrow href={LINKS.operators.earnings}>Earnings in the docs</Link>
          </div>
          <div className={s.held}>
            {missing(model) ? (
              <p className={s.none}>No model is sealed under the name {SKETCH32.name}.</p>
            ) : !model.ok ? (
              <Failed title={`The split of ${SKETCH32.name} did not load`} message={model.message} />
            ) : split && m ? (
              <section className={`panel ${s.pay}`} aria-label={`The split of one call to ${SKETCH32.name}`}>
                <div className="panel-head">
                  <h3>One call to <span className="mono">{m.name}</span></h3>
                  <Amount value={m.price} />
                </div>
                <div className={`panel-body ${s.splitBody}`}>
                  <TileStrip
                    cells={40}
                    height={22}
                    parts={[
                      { share: split.share(split.operator), step: 99 },
                      { share: split.share(split.owner), step: OWNER },
                      ...(split.protocol !== null ? [{ share: split.share(split.protocol), step: PROTOCOL }] : []),
                    ]}
                  />
                  <div className={s.parts}>
                    <div className={s.part} data-subject>
                      <span className={s.partKey}><i style={{ background: 'var(--ochre)' }} />Operator, {bps(m.operatorShareBps)}</span>
                      <Amount value={split.of(split.operator)} size="s" />
                    </div>
                    <div className={s.part}>
                      <span className={s.partKey}><i style={{ background: capFill(OWNER) }} />Owner{split.protocol !== null ? `, ${bps(10000 - m.operatorShareBps - (m.protocolShareBps ?? 0))}` : ''}</span>
                      <Amount value={split.of(split.owner)} size="s" />
                    </div>
                    {split.protocol !== null && m.protocolShareBps !== null ? (
                      <div className={s.part}>
                        <span className={s.partKey}><i style={{ background: capFill(PROTOCOL) }} />Protocol, {bps(m.protocolShareBps)}</span>
                        <Amount value={split.of(split.protocol)} size="s" />
                      </div>
                    ) : null}
                  </div>
                  <div className={s.splitFoot}>
                    <span>The operator share is set by the owner, per model.</span>
                    <Link className="link" data-arrow href={LINKS.token}>Fees and the token</Link>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </section>

        <div className={s.close}>
          <p className="t-lead">The runtime attests on its first start. Registration takes the operator&rsquo;s wallet and an endpoint.</p>
          <div className={s.closeActs}>
            <Link href={LINKS.operators.run} className="btn" data-kind="primary">Run an enclave</Link>
            <Link href={`/enclaves${q}`} className="btn">Enclaves</Link>
          </div>
        </div>
      </article>
    </>
  )
}
