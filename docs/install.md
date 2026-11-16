## Install Ottopus Ink

Ink is a desktop wallet for Linux and macOS that the coding agent you already have plans for, and you sign. Chats run on [Claude Code](https://claude.com/claude-code), so install it and sign in first. Ink finds it by itself.

These builds are not signed with a developer certificate yet, so your system will ask you to confirm the first time you open Ink. The steps are below.

| You have | Download |
|---|---|
| A Mac with Apple Silicon (M1 or later) | `ottopus-ink-<version>-mac-arm64.dmg` |
| A Mac with an Intel chip | `ottopus-ink-<version>-mac-x64.dmg` |
| Ubuntu, Debian or another Debian-based Linux | `ottopus-ink-<version>-linux-amd64.deb` |
| Any other 64-bit Linux | `ottopus-ink-<version>-linux-x86_64.AppImage` |

### macOS

1. Open the `.dmg` and drag **Ottopus Ink** into **Applications**.
2. Open it from Applications. macOS refuses the first time, because Apple hasn't checked the app. Click **Done**.
3. Go to **System Settings → Privacy & Security**, scroll down to the message about Ottopus Ink and click **Open Anyway**, then confirm.

If macOS says instead that Ottopus Ink "is damaged and can't be opened", it isn't damaged: that is how macOS describes an app it hasn't checked, downloaded from the internet. Run this in Terminal, then open Ink again:

```bash
xattr -dr com.apple.quarantine "/Applications/Ottopus Ink.app"
```

Ink keeps the key that encrypts your wallet in the macOS Keychain. After you install a new version, macOS asks whether Ottopus Ink may use it. Choose **Always Allow**; Ink can't unlock your wallet without it.

### Linux: .deb

```bash
sudo apt install ./ottopus-ink-<version>-linux-amd64.deb
```

Ottopus Ink then appears in your app list.

### Linux: AppImage

```bash
chmod +x ottopus-ink-<version>-linux-x86_64.AppImage
./ottopus-ink-<version>-linux-x86_64.AppImage
```

On Ubuntu 22.04 and later, an AppImage needs `libfuse2` first: `sudo apt install libfuse2` (on Ubuntu 24.04 and later the package is `libfuse2t64`).

### Check your download

Each release has a `SHA256SUMS` file. Download it into the same folder as the package, then check the file you downloaded, for example:

```bash
# Linux
grep linux-amd64.deb SHA256SUMS | sha256sum --check
# macOS
grep mac-arm64.dmg SHA256SUMS | shasum -a 256 --check
```

It should print the file's name followed by `OK`.

### Before you use it

Ink is a hackathon build. Nothing has been audited: don't give it a recovery phrase that holds more than you can afford to lose.
