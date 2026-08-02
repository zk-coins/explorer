# Contributing to zkCoins Explorer

> **Status:** Public mode is implemented against specification §5.5 / §7.5.
> Authorised/bearer decryption and verification are the next block. The app is a
> stateless static export (`zkcoins.space`) — no keys, no server state.

## What belongs here

- The **stateless presentation surface**: no keys, no private state, no wallet
  API, no publisher. Everything shown is read from a node's public endpoints.
- **Public mode** (AggregateStateNullifierV3 inscription stream, nullifier
  accumulator, aggregate counts, Path-B nullifier lookup) and routes for
  **authorised / bearer** views (`zkview` / `zkavk` / `zkatt` / `zkbid` fragment
  links) per [§5.5](https://docs.zkcoins.com/specification)–[§5.8](https://docs.zkcoins.com/specification).
- The node client MAY reuse [`@zkcoins/sdk`](https://github.com/zk-coins/sdk).

Anything that holds keys or signs belongs in the wallet
([zk-coins/app](https://github.com/zk-coins/app)); anything authoritative
belongs in the node.

## Hard rules

- **No silent fallbacks** for required values (no invented default node URL,
  amounts, or §3.10 states). Missing/malformed API data is a visible error.
- **Fragment secrets** stay in the URL hash only — never query, path, SSR props,
  or network requests (spec §5.6).
- **Public mode MUST NOT** render amounts, asset ids/names, balances, addresses,
  senders, recipients, CoinProof fields, or a UTXO/output graph (§5.5).

## Workflow

- Default branch is `develop`; open PRs against it.
- Commit messages: English, concise, _what_ not _how_.
- Frontend house rules (TypeScript strict, Tailwind, lint + build before push)
  follow [zk-coins/app/CONTRIBUTING.md](https://github.com/zk-coins/app/blob/develop/CONTRIBUTING.md).
- Required env at build: `NEXT_PUBLIC_NODE_BASE_URL` (no default).

```bash
export NEXT_PUBLIC_NODE_BASE_URL=https://node.example.com
npm ci && npm run lint && npm run typecheck && npm test && npm run build
```

## Related Repos

- [zk-coins/node](https://github.com/zk-coins/node) — the node whose public endpoints this explorer reads.
- [zk-coins/app](https://github.com/zk-coins/app) — sibling wallet frontend.
- [zk-coins/docs](https://github.com/zk-coins/docs) — specification ([docs.zkcoins.com](https://docs.zkcoins.com)).
