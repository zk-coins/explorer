# Contributing to zkCoins Explorer

> **Status: scaffold.** This repo will hold the public explorer frontend
> (`zkcoins.space`) — a stateless web app rendering the public on-chain
> projection and, given a per-coin view capability, authorised single-transaction
> views ([specification §5](https://docs.zkcoins.app/specification)).

## What belongs here

- The **stateless presentation surface**: no keys, no private state, no wallet
  API, no publisher. Everything shown is read from a node's public endpoints
  and verified against Bitcoin.
- **Public mode** (inscription stream, nullifier accumulator, aggregate counts)
  and **authorised mode** (client-side application of `zkview` / `zkavk`
  capabilities) per [§5.5](https://docs.zkcoins.app/specification).
- The node client MAY reuse [`@zkcoins/sdk`](https://github.com/zk-coins/sdk).

Anything that holds keys or signs belongs in the wallet
([zk-coins/app](https://github.com/zk-coins/app)); anything authoritative
belongs in the node.

## Workflow

- Default branch is `develop`; open PRs against it.
- Commit messages: English, concise, *what* not *how*.
- Frontend house rules (TypeScript strict, Tailwind, lint + build before push)
  follow [zk-coins/app/CONTRIBUTING.md](https://github.com/zk-coins/app/blob/develop/CONTRIBUTING.md).

## Related Repos

- [zk-coins/node](https://github.com/zk-coins/node) — the node whose public endpoints this explorer reads.
- [zk-coins/app](https://github.com/zk-coins/app) — sibling wallet frontend.
- [zk-coins/docs](https://github.com/zk-coins/docs) — specification ([docs.zkcoins.app](https://docs.zkcoins.app)).
