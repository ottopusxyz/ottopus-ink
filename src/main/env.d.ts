/// <reference types="electron-vite/node" />

/** A bundled text file's contents, such as Ink's own skill. */
declare module '*.md?raw' {
  const text: string
  export default text
}

/** Values electron-vite writes into main when Ink is built. */
interface ImportMetaEnv {
  /** The Ink service's address, when a build points somewhere other than Ottopus's. Empty turns the service off. */
  readonly MAIN_VITE_INK_SERVICE_URL?: string
}
