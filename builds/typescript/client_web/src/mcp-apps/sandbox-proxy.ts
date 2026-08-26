import type { AppLaunch } from "@/api/apps-adapter";

export const BRIDGE_CHANNEL = "braindrive:mcp-app-proxy:v1" as const;
export const OUTER_PROXY_SANDBOX = "allow-scripts allow-same-origin" as const;
export const VIEW_SANDBOX = "allow-scripts" as const;
export const VIEW_PERMISSION_POLICY = "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'" as const;

export type ApprovedResourceCsp = {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
};

function approvedDomains(values: string[] | undefined): string[] {
  return (values ?? []).filter((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === value.replace(/\/$/, "");
    } catch {
      return false;
    }
  });
}

function directive(name: string, values: string[] | undefined, fallback: string): string {
  const approved = approvedDomains(values);
  return `${name} ${approved.length > 0 ? approved.join(" ") : fallback}`;
}

export function buildViewCsp(csp: ApprovedResourceCsp = {}): string {
  const resources = approvedDomains(csp.resourceDomains);
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'" + (resources.length > 0 ? ` ${resources.join(" ")}` : ""),
    "style-src 'unsafe-inline'" + (resources.length > 0 ? ` ${resources.join(" ")}` : ""),
    `img-src data:${resources.length > 0 ? ` ${resources.join(" ")}` : ""}`,
    `media-src data:${resources.length > 0 ? ` ${resources.join(" ")}` : ""}`,
    `font-src${resources.length > 0 ? ` ${resources.join(" ")}` : " 'none'"}`,
    directive("connect-src", csp.connectDomains, "'none'"),
    directive("frame-src", csp.frameDomains, "'none'"),
    directive("base-uri", csp.baseUriDomains, "'none'"),
    "form-action 'none'",
    "object-src 'none'",
    "worker-src 'none'",
  ].join("; ");
}

export function createSandboxResourceNotification(
  resource: AppLaunch["resource"],
  csp: ApprovedResourceCsp = {},
) {
  return {
    jsonrpc: "2.0" as const,
    method: "ui/notifications/sandbox-resource-ready" as const,
    params: {
      html: resource.html,
      sandbox: VIEW_SANDBOX,
      csp,
      permissions: {},
    },
  };
}

export function createSafeHostContext(
  entryPoint: AppLaunch["entry_point"],
  input: { width: number; height: number; platform: "web" | "desktop" | "mobile" },
) {
  return {
    theme: "dark" as const,
    displayMode: "inline" as const,
    availableDisplayModes: ["inline"] as const,
    containerDimensions: {
      width: Math.max(320, Math.min(1_920, Math.round(input.width))),
      height: Math.max(240, Math.min(1_200, Math.round(input.height))),
    },
    locale: typeof navigator === "undefined" ? "en-US" : navigator.language,
    platform: input.platform,
    entryPoint,
  };
}

export function createSandboxProxyUrl(proxyNonce: string, appName = "App"): string {
  if (!/^[A-Za-z0-9._~-]{16,256}$/.test(proxyNonce)) {
    throw new Error("sandbox_proxy_nonce_invalid");
  }
  const safeAppName = typeof appName === "string" && appName.length > 0 && appName.length <= 80 ? appName : "App";
  const safeTitleLiteral = JSON.stringify(safeAppName).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
  const documentText = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>html,body,#root{height:100%;margin:0;background:#03050a}iframe{width:100%;height:100%;border:0;background:#03050a}</style></head>
<body><div id="root"></div><script>(()=>{"use strict";
const CHANNEL=${JSON.stringify(BRIDGE_CHANNEL)};
const NONCE=${JSON.stringify(proxyNonce)};
let view=null;
const post=(source,message)=>parent.postMessage({channel:CHANNEL,direction:"proxy_to_host",proxy_nonce:NONCE,source,message},"*");
const safeDomains=value=>Array.isArray(value)?value.filter(item=>{try{const url=new URL(item);return url.protocol==="https:"&&url.origin===item.replace(/\\/$/,"")}catch{return false}}):[];
const directive=(name,values,fallback)=>{const safe=safeDomains(values);return name+" "+(safe.length?safe.join(" "):fallback)};
const csp=value=>{const policy=value&&typeof value==="object"?value:{};const resources=safeDomains(policy.resourceDomains);const suffix=resources.length?" "+resources.join(" "):"";return ["default-src 'none'","script-src 'unsafe-inline'"+suffix,"style-src 'unsafe-inline'"+suffix,"img-src data:"+suffix,"media-src data:"+suffix,"font-src"+(resources.length?suffix:" 'none'"),directive("connect-src",policy.connectDomains,"'none'"),directive("frame-src",policy.frameDomains,"'none'"),directive("base-uri",policy.baseUriDomains,"'none'"),"form-action 'none'","object-src 'none'","worker-src 'none'"].join("; ")};
const withCsp=(html,policy)=>{const meta='<meta http-equiv="Content-Security-Policy" content="'+policy.replaceAll('&','&amp;').replaceAll('"','&quot;')+'">';const match=/<head(?:\\s[^>]*)?>/i.exec(html);return match?html.slice(0,match.index+match[0].length)+meta+html.slice(match.index+match[0].length):"<!doctype html><html><head>"+meta+"</head><body>"+html+"</body></html>"};
addEventListener("message",event=>{
  const data=event.data;
  if(event.source===parent){
    if(!data||data.channel!==CHANNEL||data.direction!=="host_to_proxy"||data.proxy_nonce!==NONCE)return;
    const message=data.message;
    if(message&&message.jsonrpc==="2.0"&&message.method==="ui/notifications/sandbox-resource-ready"){
      const params=message.params;
      if(!params||typeof params.html!=="string"||params.sandbox!=="allow-scripts")return;
      if(view)view.remove();
      view=document.createElement("iframe");
view.title=${safeTitleLiteral};
      view.setAttribute("sandbox","allow-scripts");
      view.setAttribute("allow","camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'");
      view.referrerPolicy="no-referrer";
      view.srcdoc=withCsp(params.html,csp(params.csp));
      document.getElementById("root").replaceChildren(view);
      return;
    }
    if(view&&view.contentWindow)view.contentWindow.postMessage(message,"*");
    return;
  }
  if(view&&event.source===view.contentWindow&&event.origin==="null")post("view",event.data);
});
post("proxy",{jsonrpc:"2.0",method:"ui/notifications/sandbox-proxy-ready",params:{}});
})()</script></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(documentText)}`;
}
