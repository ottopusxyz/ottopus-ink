// Gives Ink its icon in the Linux dock and app grid while it runs from this checkout.
//
// GNOME on Wayland ignores a window's own icon. It shows the icon of the .desktop file
// named after the window's app ID, which Electron takes from `desktopName` in
// package.json (ottopus-ink.desktop, so the ID is ottopus-ink). This writes that file to
// ~/.local/share/applications, pointing at resources/icon.png here and starting Ink with
// `npm start`. Run it again if the checkout moves.
//
// The installed .deb ships its own entry with the same name, in /usr/share/applications.
// The one in your home folder wins, so this stops when Ink is installed rather than hide it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'linux') {
  console.log('Only Linux needs a desktop entry. Nothing to do.')
  process.exit(0)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { desktopName, productName } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const id = desktopName.replace(/\.desktop$/, '')
const icon = join(root, 'resources', 'icon.png')
const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
const file = join(dataHome, 'applications', desktopName)
const installed = join('/usr/share/applications', desktopName)

if (existsSync(installed)) {
  console.log(`Ottopus Ink is installed (${installed}), and a second ${desktopName} here would hide it. Nothing to do.`)
  process.exit(0)
}

/** Quotes an argument for a desktop entry's Exec line. */
const quoted = (text) => `"${text.replace(/[\\"`$]/g, (char) => `\\${char}`)}"`

/**
 * Exec is a string value, so each backslash the quoting added must itself be written as
 * `\\`. Without that, GNOME can't read the line and says the entry has no Exec field.
 */
const keyFileString = (text) => text.replace(/\\/g, '\\\\')

const entry = [
  '[Desktop Entry]',
  'Type=Application',
  `Name=${productName}`,
  'Comment=A desktop wallet your coding agent plans for and you sign',
  `Exec=${keyFileString(`sh -c ${quoted(`cd ${quoted(root)} && npm start`)}`)}`,
  `Icon=${icon}`,
  `StartupWMClass=${id}`,
  'Categories=Office;Finance;',
  'Terminal=false',
  '',
].join('\n')

mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, entry)
console.log(`Wrote ${file}. Restart Ink to see its icon.`)
