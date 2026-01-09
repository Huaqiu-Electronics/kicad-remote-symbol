<template>
  <div class="container">
    <h1>Remote Symbol Demo Browser (Vue)</h1>
    <p class="intro">
      Select a part to stream its assets to KiCad. Each asset is zstd-compressed,
      base64-encoded, and delivered in sequence with acknowledgement (ACK) handling.
    </p>

    <section class="login-panel">
      <button 
        type="button" 
        @click="requestLogin" 
        :disabled="loginInFlight || !sessionId"
      >
        Log in via Browser
      </button>
      <span class="login-status">{{ loginStatus }}</span>
    </section>

    <section v-if="loading" class="parts-grid">
      <p>Loading parts...</p>
    </section>
    
    <section v-else-if="error" class="parts-grid">
      <p class="error">{{ error }}</p>
    </section>
    
    <section v-else class="parts-grid">
      <PartCard 
        v-for="part in parts" 
        :key="part.name" 
        :part="part" 
        :disabled="!sessionId"
        @log="appendLog"
      />
    </section>

    <section>
      <h2>Transfer log</h2>
      <pre ref="statusLog">No transfers yet.</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { PartRecord } from './types/kicad-rpc';
import { installKiClientBridge, sendRpcCommand, getSessionId, onMessage } from './services/kicad-bridge';
import PartCard from './components/PartCard.vue';

const parts = ref<PartRecord[]>([]);
const loading = ref(true);
const error = ref("");
const statusLog = ref<HTMLPreElement | null>(null);
const loginStatus = ref("Not logged in");
const sessionId = ref<string | null>(null);
const loginInFlight = ref(false);

const appendLog = (message: string) => {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${message}`;
  if (statusLog.value) {
    const current = statusLog.value.textContent === "No transfers yet." ? "" : statusLog.value.textContent + "\n";
    statusLog.value.textContent = `${entry}\n${current}`;
  }
};

async function fetchParts() {
  try {
    const res = await fetch('/api/parts');
    if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
    parts.value = await res.json();
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function requestLogin() {
  if (!sessionId.value) {
    appendLog("Cannot log in until KiCad establishes a session.");
    return;
  }
  if (loginInFlight.value) return;

  loginInFlight.value = true;
  loginStatus.value = "Waiting for browser login...";
  appendLog("Issuing REMOTE_LOGIN command...");

  try {
    const LOGIN_ENDPOINT = new URL("/login", window.location.origin).toString();
    const response = await sendRpcCommand("REMOTE_LOGIN", { url: LOGIN_ENDPOINT });
    const port = response.parameters?.port;
    
    if (!port) throw new Error("KiCad did not provide a callback port.");
    
    appendLog(`Please complete login in the external browser (port ${port})...`);
    loginStatus.value = "Waiting for external login...";
    
  } catch (err: any) {
    appendLog(`Remote login failed: ${err.message}`);
    loginStatus.value = "Login failed";
    loginInFlight.value = false;
  }
}

onMounted(() => {
  installKiClientBridge();
  fetchParts();

  // Listen for session changes
  onMessage((env) => {
      if (env.command === 'NEW_SESSION') {
          sessionId.value = env.session_id;
          if (env.parameters?.user_id) {
            loginStatus.value = `Logged in as ${env.parameters.user_id}`;
            loginInFlight.value = false;
          } else {
             loginStatus.value = "Session Active";
          }
          appendLog(`Session established: ${env.session_id}`);
      } else {
          appendLog(`KiCad -> ${JSON.stringify(env)}`);
      }
  });

  // Check initial session (though redundant if we rely on NEW_SESSION event)
  sessionId.value = getSessionId();
});
</script>

<style>
:root {
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  background: #e7eef8;
}

body {
  margin: 0;
  padding: 2rem;
  background: #e7eef8;
  color: #1f2933;
}
</style>

<style scoped>
.container {
  max-width: 960px;
  margin: 0 auto;
  background: #fff;
  padding: 2rem;
  border-radius: 16px;
  box-shadow: 0 8px 30px rgba(15, 23, 42, 0.14);
}

h1 {
  margin-top: 0;
  margin-bottom: 0.5rem;
  font-size: 2rem;
}

.intro {
  margin-bottom: 2rem;
  color: #4b5563;
}

.parts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
}

.login-panel {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.login-status {
  font-weight: 600;
  color: #1f2933;
}

.error {
  color: #ef4444;
  font-weight: bold;
}

pre {
  background: #0f172a;
  color: #d1d5db;
  padding: 1rem;
  border-radius: 12px;
  overflow-x: auto;
  line-height: 1.5;
  min-height: 120px;
  max-height: 300px;
  font-size: 0.9rem;
  white-space: pre-wrap;
}

button {
  font-size: 1rem;
  padding: 0.75rem 1.25rem;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  background: #2563eb;
  color: #fff;
  transition: background 0.15s ease, transform 0.15s ease;
}

button:hover:not(:disabled) {
  background: #1d4ed8;
  transform: translateY(-1px);
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
