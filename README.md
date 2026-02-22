# Leechless Desktop (Electron)

Alternative GUI interface for Leechless on macOS/Linux/Windows.

This app runs Leechless runtime commands in the background (seed/connect/dashboard)
so end users do not need to use terminal commands directly.

## What it controls

- Seller mode (`leechless seed --provider <name>`)
- Buyer mode (`leechless connect --router <name>`)
- Dashboard server (`leechless dashboard --port <port> --no-open`)
- Live process logs and daemon state snapshot (`~/.leechless/daemon.state.json`)

## Prerequisites

1. Install the `leechless` CLI binary so it is available on your `PATH`.

```bash
# example: from this monorepo's cli package
cd ../cli
npm install
npm run build
npm link
```

2. Install desktop dependencies:

```bash
npm install
```

Optional: if your CLI binary is not on `PATH`, set `LEECHLESS_CLI_BIN` to an absolute executable path.

```bash
export LEECHLESS_CLI_BIN=/absolute/path/to/leechless
```

## Run

Development mode:

```bash
npm run dev
```

Build desktop assets:

```bash
npm run build
```

Start app from built assets:

```bash
npm run start
```

## Notes

- This is phase 1 desktop integration: it shells out to the existing `leechless` runtime for parity and reliability.
- Keychain usage and network port handling follow the same behavior as the existing runtime stack.
- macOS may prompt for firewall/network permissions when listener ports are opened.
- On system sleep, runtime processes can pause; app should be expected to recover on wake.
