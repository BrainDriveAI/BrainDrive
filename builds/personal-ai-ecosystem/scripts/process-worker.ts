import { readFileSync } from "node:fs";
import {
  Authority,
  Memory,
  MockSeller,
  Purchaser,
  type Offer,
  type Proof,
} from "../src/core.js";
const path = process.argv[2];
if (!path) throw new Error("worker input");
const input = JSON.parse(readFileSync(path, "utf8")) as {
  authority: string;
  owner: string;
  id: string;
  grantId: string;
  offer: Offer;
  proof: Proof;
  mode: "reserve" | "crash-after-effect";
  memory: string;
  seller: string;
};
const auth = new Authority(input.authority, input.owner);
try {
  if (input.mode === "reserve") {
    auth.reserve(input.grantId, input.id, input.offer, input.proof);
    console.log("reserved");
  } else {
    const seller = new MockSeller(input.seller);
    seller.afterExecute = () => {
      process.kill(process.pid, "SIGKILL");
    };
    await new Purchaser(auth, new Memory(input.memory), seller, () => {
      throw new Error("recovery unavailable in crash worker");
    }).buy(input.grantId, input.id, input.offer, input.proof);
    throw new Error("crash injection did not execute");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "worker failed");
  process.exitCode = 1;
} finally {
  auth.close();
}
