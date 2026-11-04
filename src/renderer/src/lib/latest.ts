/**
 * For requests whose answers can arrive out of order. Each call to the returned
 * function starts a request and returns a check that stays true only until the
 * next one starts, so a late answer to an old request can be dropped.
 */
export function latestOnly(): () => () => boolean {
  let latest = 0
  return () => {
    const mine = ++latest
    return () => mine === latest
  }
}
