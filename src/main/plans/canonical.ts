/** Thrown for anything that has no single canonical form, so it can't be hashed. */
export class PlanIntegrityError extends Error {}

/** Half of a surrogate pair with no other half: not Unicode, so it has no UTF-8 form to hash. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

/**
 * Canonical JSON, as RFC 8785 (JCS) defines it, for the values a plan holds:
 * keys sorted by UTF-16 code units at every level, no whitespace, strings
 * escaped as ECMAScript's JSON.stringify escapes them, `undefined` properties
 * dropped. Two plans that mean the same thing serialise to the same bytes
 * whatever order their fields were built in.
 *
 * Narrower than RFC 8785 on purpose: numbers must be safe integers, because a
 * float in a plan is a bug ("0.1" and 0.1 must never be two plans), and amounts
 * are decimal strings anyway. Strings must be well-formed Unicode, and only
 * plain objects and arrays are accepted, so nothing with its own toJSON or
 * prototype can serialise one way here and another elsewhere.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      if (LONE_SURROGATE.test(value)) throw new PlanIntegrityError('cannot hash a string with a lone surrogate')
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isSafeInteger(value)) throw new PlanIntegrityError(`cannot hash a number that isn't a safe integer: ${value}`)
      // String(-0) is "0", which is what RFC 8785 wants.
      return String(value)
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
      const prototype: unknown = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) throw new PlanIntegrityError('cannot hash an object that is not plain')
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        // Plain < on JS strings compares UTF-16 code units, the order RFC 8785 sorts by.
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => `${canonicalize(key)}:${canonicalize(entry)}`)
      return `{${entries.join(',')}}`
    }
    default:
      throw new PlanIntegrityError(`cannot hash a ${typeof value}`)
  }
}
