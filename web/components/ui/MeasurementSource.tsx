import type { MeasurementRecord } from '@voynich/contract'
import { short } from '@/lib/format'
import { isHttpUrl } from '@/lib/measurements'
import s from './measurement-source.module.css'

export function MeasurementSource({
  record,
  compact = false,
}: {
  record: MeasurementRecord | null | undefined
  compact?: boolean
}) {
  if (!record) return null
  const commit = record.commitSha.slice(0, 7)
  return (
    <span className={s.wrap} data-compact={compact || undefined}>
      <span className={`mono ${s.ver}`}>v{record.version}</span>
      <span className={`mono ${s.commit}`} title={record.commitSha}>{commit}</span>
      {isHttpUrl(record.sourceRepo) ? (
        <a className={`link mono ${s.repo}`} href={record.sourceRepo} target="_blank" rel="noreferrer">
          {record.sourceRepo}
        </a>
      ) : (
        <span className={`mono ${s.repo}`}>{record.sourceRepo}</span>
      )}
      {!compact ? (
        <span className={`mono ${s.recipe}`} title={`Recipe SHA-256: ${record.recipeHash}`}>
          recipe {short(record.recipeHash, 4)}
        </span>
      ) : null}
      {record.status === 'deprecated' ? <span className={s.deprecated}>Deprecated</span> : null}
    </span>
  )
}
