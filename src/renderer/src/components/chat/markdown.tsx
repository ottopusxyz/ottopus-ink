import { Fragment, type ReactNode } from 'react'
import { Lexer, type MarkedToken, type Token } from 'marked'

/** Past this a reply stays plain text, so a hostile agent can't freeze the window by re-parsing a huge one. */
export const MAX_MARKDOWN_CHARS = 50_000

/** Quotes, lists and emphasis nested deeper than this show their source. */
const MAX_DEPTH = 8

/**
 * An agent's reply. Only bold, italics, headings, lists, quotes and code get any
 * formatting. A link shows its full URL as text and can't be clicked, and anything
 * else, including images and HTML, shows as the text the agent sent. So an agent
 * can't put a link or image in front of the person, or hide text from them.
 *
 * GFM stays off, which leaves bare URLs, tables, strikethrough and task lists as text.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="ink-md">{render(text)}</div>
}

function render(text: string): ReactNode {
  if (text.length <= MAX_MARKDOWN_CHARS) {
    try {
      return blocks(new Lexer({ gfm: false }).lex(text), 0)
    } catch {
      // Nesting deep enough to overflow the parser's stack. The text still shows below.
    }
  }
  return <p>{text}</p>
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
        <pre key={key}>
          <code>{token.text}</code>
        </pre>
      )
    case 'blockquote':
      return <blockquote key={key}>{blocks(token.tokens, depth + 1)}</blockquote>
    case 'list': {
      const List = token.ordered ? 'ol' : 'ul'
      return (
        <List key={key} start={token.ordered && token.start !== '' ? token.start : undefined}>
          {token.items.map((item, index) => (
            <li key={index}>{blocks(item.tokens, depth + 1)}</li>
          ))}
        </List>
      )
    }
    default:
      return <p key={key}>{token.raw.trimEnd()}</p>
  }
}

function inline(tokens: Token[], depth: number): ReactNode {
  return tokens.map((token, key) => span(token as MarkedToken, key, depth))
}

function span(token: MarkedToken, key: number, depth: number): ReactNode {
  if (depth > MAX_DEPTH) return token.raw
  switch (token.type) {
    case 'strong':
      return <strong key={key}>{inline(token.tokens, depth + 1)}</strong>
    case 'em':
      return <em key={key}>{inline(token.tokens, depth + 1)}</em>
    case 'codespan':
      return <code key={key}>{token.text}</code>
    case 'br':
      return <br key={key} />
    case 'escape':
      return token.text
    case 'link':
      // `<https://example.com>` already shows its URL.
      if (token.raw === `<${token.text}>`) return token.text
      return (
        <Fragment key={key}>
          {inline(token.tokens, depth + 1)} ({token.href})
        </Fragment>
      )
    default:
      // Raw rather than `text`, which has decoded entities such as `&#x200B;`.
      return token.raw
  }
}
