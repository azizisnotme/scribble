# Scribble local AI architecture

Scribble AI is optional, fully local, and free. It uses WebLLM inside the
Tauri WebView and never requires an API key, subscription, Python runtime, or
separate Ollama installation.

## Runtime

1. The user opens Scribble AI; no model loads during normal app startup.
2. `hardware-profile.ts` checks WebGPU, approximate memory, CPU concurrency,
   and adapter limits.
3. `webllm-local.ts` chooses an ordered model list:
   - high tier: Qwen 2.5 3B, then Llama 3.2 3B/1B;
   - mid tier: Llama 3.2 3B, then 1B;
   - low tier: Llama 3.2 1B variants.
4. `CreateWebWorkerMLCEngine` downloads the first compatible quantized model
   from the WebLLM catalog and caches it in WebView storage.
5. If that model cannot load, Scribble falls back to the next smaller model.
6. Generation streams from a dedicated worker and can be interrupted.

The first download can be hundreds of megabytes. Later launches reuse the
browser cache. If WebGPU is unavailable, the UI explains that updated graphics
drivers and Edge WebView2 are required.

## Privacy and packaging

- Prompts and generated text stay on the device.
- Models are not bundled in the installer.
- AI history uses Scribble's versioned local storage and is included in local
  backup/export.
- The active app does not promise or probe Ollama. Legacy bundled-Ollama Rust
  code may remain for packaging compatibility but is not part of the supported
  frontend runtime.

## Key files

- `src/lib/hardware-profile.ts` — hardware classification
- `src/lib/ai-runtime.ts` — lifecycle, status, retries, streaming
- `src/lib/webllm-local.ts` — adaptive model selection and worker engine
- `src/workers/webllm-worker.ts` — off-main-thread inference
- `src/views/ScribbleAI.tsx` — Writer and Chat interface

