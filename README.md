# voidm-pi-extension

A [pi-coding-agent](https://github.com/badlogic/pi-mono) extension that gives the agent persistent memory via [voidm](https://github.com/autonomous-toaster/voidm).

Provides:
- **`memory` tool** — add, search, list, delete, link, graph neighbors, pagerank, and Cypher queries
- **`voidm` skill** — agent usage guide: types, edge selection, insertion workflow

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

Once installed, the agent has access to the `memory` tool. It is the preferred interface — use it instead of calling the CLI directly.

```
memory action=add content="..." type=semantic scope=work/acme
memory action=search query="deployment"
memory action=cypher cypher_query="MATCH (a:Memory)-[r]->(b:Memory) RETURN a.memory_id AS from, r.rel_type AS rel, b.memory_id AS to LIMIT 20"
```

See `voidm instructions` or load the `voidm` skill for the full agent guide.

## License

MIT
