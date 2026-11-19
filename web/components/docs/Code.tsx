// A fenced code block: its language, a copy control, and the code in the site's own colours.

import { bundledLanguages, codeToHtml } from 'shiki'
import { voynichCode } from './theme'
import { Copy } from './Copy'
import { Scroll } from './Scroll'
import s from './kit.module.css'

const NAMES: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', typescript: 'TypeScript', js: 'JavaScript', javascript: 'JavaScript', json: 'JSON',
  bash: 'Shell', sh: 'Shell', shell: 'Shell', http: 'HTTP', rust: 'Rust', rs: 'Rust', toml: 'TOML', yaml: 'YAML', yml: 'YAML', text: 'Text',
}

type CodeChild = { props?: { className?: string; children?: unknown } }

export async function Code({ children }: { children?: React.ReactNode }) {
  const child = (children ?? {}) as CodeChild
  const lang = /language-([\w-]+)/.exec(child.props?.className ?? '')?.[1] ?? 'text'
  const code = String(child.props?.children ?? '').replace(/\n$/, '')
  const html = await codeToHtml(code, { lang: lang in bundledLanguages ? lang : 'text', theme: voynichCode })
  return (
    <figure className={s.code}>
      <figcaption className={s.codeHead}>
        <span className={s.codeLang}>{NAMES[lang] ?? lang}</span>
        <Copy text={code} />
      </figcaption>
      <Scroll html={html} />
    </figure>
  )
}
