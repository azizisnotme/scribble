# icons/

Tauri requires `icons/icon.ico` (Windows), `icons/32x32.png`, `icons/128x128.png`,
and `icons/128x128@2x.png` for `npm run tauri build`. They are NOT required for
`npm run tauri dev` or for the visual Vite preview.

When you're ready to package, run:

```
npx @tauri-apps/cli icon path/to/source.png
```

…and Tauri will generate every size into this folder. For now you can ship a
single 1024×1024 PNG of the Scribble logo from `assets/`.
