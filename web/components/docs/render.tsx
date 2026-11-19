// A page's MDX compiled with the kit. Headings take their anchors here, and the same list feeds the contents rail.

import { compileMDX } from 'next-mdx-remote/rsc'
import remarkGfm from 'remark-gfm'
import { anchor, type Heading, type Page } from '@/lib/docs'
import { Code } from './Code'
import { Copy } from './Copy'
import { Ways, Way } from './Ways'
import { A, Callout, Card, Cards, DocField, Fields, H2, H3, Rows, Step, Steps, Table } from './kit'
import { Diagram } from './Diagram'

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] }

const textOf = (n: Node): string => (n.type === 'text' ? n.value ?? '' : (n.children ?? []).map(textOf).join(''))

// h2 and h3 get ids from their words; the list of them is handed back for the contents.
function headingIds(into: Heading[]) {
  return () => (tree: Node) => {
    const seen = new Map<string, number>()
    const walk = (n: Node) => {
      if (n.type === 'element' && (n.tagName === 'h2' || n.tagName === 'h3')) {
        const text = textOf(n).trim()
        const id = anchor(text, seen)
        n.properties = { ...n.properties, id }
        into.push({ depth: n.tagName === 'h2' ? 2 : 3, id, text })
      }
      n.children?.forEach(walk)
    }
    walk(tree)
  }
}

const components = {
  pre: Code,
  a: A,
  table: Table,
  h2: H2,
  h3: H3,
  Ways, Way, Steps, Step, Fields, Field: DocField, Rows, Callout, Cards, Card, Diagram, Copy,
}

export async function renderPage(page: Page) {
  const headings: Heading[] = []
  const { content } = await compileMDX({
    source: page.body,
    components,
    options: { mdxOptions: { remarkPlugins: [remarkGfm], rehypePlugins: [headingIds(headings)] } },
  })
  return { content, headings }
}
