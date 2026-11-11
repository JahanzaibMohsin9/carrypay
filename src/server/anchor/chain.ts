// The public chain the activity log is anchored to: Conflux eSpace testnet (EVM, chain ID 71). A
// China-built public chain whose explorer opens from mainland China. Only the anchor wallet's key
// signs, only our contract is called, and only hashes go on-chain.
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, http, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import artifact from "./artifact.json";

export const ANCHOR_CHAIN = {
  id: 71,
  name: "Conflux eSpace Testnet",
  nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmtestnet.confluxrpc.com"] } },
  blockExplorers: { default: { name: "ConfluxScan", url: "https://evmtestnet.confluxscan.org" } },
} as const;

export const ANCHOR_ABI = artifact.abi;
export const explorerTx = (txHash: string) => `${ANCHOR_CHAIN.blockExplorers.default.url}/tx/${txHash}`;
export const explorerAddress = (address: string) => `${ANCHOR_CHAIN.blockExplorers.default.url}/address/${address}`;

export interface AnchorConfig {
  privateKey: Hex;
  contract: Hex;
}

/** On only when both the testnet key and the deployed contract are set (see scripts/anchor-contract.mjs). */
export function anchorConfig(env: Record<string, string | undefined> = process.env): AnchorConfig | null {
  if (env.ANCHOR_CHAIN && env.ANCHOR_CHAIN !== "conflux-espace-testnet") return null;
  const key = env.ANCHOR_PRIVATE_KEY?.trim();
  const contract = env.ANCHOR_CONTRACT?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key) || !contract || !/^0x[0-9a-fA-F]{40}$/.test(contract)) return null;
  return { privateKey: key as Hex, contract: contract as Hex };
}

export interface OnChainRecord {
  head: string;
  seq: number;
  label: string;
  blockNumber: number;
  contract: string;
}

/** What the anchoring service needs from a chain; tests swap in a fake. */
export interface ChainPublisher {
  chainId: number;
  contract: string;
  publish(a: { head: string; seq: number; label: string }): Promise<string>;
  confirm(txHash: string): Promise<{ ok: boolean; blockNumber: number }>;
  read(txHash: string): Promise<OnChainRecord | null>;
}

// ---------------------------------------------------------------------------
// Second anchor chain: FISCO BCOS 3.x, the open-source consortium chain from WeBank's FISCO open-source
// community, through its Ethereum-compatible RPC. In the demo it is a 4-node chain on the server, reachable
// only from CarryPay's container (see scripts/fisco-anchor.mjs). In production it would be the bank's own
// consortium chain. Same contract, its own key; gas is free on it.

export const FISCO_NAME = "FISCO BCOS";

export interface FiscoConfig extends AnchorConfig {
  rpcUrl: string;
  chainId: number;
}

/** On only with the RPC URL, the key and the deployed contract (FISCO_RPC_URL, FISCO_ANCHOR_PRIVATE_KEY, FISCO_ANCHOR_CONTRACT). */
export function fiscoConfig(env: Record<string, string | undefined> = process.env): FiscoConfig | null {
  const key = env.FISCO_ANCHOR_PRIVATE_KEY?.trim();
  const contract = env.FISCO_ANCHOR_CONTRACT?.trim();
  const rpcUrl = env.FISCO_RPC_URL?.trim();
  if (!rpcUrl || !key || !/^0x[0-9a-fA-F]{64}$/.test(key) || !contract || !/^0x[0-9a-fA-F]{40}$/.test(contract)) return null;
  return { privateKey: key as Hex, contract: contract as Hex, rpcUrl, chainId: Number(env.FISCO_CHAIN_ID ?? 20200) };
}

export function fiscoPublisher(cfg: FiscoConfig): ChainPublisher {
  const chain = defineChain({ id: cfg.chainId, name: FISCO_NAME, nativeCurrency: { name: "none", symbol: "-", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } });
  // FISCO's web3 RPC takes legacy transactions with no gas price
  return viemPublisher(cfg, chain, { type: "legacy", gasPrice: BigInt(0), gas: BigInt(500_000) });
}

export function viemPublisher(cfg: AnchorConfig, chain: Chain = ANCHOR_CHAIN, tx: { type?: "legacy"; gasPrice?: bigint; gas?: bigint } = {}): ChainPublisher {
  const account = privateKeyToAccount(cfg.privateKey);
  const transport = http(undefined, { timeout: 30_000, retryCount: 2 });
  const wallet = createWalletClient({ account, chain, transport });
  const reader = createPublicClient({ chain, transport });
  return {
    chainId: chain.id,
    contract: cfg.contract,
    publish: ({ head, seq, label }) =>
      wallet.writeContract({ address: cfg.contract, abi: ANCHOR_ABI, functionName: "anchor", args: [`0x${head}`, BigInt(seq), label], ...tx }),
    confirm: async (txHash) => {
      const r = await reader.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 120_000 });
      return { ok: r.status === "success", blockNumber: Number(r.blockNumber) };
    },
    read: async (txHash) => {
      const r = await reader.getTransactionReceipt({ hash: txHash as Hex });
      for (const log of r.logs) {
        if (log.address.toLowerCase() !== cfg.contract.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: ANCHOR_ABI, data: log.data, topics: log.topics });
          if (ev.eventName !== "Anchored") continue;
          const args = ev.args as unknown as { head: Hex; seq: bigint; label: string };
          return { head: args.head.slice(2), seq: Number(args.seq), label: args.label, blockNumber: Number(r.blockNumber), contract: log.address };
        } catch {
          // another event
        }
      }
      return null;
    },
  };
}
