<template>
  <article class="part-card">
    <img :src="part.image" :alt="`Preview for ${part.name}`" />
    <h2 class="part-name">{{ part.name }}</h2>
    <ul class="asset-list">
      <li v-for="asset in part.assets" :key="asset.label">
        {{ assetDisplay(asset) }}
      </li>
    </ul>
    <button type="button" :disabled="disabled || isSending" @click="handleSend">
      {{ isSending ? 'Sending...' : `Send ${part.name} to KiCad` }}
    </button>
  </article>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { PartRecord, AssetRecord } from '../types/kicad-rpc';
import { sendRpcCommand, BACKOFF_MS } from '../services/kicad-bridge';

const props = defineProps<{
  part: PartRecord;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (e: 'log', msg: string): void;
}>();

const isSending = ref(false);

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KiB`;
  return `${(kb / 1024).toFixed(2)} MiB`;
}

function assetDisplay(asset: AssetRecord) {
  const size = formatBytes(asset.size_bytes);
  return size 
    ? `${asset.label} · ${asset.filename} · ${size}`
    : `${asset.label} · ${asset.filename}`;
}

async function sendWithRetries(asset: AssetRecord) {
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    try {
      // Send RPC
      await sendRpcCommand(asset.command, asset.parameters, asset.data);
      emit('log', `Transferred ${asset.label} (file: ${asset.filename})`);
      return;
    } catch (err: any) {
      emit('log', `Attempt ${attempt + 1} failed for ${asset.label}: ${err.message}`);
      if (attempt === BACKOFF_MS.length - 1) throw err;
      await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]));
    }
  }
}

async function handleSend() {
  if (props.disabled) return;
  isSending.value = true;
  emit('log', `Beginning transfer for ${props.part.name}...`);

  try {
    for (const asset of props.part.assets) {
      await sendWithRetries(asset);
    }
    emit('log', `Completed transfer for ${props.part.name}.`);
  } catch (err: any) {
    emit('log', `Transfer failed for ${props.part.name}: ${err.message}`);
  } finally {
    isSending.value = false;
  }
}
</script>

<style scoped>
.part-card {
  background: linear-gradient(135deg, #f9fafb, #f3f4f6);
  border-radius: 16px;
  padding: 1.5rem;
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.25);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.part-card img {
  width: 100%;
  height: 140px;
  object-fit: contain;
  border-radius: 12px;
  background: #fff;
  box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.15);
}

.part-name {
  font-size: 1.2rem;
  margin: 0;
  color: #1f2933;
}

.asset-list {
  margin: 0;
  padding-left: 1.2rem;
  color: #4b5563;
  font-size: 0.95rem;
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
