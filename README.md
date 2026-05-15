# voidm-pi-extension

A [pi-coding-agent](https://github.com/badlogic/pi-mono) extension that gives the agent persistent memory via [voidm](https://github.com/autonomous-toaster/voidm).

Provides:
- **`memory` tool** — remember, recall, relate, and delete persistent memories
- **`voidm` skill** — CLI-oriented usage guide for direct graph/search workflows
- **`memory` skill** — agent-facing guidance for storing and recalling useful knowledge

## Requirements

Install the `voidm` binary first: https://github.com/autonomous-toaster/voidm

```bash
git clone https://github.com/autonomous-toaster/voidm
cd voidm && cargo build --release
cp target/release/voidm ~/.local/bin/
```

## Install

```bash
# From git
pi install git:github.com/autonomous-toaster/voidm-pi-extension

# Local (development)
pi install ./voidm-pi-extension
```

## Binary Path

The extension resolves the `voidm` binary in this order:

1. `$VOIDM_BIN` environment variable
2. `~/.local/bin/voidm`
3. `voidm` on `$PATH`

Set `VOIDM_BIN` if your binary is elsewhere:

```bash
export VOIDM_BIN=/usr/local/bin/voidm
```

## Usage

Once installed, the agent has access to the `memory` tool. It is the preferred interface for persistent memory workflows.

```text
memory action=remember content="Docker is required for local integration tests" type=semantic scope=work/backend
memory action=recall query="integration tests docker" min_score=0.7
memory action=relate from_id="mem_..." rel="SUPPORTS" to_id="mem_..."
memory action=delete memory_id="mem_..."
```

### Retrieval guidance

For agent recall, prefer a higher threshold to avoid polluting context with weak matches:

- recommended default: `min_score=0.7`
- lower only when you intentionally want broader recall

See the bundled `memory` and `voidm` skills for the full guide.

## License

MIT
