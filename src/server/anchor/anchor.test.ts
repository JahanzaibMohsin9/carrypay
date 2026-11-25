// On-chain anchoring with a fake chain: no network in npm test.
import { describe, expect, it } from "vitest";
import { Store } from "../store";
import { seedScenario } from "../scenarios";
import { AnchorService, milestoneOf } from "./service";
import { anchorConfig, type ChainPublisher, type OnChainRecord } from "./chain";

function fakeChain(opts: { failFirst?: number } = {}) {
  const txs = new Map<string, OnChainRecord>();
  let fails = opts.failFirst ?? 0;
  const sent: { head: string; seq: number; label: string }[] = [];
  const chain: ChainPublisher = {
    chainId: 71,
    contract: "0x7cebbc3ac1a2ec61607025a589efa01b597c42cf",
    publish: async (a) => {
      if (fails-- > 0) throw new Error("network down");
      sent.push(a);
      const tx = `0x${String(sent.length).padStart(64, "0")}`;
      txs.set(tx, { ...a, blockNumber: 1000 + sent.length, contract: chain.contract });
      return tx;
    },
    confirm: async (tx) => ({ ok: true, blockNumber: txs.get(tx)!.blockNumber }),
    read: async (tx) => txs.get(tx) ?? null,
  };
  return { chain, sent };
}

function boot() {
  const store = new Store();
  store.reset(seedScenario("th-medical"));
  store.log({ actor: "family", type: "case.opened", caseId: "case_th", narration: "Case opened", data: { brief: "Tariq Mahmood, HN 66-014382" } });
  return store;
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("on-chain anchoring", () => {
  it("anchors milestones (several at once share one anchor) with no personal data on-chain", async () => {
    const store = boot();
    const { chain, sent } = fakeChain();
    const svc = new AnchorService(store, chain, { debounceMs: 5, retryMs: 1 });
    for (const e of store.ledger) {
      const m = milestoneOf(e);
      if (m) svc.milestone(m);
    }
    svc.milestone("payment approved");
    await new Promise((r) => setTimeout(r, 30));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ head: store.ledger.at(-1)!.hash, seq: store.ledger.at(-1)!.seq, label: "th-medical:case opened, payment approved" });
    expect(JSON.stringify(sent)).not.toMatch(/Tariq|66-014382/);
    const a = store.anchors[0];
    expect(a.chain).toMatchObject({ status: "confirmed", chainId: 71, blockNumber: 1001 });
    expect(a.chain?.explorerUrl).toMatch(/^https:\/\/evmtestnet\.confluxscan\.org\/tx\/0x/);
    expect((await svc.check(a.id)).ok).toBe(true);
  });

  it("retries a failed send, and records a failure without blocking anything", async () => {
    const store = boot();
    const flaky = fakeChain({ failFirst: 2 });
    const svc = new AnchorService(store, flaky.chain, { retryMs: 1 });
    svc.flush("manual");
    await settle();
    expect(store.anchors[0].chain?.status).toBe("confirmed");

    const down = fakeChain({ failFirst: 99 });
    const svc2 = new AnchorService(store, down.chain, { retries: 2, retryMs: 1 });
    svc2.flush("manual again");
    await settle();
    expect(store.anchors[1].chain).toMatchObject({ status: "failed", error: "network down" });
  });

  it("proves a later edit: the chain still holds the original head", async () => {
    const store = boot();
    store.log({ actor: "bank", type: "payment.completed", caseId: "case_th", narration: "Hospital received THB 250,000", data: {} });
    const { chain } = fakeChain();
    const svc = new AnchorService(store, chain, { retryMs: 1 });
    const anchor = svc.flush("payment received")!;
    await settle();
    store.log({ actor: "agent", type: "tool.add_case_note", caseId: "case_th", data: {} });
    expect((await svc.check(anchor.id)).ok).toBe(true); // later entries don't matter

    store.tamper(2, "Paid THB 250,000 to SR Medical Services Co.");
    const r = await svc.check(anchor.id);
    expect(r.ok).toBe(false);
    expect(r.onChain?.head).toBe(anchor.hash);
    expect(r.reason).toMatch(/changed after it was anchored \(entry #2\)/);
  });

  it("ignores updates for anchors from before a reset", async () => {
    const store = boot();
    const { chain } = fakeChain();
    const svc = new AnchorService(store, chain, { retryMs: 1 });
    svc.flush("before reset");
    store.reset(seedScenario("uk-tuition"));
    await settle();
    expect(store.anchors).toHaveLength(0);
  });

  it("dual-anchors to FISCO BCOS: both chains get the same head, and both must match", async () => {
    const store = boot();
    const conflux = fakeChain();
    const fisco = fakeChain();
    const svc = new AnchorService(store, conflux.chain, { debounceMs: 5, retryMs: 1 }, { ...fisco.chain, chainId: 20200 });
    svc.milestone("case opened");
    await new Promise((r) => setTimeout(r, 30));
    expect(fisco.sent).toEqual(conflux.sent);
    const a = store.anchors[0];
    expect(a.fisco).toMatchObject({ status: "confirmed", chainId: 20200 });
    expect(a.fisco?.explorerUrl).toBeUndefined(); // a consortium chain has no public explorer
    const ok = await svc.check(a.id);
    expect(ok.ok).toBe(true);
    expect(ok.fisco).toMatchObject({ ok: true });
    // if the second chain disagrees, the check fails and says so
    const svc2 = new AnchorService(store, conflux.chain, {}, { ...fisco.chain, read: async () => ({ head: "00".repeat(32), seq: a.seq, label: "x", blockNumber: 1, contract: "0x" }) });
    const bad = await svc2.check(a.id);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/FISCO BCOS holds a different hash/);
  });

  it("FISCO anchoring is on only with its RPC URL, key and contract", async () => {
    const { fiscoConfig } = await import("./chain");
    const key = "0x" + "1".repeat(64);
    const contract = "0x" + "2".repeat(40);
    expect(fiscoConfig({ FISCO_ANCHOR_PRIVATE_KEY: key, FISCO_ANCHOR_CONTRACT: contract })).toBeNull();
    expect(fiscoConfig({ FISCO_RPC_URL: "http://172.18.0.1:8545", FISCO_ANCHOR_PRIVATE_KEY: key, FISCO_ANCHOR_CONTRACT: contract })).toMatchObject({ chainId: 20200 });
  });

  it("is on only with a well-formed testnet key and contract", () => {
    const key = `0x${"ab".repeat(32)}`;
    const contract = "0x7cebbc3ac1a2ec61607025a589efa01b597c42cf";
    expect(anchorConfig({ ANCHOR_PRIVATE_KEY: key, ANCHOR_CONTRACT: contract })).not.toBeNull();
    expect(anchorConfig({ ANCHOR_PRIVATE_KEY: key })).toBeNull();
    expect(anchorConfig({ ANCHOR_PRIVATE_KEY: "nope", ANCHOR_CONTRACT: contract })).toBeNull();
    expect(anchorConfig({ ANCHOR_CHAIN: "ethereum-mainnet", ANCHOR_PRIVATE_KEY: key, ANCHOR_CONTRACT: contract })).toBeNull();
  });

  it("only real milestones count, and only tools that actually ran", () => {
    const e = (type: string, decision?: string) => ({ type, data: decision ? { decision } : {} }) as never;
    expect(milestoneOf(e("payment.completed"))).toBe("payment received");
    expect(milestoneOf(e("tool.close_case", "allowed"))).toBe("case closed");
    expect(milestoneOf(e("tool.close_case", "blocked"))).toBeUndefined();
    expect(milestoneOf(e("agent.thinking"))).toBeUndefined();
  });
});
