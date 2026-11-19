// The drawings of /sealing and /operators. Each takes what the chain holds for sketch-32 and sets it in its place.
import type { Grant, GrantedEnclave, Model, Receipt } from '@voynich/contract'
import { sampleBytes } from '@/components/field/ramp'
import { Frame } from '@/components/drawn/Drawn'
import { StateTile } from '@/components/tile/Tile'
import { b64ToBytes, bytes as fmtBytes, group, hardware } from '@/lib/format'
import { Contour, Join, JoinDefs, Line, Pending, Plain, Signature, Wall, diagram as s, type JoinKind } from './Diagram'

const chars = (v: string, n = 12) => Array.from(v.slice(0, n), (c) => c.charCodeAt(0))
const still = sampleBytes(160)

function Stop({ hand, name, says, fact, children }: { hand?: boolean; name: string; says: string; fact?: React.ReactNode; children: React.ReactNode }) {
  const body = (
    <>
      <div className={s.stopHead}>
        <span className={s.stopName}>{name}</span>
        <div className={s.stopVis}>{children}</div>
      </div>
      <p className={s.stopSays}>{says}</p>
      {fact ? <div className={s.stopFact}>{fact}</div> : null}
    </>
  )
  return <li className={s.stop}>{hand ? <Frame className={s.stopBox}>{body}</Frame> : <div className={s.stopBox} data-chain="">{body}</div>}</li>
}

const Link = ({ kind = 'act', label }: { kind?: JoinKind; label?: string }) => <li className={s.pathJoin} aria-hidden={label ? undefined : true}><Join kind={kind} label={label} /></li>

// The page's one drawing: the model key from the owner's device to a receipt. The ochre contour is on
// the two places the key is in plaintext and nowhere else.
export function KeyPath({ cipher, model, held, receipt }: { cipher?: Uint8Array; model?: Model; held?: GrantedEnclave; receipt?: Receipt }) {
  const size = model ? fmtBytes(model.sizeBytes) : null
  const record = held?.enclave.attestation
  const wrapped = held ? b64ToBytes(held.grant.wrappedKey) : null
  return (
    <figure className={s.path} aria-label="The path of the model key: the owner’s device, the ciphertext on chain, the attestation record, the grant, the enclave, the receipt.">
      <JoinDefs />
      <ol className={s.pathLine}>
        <Stop hand name="Owner&rsquo;s device" says="The model key is drawn here at sealing and the weights are encrypted under it.">
          <Plain n={12} size="m" bare />
        </Stop>
        <Link label="encrypts" />
        <Stop name="Ciphertext" says="The weights, on Solana for anyone to fetch." fact={size ? <>{size.value}<span className="unit">{size.unit}</span></> : null}>
          <Wall bytes={cipher?.length ? cipher : still} n={12} size="m" />
        </Stop>
        <Link kind="holds" />
        <Stop name="Attestation record" says="The enclave&rsquo;s signing key, measurement, hardware type and expiry on chain." fact={record ? <>{hardware(record.hardwareType)}<span className="unit">to slot</span> {group(record.expiresAtSlot)}</> : null}>
          <Wall bytes={record ? chars(record.address) : still.subarray(12)} n={12} size="m" />
        </Stop>
        <Link label="wraps" />
        <Stop name="Grant" says="The model key, wrapped to that enclave&rsquo;s encryption key." fact={wrapped ? <>{wrapped.length}<span className="unit">bytes, wrapped</span></> : null}>
          <Wall bytes={wrapped ? wrapped.subarray(1) : still.subarray(24)} n={12} size="m" />
        </Stop>
        <Link label="unwraps" />
        <Stop hand name="Enclave" says="The key is unwrapped inside the enclave and the model runs in its memory.">
          <Plain n={12} seed={1} size="m" bare />
        </Stop>
        <Link label="signs" />
        <Stop name="Receipt" says="The enclave&rsquo;s signature on one answer, checked by the program." fact={receipt ? <><span className="unit" style={{ marginLeft: 0 }}>slot</span> {group(receipt.slot)}</> : null}>
          <Wall bytes={receipt ? b64ToBytes(receipt.signature) : still.subarray(36)} n={12} size="m" />
        </Stop>
      </ol>
      <figcaption className={s.note}><Contour />The contour marks every place the model key is in plaintext.</figcaption>
    </figure>
  )
}

// A grant, alone: the key in the open on either side, and the bytes the chain holds between them.
export function GrantWrap({ grant }: { grant?: Grant }) {
  const wrapped = grant ? b64ToBytes(grant.wrappedKey) : null
  return (
    <figure className={s.trio} aria-label="A grant wraps the model key to one enclave: open with the owner, wrapped on chain, open again inside the enclave it names.">
      <div className={s.trioSide}>
        <Plain n={8} size="l" />
        <span className={s.cap}>Model key, with the owner or a granted enclave</span>
      </div>
      <Join kind="act" label="wraps" />
      <div className={s.trioMid}>
        <Wall bytes={wrapped ? wrapped.subarray(1) : still} n={104} size="l" className={s.trioWall} />
        <span className={s.cap}>{wrapped ? `Wrapped key, ${wrapped.length} bytes, on chain` : 'Wrapped key, on chain'}</span>
      </div>
      <Join kind="act" label="unwraps" />
      <div className={s.trioSide}>
        <Plain n={8} seed={1} size="l" />
        <span className={s.cap}>Model key, inside the enclave it names</span>
      </div>
    </figure>
  )
}

const STEPS: { name: string; says: string; holds: string; vis: React.ReactNode; next?: JoinKind }[] = [
  { name: 'Boot', holds: 'Signing and encryption keys', vis: <Plain n={8} size="m" />, says: 'The runtime starts on a standard server (or a confidential VM) and makes its keys.', next: 'act' },
  { name: 'Attest', holds: 'Attestation record', vis: <Wall bytes={still} n={8} size="m" />, says: 'The report is verified on chain by attest (or Confidential Compute after set_config): key, type, measurement, expiry.', next: 'act' },
  { name: 'Register', holds: 'Enclave', vis: <StateTile state="live" size={26} />, says: 'With the operator’s wallet and the endpoint it answers on.', next: 'holds' },
  { name: 'Receive a grant', holds: 'Model key, wrapped', vis: <Wall bytes={still.subarray(16)} n={8} size="m" />, says: 'From the owner or from a granted enclave. It fetches the ciphertext and opens it in memory.', next: 'act' },
  { name: 'Serve', holds: 'Receipt', vis: <Signature />, says: 'Every settled call pays the operator’s wallet its share of the price.', next: 'pending' },
  { name: 'Refresh', holds: 'Next record', vis: <Pending n={8} />, says: 'It attests again before the expiry slot and goes on serving.' },
]

// An operator's six steps, from boot to refresh.
export function OperatorSteps() {
  return (
    <>
      <JoinDefs />
      <ol className={s.steps} aria-label="Boot, attest, register, receive a grant, serve, refresh">
        {STEPS.map((st, i) => (
          <li key={st.name} className={s.step}>
            <div className={s.stepHead}>
              <span className={s.digit} aria-hidden="true">{i + 1}</span>
              <span className={s.stepName}>{st.name}</span>
              {st.next ? <Line kind={st.next} /> : null}
            </div>
            <div className={s.stepVis}>{st.vis}<span className={s.cap}>{st.holds}</span></div>
            <p className={s.stepSays}>{st.says}</p>
          </li>
        ))}
      </ol>
    </>
  )
}
