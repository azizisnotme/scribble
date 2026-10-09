# bundled-ai/

This folder is populated by `scripts/prefetch-bundled-ai.ps1` and packaged
into Scribble's installer via `tauri.conf.json -> bundle.resources`.

```
bundled-ai/
  runtime/           Ollama Windows standalone (ollama.exe + GPU DLLs)
  models/            Pre-pulled model blobs (manifests + sha256 layers)
```

When present at install time, the desktop runtime points the bundled AI
server at these directories and never touches the internet. Delete it to
fall back to the runtime download flow.
