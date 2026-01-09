import type { RpcEnvelope, CommandType } from '../types/kicad-rpc';

const RPC_VERSION = 1;
export const BACKOFF_MS = [500, 1500, 3000];

// State
let sessionId: string | null = null;
let messageCounter = 0;
const RESPONSE_WAITERS = new Map<string, { resolve: (payload: any) => void; reject: (err: any) => void }>();

// Event Emitter for generic messages (like NEW_SESSION)
type Listener = (payload: RpcEnvelope) => void;
const listeners: Set<Listener> = new Set();

export function onMessage(callback: Listener) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// 1. Post to KiCad
function postToKiCad(payload: any): boolean {
  if (window.webkit?.messageHandlers?.kicad) {
    window.webkit.messageHandlers.kicad.postMessage(payload);
    return true;
  }
  if (window.chrome?.webview?.postMessage) {
    window.chrome.webview.postMessage(payload);
    return true;
  }
  if (window.external?.invoke) {
    try {
      window.external.invoke(payload);
      return true;
    } catch (err) {
      console.error("external.invoke failed", err);
    }
  }
  console.warn("No KiCad bridge found; simulated delivery only.", payload);
  return false;
}

// 2. Incoming Message Handler
export function handleIncomingMessage(incoming: any) {
  let payload = incoming;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (err) {
      console.warn("Failed to parse KiCad response", err, incoming);
      return;
    }
  }

  if (!payload || typeof payload !== "object") return;
  const env = payload as RpcEnvelope;

  // New Session Handling
  if (env.command === "NEW_SESSION" && env.response_to === undefined) {
    sessionId = env.session_id;
    messageCounter = env.message_id || 0;
    RESPONSE_WAITERS.clear();
    // Auto-respond to NEW_SESSION
    sendNewSessionResponse(env);
    
    // Notify listeners
    listeners.forEach(l => l(env));
    return;
  }

  // Response Handling
  if (env.response_to !== undefined) {
    const key = String(env.response_to);
    const waiter = RESPONSE_WAITERS.get(key);
    if (waiter) {
      RESPONSE_WAITERS.delete(key);
      if (env.status === "ERROR") {
        waiter.reject(new Error(env.error_message || "Unknown RPC Error"));
      } else {
        waiter.resolve(env);
      }
    } else {
      console.warn(`Unexpected response for message-id ${env.response_to}`);
    }
    return;
  }

  // Other messages
  listeners.forEach(l => l(env));
}

function sendNewSessionResponse(request: RpcEnvelope) {
  if (!sessionId) return;
  
  const payload = {
    version: RPC_VERSION,
    session_id: sessionId,
    message_id: ++messageCounter,
    response_to: request.message_id,
    command: "NEW_SESSION",
    status: "OK",
    parameters: {
      server_name: "KiCad WebView Vue Client",
      server_version: "1.0.0"
    }
  };
  postToKiCad(JSON.stringify(payload));
}

// 3. Send Command
export function sendRpcCommand(command: CommandType, parameters: any = {}, data: string = ""): Promise<RpcEnvelope> {
  return new Promise((resolve, reject) => {
    if (!sessionId && command !== "NEW_SESSION") { // Allow NEW_SESSION response? No, that's internal.
      // Actually, we can't send anything if no session, EXCEPT maybe if we are initiating? 
      // Protocol says server sends NEW_SESSION first.
      // But for testing/dev, maybe we want to allow skipping?
      // Strict mode:
      reject(new Error("Session has not been established yet."));
      return;
    }

    const msgId = ++messageCounter;
    const key = String(msgId);

    const message: RpcEnvelope = {
      version: RPC_VERSION,
      session_id: sessionId!,
      message_id: msgId,
      command,
      parameters: JSON.parse(JSON.stringify(parameters)),
      data
    };

    const delivered = postToKiCad(JSON.stringify(message));
    if (!delivered) {
       // In browser dev mode, we might want to simulate success or fail?
       // Currently just warning.
    }

    // Set timeout
    const timer = setTimeout(() => {
      RESPONSE_WAITERS.delete(key);
      reject(new Error("Response timeout"));
    }, 4000);

    RESPONSE_WAITERS.set(key, {
      resolve: (val) => { clearTimeout(timer); resolve(val); },
      reject: (err) => { clearTimeout(timer); reject(err); }
    });
  });
}

// 4. Install Bridge
export function installKiClientBridge() {
  const existing = window.kiclient || {};
  // @ts-ignore
  const previousPost = typeof existing.postMessage === "function" ? existing.postMessage.bind(existing) : null;

  // @ts-ignore
  existing.postMessage = function (incoming: any) {
    handleIncomingMessage(incoming);
    if (previousPost) {
      previousPost(incoming);
    }
  };

  window.kiclient = existing as any;
}

export function getSessionId() {
  return sessionId;
}
