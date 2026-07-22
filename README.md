# zkCoins Explorer

**Private Bitcoin payments via Shielded CSV** — no new chain, no token, no consensus change, no trusted operator. Only Bitcoin, zero-knowledge proofs, and the user's own keys.

The **public block/transaction explorer** for zkCoins — a stateless web frontend that renders the public on-chain projection and, given a per-coin view capability, an authorised single-transaction view. It holds **no keys** and only reads a node's public endpoints.

> Full system docs: **[docs.zkcoins.com](https://docs.zkcoins.com)** · Specification: **[docs.zkcoins.com/specification](https://docs.zkcoins.com/specification)**

## What zkCoins is

zkCoins lets you send value on Bitcoin without anyone seeing the amount, the asset, who paid, or who received. Bitcoin stores only opaque markers that a spend happened — not the coin's contents, which travel privately between sender and receiver as a small encrypted bundle. Double-spend protection is the chain's job; your seed derives every key, your wallet is the only thing that can spend, any node can serve you, and you verify everything against Bitcoin yourself. Built on the zkCoins concept (Robin Linus) and the Shielded CSV construction (Jonas Nick, Liam Eagen, Robin Linus).

## The system, end to end

| Layer | What it is | Repo |
|---|---|---|
| **App · Explorer** | end-user wallet (LNURL receive) · public explorer web-app | [`zk-coins/app`](https://github.com/zk-coins/app) · **[`zk-coins/explorer`](https://github.com/zk-coins/explorer)** ← this repo |
| **SDK** | thin TypeScript client — on-device keys, signing, node/API calls | [`zk-coins/sdk`](https://github.com/zk-coins/sdk) |
| **zkCoins API** | public REST + LNURL, hosted-wallet service (optional) | [`zk-coins/api`](https://github.com/zk-coins/api) |
| **zkCoins node** | trustless kernel — scan · accumulator · verify · prove · store · publisher | [`zk-coins/node`](https://github.com/zk-coins/node) |
| **bitcoind · Nostr relay** | Bitcoin L1 settlement and ordering · off-chain transport and data availability | upstream (own or external) |

Supporting repos: [`zk-coins/research`](https://github.com/zk-coins/research), [`zk-coins/plonky2`](https://github.com/zk-coins/plonky2), [`zk-coins/docs`](https://github.com/zk-coins/docs).

## This repository (explorer)

A **stateless presentation surface** — its own container, a sibling of the wallet [app](https://github.com/zk-coins/app). It holds no keys and no private state; everything it shows is read from a node's **public** endpoints ([specification §7.5](https://docs.zkcoins.com/specification)) and verified against Bitcoin.

Two modes ([§5.5](https://docs.zkcoins.com/specification)):

- **Public mode** — renders only Public on-chain data: the stream of `BatchInscription`s with their `prev_root → new_root` transitions and publisher identities, the global nullifier accumulator, and aggregate counts. No amounts, addresses, or parties.
- **Authorised mode** — given a shareable per-coin view capability (`zkview`), an account view key (`zkavk`), or a balance attestation, applied **client-side**, it decrypts and renders exactly that disclosure ([§5](https://docs.zkcoins.com/specification)) and verifies the confirmation against Bitcoin.

It offers **no** publisher and **no** wallet API. It MAY reuse [`@zkcoins/sdk`](https://github.com/zk-coins/sdk) as its node client.

> **Status: scaffold.** This repo will hold the explorer frontend (`zkcoins.space`). The full design is specified in [§5 Access & Explorer](https://docs.zkcoins.com/specification) and [§6.1](https://docs.zkcoins.com/specification).

## License

MIT
