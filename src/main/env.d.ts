/** Values electron-vite writes into main when Ink is built. */
interface ImportMetaEnv {
  /** The Ink service's address, such as https://ottopus-ink-service.example.workers.dev. Unset in a build without one. */
  readonly MAIN_VITE_INK_SERVICE_URL?: string
}
