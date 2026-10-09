/** Persisted UI palette — mirrors Python ``THEME_PRESETS`` ids where possible. */

export type UiThemeId =
  | 'cobalt'
  | 'bloodlust'
  | 'toxic'
  | 'hearth'
  | 'tide'
  | 'noir'
  | 'sketch'
  | 'classic_light'
  | 'frost'
  | 'parchment'
  | 'classic_dark'

const THEME_IDS: UiThemeId[] = [
  'cobalt',
  'bloodlust',
  'toxic',
  'hearth',
  'tide',
  'noir',
  'sketch',
  'classic_light',
  'frost',
  'parchment',
  'classic_dark',
]

const STORAGE_KEY = 'scribble_ui_theme'

function readTheme(): UiThemeId {
  const saved = localStorage.getItem(STORAGE_KEY)
  return THEME_IDS.includes(saved as UiThemeId) ? (saved as UiThemeId) : 'cobalt'
}

export function initUiTheme(): void {
  applyUiThemeToDom(readTheme())
}

export function getUiTheme(): UiThemeId {
  return readTheme()
}

export function setUiTheme(id: UiThemeId): void {
  localStorage.setItem(STORAGE_KEY, id)
  applyUiThemeToDom(id)
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    void import('@tauri-apps/api/event').then(({ emit }) => emit('ui://theme', id))
  }
}

function applyUiThemeToDom(id: UiThemeId): void {
  const root = document.documentElement
  if (id === 'cobalt') delete root.dataset.uiTheme
  else root.dataset.uiTheme = id
}
