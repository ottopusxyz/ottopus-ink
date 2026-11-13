import type { ChatDeposit, InkNote } from '../../shared/ipc'
import { txPage } from './explorers'

/**
 * What Ink says when a deposit it watched lands or isn't credited: a note for the person
 * and the same facts for the agent, every value from what the bridge or the chain said,
 * never from the agent. Null for any other stage, which needs no word.
 */
export function depositEnding(deposit: ChatDeposit): { note: InkNote; forAgent: string } | null {
  const { progress, chainName } = deposit
  const got = progress.got ?? `${deposit.asset}`
  const page = progress.tx ? txPage(deposit.chain, progress.tx) : null
  const links = page ? [{ label: `View on ${page.name}`, url: page.url }] : []
  if (progress.stage === 'credited' && deposit.kind === 'intents') {
    return {
      note: { tone: 'ok', title: `${got} arrived`, lines: [`${got} sent on ${chainName} is in your Intents balance.`], links },
      forAgent: `Ink: the deposit landed. ${got} sent on ${chainName} is now in the wallet’s NEAR Intents balance${deposit.account ? ` (account ${deposit.account})` : ''}${progress.tx ? `, transaction ${progress.tx}` : ''}. It can be swapped or sent from there.`,
    }
  }
  if (progress.stage === 'credited') {
    return {
      note: { tone: 'ok', title: `${got} arrived`, lines: [`Your ${chainName} balance went up by ${got}.`], links },
      forAgent: `Ink: the deposit landed. The wallet’s own ${chainName} address, ${deposit.address}, now holds ${got} more.`,
    }
  }
  if (progress.stage === 'failed') {
    const why = deposit.min ? ` It may have been under its ${deposit.min} ${deposit.asset} minimum.` : ''
    return {
      note: {
        tone: 'block',
        title: `${got} wasn’t credited`,
        lines: [`NEAR Intents didn’t credit ${got} sent on ${chainName}.${why}`, `Ink can’t move it back. Contact NEAR Intents with the transaction${progress.tx ? `: ${progress.tx}` : ''}.`],
        links,
      },
      forAgent: `Ink: NEAR Intents didn’t credit the deposit of ${got} on ${chainName}${progress.tx ? ` (transaction ${progress.tx})` : ''}.${why} Ink can’t move it back; the person can contact NEAR Intents with the transaction.`,
    }
  }
  return null
}
