// The second anchor chain: a FISCO BCOS 3.x consortium chain (WeBank's open-source chain), reached through
// its Ethereum-compatible RPC. The same CarryPayAnchor contract as on Conflux, its own testnet-only key.
//   node scripts/fisco-anchor.mjs key       # creates FISCO_ANCHOR_PRIVATE_KEY in .env.local if missing (never printed)
//   node scripts/fisco-anchor.mjs deploy    # deploys the contract, writes FISCO_ANCHOR_CONTRACT to .env.local
//   node scripts/fisco-anchor.mjs status    # chain, block height, contract, anchors so far
// FISCO_RPC_URL defaults to http://127.0.0.1:8545: open an SSH tunnel to the server's node first, e.g.
//   ssh -N -L 8545:172.18.0.1:8545 root@169.58.44.4
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROOT = process.cwd();
const ENV = path.join(ROOT, ".env.local");
const ARTIFACT = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "server", "anchor", "artifact.json"), "utf8"));

function env() {
  const text = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
  return Object.fromEntries([...text.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((m) => [m[1], m[2].trim()]));
}

const e = env();
const RPC = process.env.FISCO_RPC_URL || e.FISCO_RPC_URL || "http://127.0.0.1:8545";
const transport = http(RPC, { timeout: 30_000 });
const probe = createPublicClient({ transport });
const chainId = await probe.getChainId();
const chain = defineChain({ id: chainId, name: "FISCO BCOS", nativeCurrency: { name: "none", symbol: "-", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const reader = createPublicClient({ chain, transport });

const cmd = process.argv[2];
if (cmd === "key") {
  if (e.FISCO_ANCHOR_PRIVATE_KEY) console.log("FISCO_ANCHOR_PRIVATE_KEY already set.");
  else {
    const key = generatePrivateKey();
    fs.appendFileSync(ENV, `\n# FISCO BCOS anchor chain (consortium chain on the demo server; gas is free, the key holds nothing)\nFISCO_ANCHOR_PRIVATE_KEY=${key}\n`);
    console.log(`Created FISCO_ANCHOR_PRIVATE_KEY for ${privateKeyToAccount(key).address} in .env.local.`);
  }
} else if (cmd === "deploy") {
  if (!e.FISCO_ANCHOR_PRIVATE_KEY) throw new Error("Run `node scripts/fisco-anchor.mjs key` first.");
  if (e.FISCO_ANCHOR_CONTRACT) throw new Error(`FISCO_ANCHOR_CONTRACT is already set (${e.FISCO_ANCHOR_CONTRACT}).`);
  const account = privateKeyToAccount(e.FISCO_ANCHOR_PRIVATE_KEY);
  const wallet = createWalletClient({ account, chain, transport });
  // FISCO's web3 RPC takes legacy transactions; gas is free on this chain
  const hash = await wallet.deployContract({ abi: ARTIFACT.abi, bytecode: ARTIFACT.bytecode, type: "legacy", gasPrice: 0n, gas: 3_000_000n });
  const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deployment failed (${receipt.status}).`);
  fs.appendFileSync(ENV, `FISCO_ANCHOR_CONTRACT=${receipt.contractAddress}\n`);
  console.log(`Deployed on chain ${chainId} at ${receipt.contractAddress} (block ${receipt.blockNumber}); FISCO_ANCHOR_CONTRACT written to .env.local.`);
} else if (cmd === "status") {
  console.log(`RPC ${RPC} · chain ${chainId} · block ${await reader.getBlockNumber()}`);
  if (e.FISCO_ANCHOR_PRIVATE_KEY) console.log(`Anchor account ${privateKeyToAccount(e.FISCO_ANCHOR_PRIVATE_KEY).address}`);
  if (e.FISCO_ANCHOR_CONTRACT) {
    const count = await reader.readContract({ address: e.FISCO_ANCHOR_CONTRACT, abi: ARTIFACT.abi, functionName: "count" });
    console.log(`Contract ${e.FISCO_ANCHOR_CONTRACT}: ${count} anchors`);
  }
} else console.log("commands: key | deploy | status");
