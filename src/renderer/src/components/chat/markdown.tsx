import { Fragment, type ReactNode } from 'react'
import { Lexer, type MarkedToken, type Token, type Tokens } from 'marked'
import { safeExternalUrl } from '../../../../shared/external-url'

/**
 * Past this a reply stays plain text, so a hostile agent can't freeze the window
 * by re-parsing a huge one. The parser's email autolinks take quadratic time, at
 * about 0.4s here and 2.5s at 50,000.
 */
export const MAX_MARKDOWN_CHARS = 20_000

/** Past this many possible table cells a reply stays plain text too, at about 0.2s to draw. */
export const MAX_TABLE_CELLS = 20_000

/** Quotes, lists and emphasis nested deeper than this show their source. */
const MAX_DEPTH = 8

/**
 * An agent's reply. Only bold, italics, headings, lists, quotes, code and tables
 * get any formatting. An https link can be clicked and opens in the OS browser,
 * always with its real address showing, and any other link is text. Anything
 * else, including images and HTML, shows as the text the agent sent. So an agent
 * can't load anything, disguise where a link goes, or hide text from the person.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="ink-md">{render(text)}</div>
}

function render(text: string): ReactNode {
  if (text.length <= MAX_MARKDOWN_CHARS && mostTableCells(text) <= MAX_TABLE_CELLS) {
    try {
      return blocks(new Lexer({ gfm: true }).lex(text), 0)
    } catch {
      // Nesting deep enough to overflow the parser's stack. The text still shows below.
    }
  }
  return <p>{text}</p>
}

/**
 * The most cells a reply's tables could make. The parser pads every row to its
 * header's width, so 16,000 characters can ask for 3,000,000 cells, and this has
 * to be known before parsing because the parser makes them all.
 */
function mostTableCells(text: string): number {
  const lines = text.split(/\r\n?|\n/)
  const widest = Math.max(...lines.map((line) => line.split('|').length - 1))
  return widest === 0 ? 0 : (widest + 1) * lines.length
}

function blocks(tokens: Token[], depth: number): ReactNode {
  return tokens.map((token, key) => block(token as MarkedToken, key, depth))
}

function block(token: MarkedToken, key: number, depth: number): ReactNode {
  if (token.type === 'space') return null
  if (depth > MAX_DEPTH) return <p key={key}>{token.raw.trimEnd()}</p>
  switch (token.type) {
    case 'paragraph':
      return <p key={key}>{inline(token.tokens, depth)}</p>
    case 'text':
      return <p key={key}>{token.tokens ? inline(token.tokens, depth) : token.raw}</p>
    case 'heading': {
      const Heading = token.depth <= 2 ? 'h3' : 'h4'
      return <Heading key={key}>{inline(token.tokens, depth)}</Heading>
    }
    case 'code':
      return (
        <Fragment key={key}>
          {token.lang ? <p className="ink-md__lang">{token.lang}</p> : null}
          <pre>
            <code>{token.text}</code>
          </pre>
        </Fragment>
      )
    case 'blockquote':
      return <blockquote key={key}>{blocks(token.tokens, depth + 1)}</blockquote>
    case 'list': {
      const List = token.ordered ? 'ol' : 'ul'
      return (
        <List key={key} start={token.ordered && token.start !== '' ? token.start : undefined}>
          {token.items.map((item, index) => (
            <li key={index}>{itemBlocks(item, depth + 1)}</li>
          ))}
        </List>
      )
    }
    case 'table':
      if (!keptEveryCell(token)) return <p key={key}>{token.raw.trimEnd()}</p>
      return (
        <div key={key} className="ink-md__table">
          <table>
            <thead>
              <tr>{cells(token.header, 'th', depth)}</tr>
            </thead>
            <tbody>
              {token.rows.map((row, index) => (
                <tr key={index}>{cells(row, 'td', depth)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    default:
      return <p key={key}>{token.raw.trimEnd()}</p>
  }
}

/**
 * The parser drops a row's cells past its header's width, which would hide them,
 * so this compares what it kept with the source, leaving out the separators.
 */
function keptEveryCell({ raw, header, rows }: Tokens.Table): boolean {
  const squeezed = (text: string) => text.replace(/[\s|\\]/g, '')
  const [head = '', , ...body] = raw.split('\n')
  const kept = [header, ...rows].flat().map((cell) => cell.text)
  return squeezed([head, ...body].join('')) === squeezed(kept.join(''))
}

function cells(row: Tokens.TableCell[], Cell: 'th' | 'td', depth: number): ReactNode {
  return row.map((cell, index) => (
    <Cell key={index} data-align={cell.align ?? undefined}>
      {inline(cell.tokens, depth + 1)}
    </Cell>
  ))
}

/** A task's checkbox stays the `[x]` the agent wrote, because a real one could pass for something Ink had checked. */
function itemBlocks(item: Tokens.ListItem, depth: number): ReactNode {
  const [box, line] = item.tokens as (MarkedToken | undefined)[]
  if (box?.type === 'checkbox' && (line?.type === 'text' || line?.type === 'paragraph') && line.tokens) {
    line.tokens.unshift(box)
    item.tokens.shift()
  }
  return blocks(item.tokens, depth)
}

function inline(tokens: Token[], depth: number, inLink = false): ReactNode {
  return tokens.map((token, key) => span(token as MarkedToken, key, depth, inLink))
}

function span(token: MarkedToken, key: number, depth: number, inLink: boolean): ReactNode {
  if (depth > MAX_DEPTH) return token.raw
  switch (token.type) {
    case 'strong':
      return <strong key={key}>{inline(token.tokens, depth + 1, inLink)}</strong>
    case 'em':
      return <em key={key}>{inline(token.tokens, depth + 1, inLink)}</em>
    case 'codespan':
      return <code key={key}>{token.text}</code>
    case 'br':
      return <br key={key} />
    case 'escape':
      return token.text
    case 'link':
      return inLink ? token.raw : link(token, key, depth)
    default:
      // Raw rather than `text`, which has decoded entities such as `&#x200B;`.
      return token.raw
  }
}

function link(token: Tokens.Link, key: number, depth: number): ReactNode {
  // A bare URL or `<https://example.com>` has no label of its own.
  const bare = token.raw === token.text || token.raw === `<${token.text}>`
  const target = safeExternalUrl(token.href)
  const label = (
    <>
      {inline(token.tokens, depth + 1, true)}
      {token.title ? ` "${token.title}"` : null}
    </>
  )
  if (!target) {
    if (bare) return token.text
    return (
      <Fragment key={key}>
        {label} ({token.href})
      </Fragment>
    )
  }
  return (
    <a key={key} href={target} target="_blank" rel="noopener noreferrer">
      {bare ? (
        target
      ) : (
        <>
          {label} <span className="ink-md__url">({target})</span>
        </>
      )}
    </a>
  )
}
