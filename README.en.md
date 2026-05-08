# codex-switch

A tiny CLI tool for one job only  
Switch Codex `config.toml` and `auth.json` in one command

Highlights
- Simple: only a few commands
- Lightweight: no runtime dependencies
- Transparent: it only manages two files

## Install

```bash
npm install -g @glidea/codex-switch
```

You can also run it without installing:

```bash
npx @glidea/codex-switch list
```

## Quick Start

1. Save your current setup as `openai`

```bash
codex-switch add openai --from-current
```

2. Create another setup `glidea`

```bash
codex-switch add glidea
```

It will open `config.toml` first  
Then it will open `auth.json`

3. Switch any time

```bash
codex-switch openai
codex-switch glidea
```

4. Restart Codex after switching

An already running Codex session does not hot-reload config files  
Restart is required to load the new profile

## Common Commands

```bash
codex-switch <profile>
codex-switch add <profile>
codex-switch presets
codex-switch current
codex-switch list
codex-switch edit <profile>
codex-switch rm <profile>
codex-switch completion
```

Advanced commands

```bash
codex-switch add <profile> --from-current
codex-switch add <profile> --config <path> --auth <path>
codex-switch add <profile> --preset <preset-id> --apikey <key>
codex-switch add <profile> --preset <preset-id>
codex-switch <profile> --copy
codex-switch completion <zsh|bash|fish|powershell>
```

## File Layout

```text
~/.codex/
  config.toml -> profiles/openai/config.toml
  auth.json   -> profiles/openai/auth.json
  profiles/
    openai/
      config.toml
      auth.json
    glidea/
      config.toml
      auth.json
```

Default mode is symlink mode:

```bash
codex-switch <profile>
```

If symlink permission fails on Windows, use copy mode:

```bash
codex-switch <profile> --copy
```

## Release

```bash
./scripts/publish-with-token.sh <NPM_TOKEN>
```
