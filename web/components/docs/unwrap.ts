import { Children, isValidElement } from 'react'

// MDX wraps a kit tag written on one line in a paragraph. A container reads through it to its own parts.
export function unwrap(children: React.ReactNode): React.ReactNode[] {
  return Children.toArray(children).flatMap((c) =>
    isValidElement<{ children?: React.ReactNode }>(c) && c.type === 'p' ? Children.toArray(c.props.children) : [c],
  ).filter((c) => typeof c !== 'string' || c.trim() !== '')
}
