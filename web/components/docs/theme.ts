// Code colour from the site's tokens: the slate family carries the code, strings alone are a quiet ochre.
// Hex values mirror globals.css (shiki needs literals).

import type { ThemeRegistrationRaw } from 'shiki'

const TEXT = '#e3e9f4' // --text
const TEXT_2 = '#a3b0c8' // --text-2
const TEXT_3 = '#7684a0' // --text-3
const CAP = '#bfcade' // --cap
const GLYPH = '#a8c0e0' // --glyph
const STRING = '#b9a46c' // --ochre, lowered toward the slate

export const voynichCode: ThemeRegistrationRaw = {
  name: 'voynich',
  type: 'dark',
  fg: TEXT_2,
  bg: '#0a0f19', // --surface
  colors: { 'editor.foreground': TEXT_2, 'editor.background': '#0a0f19' },
  settings: [
    { settings: { foreground: TEXT_2, background: '#0a0f19' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: TEXT_3 } },
    { scope: ['punctuation', 'meta.brace', 'keyword.operator', 'meta.separator'], settings: { foreground: TEXT_3 } },
    { scope: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.control', 'keyword.operator.new', 'keyword.operator.expression'], settings: { foreground: TEXT } },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call entity.name', 'entity.name.command'], settings: { foreground: CAP } },
    { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.name.tag'], settings: { foreground: CAP } },
    { scope: ['constant.numeric', 'constant.language', 'constant.character', 'variable.language', 'support.constant'], settings: { foreground: GLYPH } },
    { scope: ['string', 'string.quoted', 'string.template', 'punctuation.definition.string'], settings: { foreground: STRING } },
    { scope: ['support.type.property-name', 'meta.object-literal.key', 'variable.other.property', 'entity.other.attribute-name', 'variable.parameter'], settings: { foreground: TEXT_2 } },
    { scope: ['variable.other.option', 'constant.other.option'], settings: { foreground: GLYPH } },
  ],
}
