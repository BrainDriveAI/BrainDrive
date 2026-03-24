import type { GatewayAdapter } from "./gateway-base.js";
import { OpenAICompatibleGatewayAdapter } from "./gateway-openai-compatible.js";

export function createGatewayAdapter(adapterName: string): GatewayAdapter {
  switch (adapterName) {
    case "openai-compatible":
      return new OpenAICompatibleGatewayAdapter();
    default:
      throw new Error(`Unsupported gateway adapter: ${adapterName}`);
  }
}

