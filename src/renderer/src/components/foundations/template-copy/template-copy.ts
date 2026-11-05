/**
 * The import path BoardUI's copied parts use for translating their copy. Ink has
 * no translations, and this is what the original does without a provider.
 */
export function useTemplateCopy() {
  return <T>(node: T): T => node
}
