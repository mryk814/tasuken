# RTK - Rust Token Killer (Codex CLI)

**Usage**: Token-optimized CLI proxy for shell commands.

## Rule

Always prefix shell commands with `rtk`.

Examples:

```bash
rtk git status
rtk cargo test
rtk npm run build
rtk pytest -q
```

## Meta Commands

```bash
rtk gain            # Token savings analytics
rtk gain --history  # Recent command savings history
rtk proxy <cmd>     # Run raw command without filtering
```

## Verification

```bash
rtk --version
```

Verify resolution once per session or after an environment change. On Windows:

```powershell
rtk powershell -NoProfile -Command 'Get-Command rtk | Select-Object -ExpandProperty Source'
```

On WSL / Linux:

```bash
rtk which rtk
```
