# OpenCode Command Templates

Safe, reusable command configurations for OpenCode projects.

## Files

- `opencode-commands.example.json` — JSON command definitions for `opencode.json`
- `../OPENCODE-CUSTOM-COMMANDS.md` — Full documentation

## Usage

Copy the relevant JSON entries into your `opencode.json` `"command"` section,
and create corresponding `.md` files in your global `commands/` directory.

## Requirements

- OpenCode v1.16.0+
- `reviewer`, `akm-build`, `infrastructure` agents registered
- AKM and lean-ctx MCP servers configured

## Notes

- All paths are relative — no private/host-specific values included
- Markdown command files go in `~/.config/opencode/commands/`
- JSON config goes in `~/.config/opencode/opencode.json`
