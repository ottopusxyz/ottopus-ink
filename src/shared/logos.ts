/** The tokens Ink ships a logo for, by symbol. Anything else takes Zerion's icon, when Ink can find it. */
export const TOKEN_SYMBOLS = ['NEAR', 'ETH', 'USDC', 'USDT', 'SOL', 'BTC', 'TRX', 'SUI', 'APT'] as const
export type TokenSymbol = (typeof TOKEN_SYMBOLS)[number]

export const isTokenSymbol = (value: string): value is TokenSymbol => (TOKEN_SYMBOLS as readonly string[]).includes(value.toUpperCase())
