# zkCoins Explorer

**Private Bitcoin payments via Shielded CSV** — no new chain, no token, no consensus change, no trusted operator. Only Bitcoin, zero-knowledge proofs, and the user's own keys.

The **public block/transaction explorer** for zkCoins — a stateless web frontend that renders the public on-chain projection and, given a per-coin or account bearer capability, an authorised single-transaction / balance / account view. It holds **no keys** and only reads a node's public endpoints plus content-addressed blobs named by the bearer fragment.

> Full system docs: **[docs.zkcoins.com](https://docs.zkcoins.com)** · Specification: **[docs.zkcoins.com/specification](https://docs.zkcoins.com/specification)**

## What zkCoins is

zkCoins lets you send value on Bitcoin without anyone seeing the amount, the asset, who paid, or who received. Bitcoin stores only opaque markers that a spend happened — not the coin's contents, which travel privately between sender and receiver as a small encrypted bundle. Double-spend protection is the chain's job; your seed derives every key, your wallet is the only thing that can spend, any node can serve you, and you verify everything against Bitcoin yourself. Built on the zkCoins concept (Robin Linus) and the Shielded CSV construction (Jonas Nick, Liam Eagen, Robin Linus).

## The system, end to end

| Layer                      | What it is                                                                     | Repo                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **App · Explorer**         | end-user wallet · public explorer web-app                                      | [`zk-coins/app`](https://github.com/zk-coins/app) · **[`zk-coins/explorer`](https://github.com/zk-coins/explorer)** ← this repo |
| **SDK**                    | thin TypeScript client — on-device keys, signing, node/API calls               | [`zk-coins/sdk`](https://github.com/zk-coins/sdk)                                                                               |
| **zkCoins API**            | public REST surface (optional hosted wallet features)                          | [`zk-coins/api`](https://github.com/zk-coins/api)                                                                               |
| **zkCoins node**           | trustless kernel — scan · accumulator · verify · prove · store · publisher     | [`zk-coins/node`](https://github.com/zk-coins/node)                                                                             |
| **bitcoind · Nostr relay** | Bitcoin L1 settlement and ordering · off-chain transport and data availability | upstream (own or external)                                                                                                      |

Supporting repos: [`zk-coins/research`](https://github.com/zk-coins/research), [`zk-coins/plonky2`](https://github.com/zk-coins/plonky2), [`zk-coins/docs`](https://github.com/zk-coins/docs).

## This repository (explorer)

A **stateless presentation surface** — its own container, a sibling of the wallet [app](https://github.com/zk-coins/app). It holds no keys and no private state. Builds as a **static export** (no server runtime, no server state).

Two modes ([§5.5](https://docs.zkcoins.com/specification)):

- **Public mode** — L1-anchor layer only, from **public** node endpoints (`/v1/info`, `/v1/chain/*`): the stream of `AggregateStateNullifierV3` nullifier inscriptions with their half-aggregated `(Pkⱼ, Rⱼ)` sets and publisher identities (reveal transaction), the global nullifier accumulator folded from them by first-occurrence (`size`, `nav_root`), and aggregate counts over the **loaded page subset** (inscription count, transitions per block) plus the global accumulator size. §3.10 states (`pending` / `completed` / `failed`) come from the node data and are never guessed client-side. **No** amounts, `asset_id`s, balances, addresses, senders, recipients, CoinProof material, or UTXO/output graph — zkCoins is an account model. Public mode **does not** claim full Bitcoin re-verification of the accumulator; it presents the node's public projection.
- **Authorised / bearer mode** — shareable fragment links (`/tx#…`, `/balance#…`, `/addr#…`) carry Bech32m secrets (`zkview`, `zkavk`, `zkatt`, `zkbid`) in the URL **fragment only** so they never reach the server. The client fetches content-addressed blobs (Blossom / inline), opens ZBE under the bearer secret, and renders an explicit **pass / fail / open** checklist. Decoded fields are shown as **decoded**; checks the explorer cannot run (Plonky2 recursive proof, coin inclusion in `output_coins_root`, canonical NAV on own scan, S2C binding, `C_balance`, full Nostr mesh discovery) stay **`open` / unverified** — never a silent “verified” without the check behind it. Bearer data is **not** sourced from public endpoints alone.

Navigation keeps the §5.5 two-layer boundary visible: Public (L1 anchor) vs Authorised/bearer (account layer).

It offers **no** publisher and **no** wallet API. It MAY reuse [`@zkcoins/sdk`](https://github.com/zk-coins/sdk) as a client where that fits.

### Build configuration

| Variable                    | Required             | Meaning                                                                                                                                                     |
| --------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_NODE_BASE_URL` | **yes** (no default) | Absolute origin of the node/API REST base the explorer reads (e.g. `https://node.example.com`). The build **fails** if it is unset or not an `http(s)` URL. |

Local layout matches the monorepo: `@zkcoins/sdk` is `file:../sdk`. Build the sibling SDK first (`npm ci && npm run build` in `../sdk`), then proceed with the commands below. CI pins SDK commit `8894cfb363e74bdd2ec27b33ec53e72057ee527e` until a released SDK exists.

```bash
export NEXT_PUBLIC_NODE_BASE_URL=https://node.example.com
npm ci
npm run lint
npm run typecheck
npm test
npm run build
# Serve the static export (output: "export" → out/); not next start.
npm start
```

A build **without** `NEXT_PUBLIC_NODE_BASE_URL` must fail.

> **Status:** Public mode (§5.5 / §7.5) and authorised/bearer fragment routes (§5.6–§5.8) with client-side ZBE open and honest open steps for checks the explorer cannot run (Plonky2, own-scan first-occurrence, full Nostr mesh discovery).

## License

MIT
