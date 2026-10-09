import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { AppPolicy } from '@/lib/app-policy'
import { policyFromRow } from '@/lib/app-policy'

const THEMES = [
  ['', 'People choose'],
  ['cobalt', 'Cobalt'],
  ['bloodlust', 'Bloodlust'],
  ['toxic', 'Toxic'],
  ['hearth', 'Hearth'],
  ['tide', 'Tide'],
  ['noir', 'Noir'],
  ['sketch', 'Sketch'],
  ['classic_light', 'Classic light'],
  ['frost', 'Frost'],
  ['parchment', 'Parchment'],
  ['classic_dark', 'Classic dark'],
] as const

const TOGGLES: { key: keyof AppPolicy; label: string; hint: string }[] = [
  { key: 'signupsOpen', label: 'New signups are open', hint: 'Accounts created after you close this are turned away. People who already joined stay.' },
  { key: 'maintenanceOn', label: 'Maintenance lock', hint: 'Everyone except admins sees a locked screen.' },
  { key: 'liveOn', label: 'Live typing page', hint: 'Hide Live from people who are not admins.' },
  { key: 'typingOn', label: 'Typing is allowed', hint: 'Turns off starting a typing run, including the F9 hotkey.' },
  { key: 'readOnly', label: 'Read-only mode', hint: 'People can look around, but Scribble will not type.' },
  { key: 'hotkeysOn', label: 'F9, F10, and F11 hotkeys', hint: 'Turn the global typing shortcuts off.' },
  { key: 'forceRepair', label: 'Force auto-fix', hint: 'Missing letters and words are repaired even if someone turned auto-fix off.' },
  { key: 'allowTypos', label: 'Allow human typos', hint: 'When off, the human-typo option does nothing.' },
  { key: 'allowPauses', label: 'Allow thinking pauses', hint: 'When off, random thinking pauses stay off.' },
  { key: 'overlayOn', label: 'Typing card overlay', hint: 'The small corner card while Scribble is typing.' },
  { key: 'clipboardOn', label: 'Clipboard offers', hint: 'Offer to send copied text into Live.' },
  { key: 'ocrOn', label: 'Extract text from pictures', hint: 'Hide that page from people who are not admins.' },
  { key: 'aiOn', label: 'Scribble AI', hint: 'Hide Scribble AI from people who are not admins.' },
  { key: 'scribblesOn', label: 'My Scribbles', hint: 'Hide saved scribbles from people who are not admins.' },
  { key: 'templatesOn', label: 'Templates', hint: 'Hide templates from people who are not admins.' },
  { key: 'analyticsOn', label: 'Analytics', hint: 'Hide analytics from people who are not admins.' },
  { key: 'onboardingOn', label: 'First-run tour', hint: 'When off, new installs skip the tour.' },
  { key: 'backupOn', label: 'Backup import and export', hint: 'When off, only admins can export or import a backup.' },
]

function payloadFrom(policy: AppPolicy): Record<string, unknown> {
  return {
    signups_open: policy.signupsOpen,
    maintenance_on: policy.maintenanceOn,
    maintenance_message: policy.maintenanceMessage,
    signup_message: policy.signupMessage,
    allowed_domain: policy.allowedDomain,
    min_version: policy.minVersion,
    update_message: policy.updateMessage,
    support_email: policy.supportEmail,
    welcome_title: policy.welcomeTitle,
    welcome_body: policy.welcomeBody,
    status_line: policy.statusLine,
    dashboard_kicker: policy.dashboardKicker,
    dashboard_headline: policy.dashboardHeadline,
    lock_theme: policy.lockTheme,
    live_on: policy.liveOn,
    ocr_on: policy.ocrOn,
    ai_on: policy.aiOn,
    analytics_on: policy.analyticsOn,
    templates_on: policy.templatesOn,
    scribbles_on: policy.scribblesOn,
    clipboard_on: policy.clipboardOn,
    typing_on: policy.typingOn,
    read_only: policy.readOnly,
    force_repair: policy.forceRepair,
    allow_typos: policy.allowTypos,
    allow_pauses: policy.allowPauses,
    hotkeys_on: policy.hotkeysOn,
    overlay_on: policy.overlayOn,
    onboarding_on: policy.onboardingOn,
    backup_on: policy.backupOn,
    max_wpm: policy.maxWpm,
    max_chars: policy.maxChars,
    default_wpm: policy.defaultWpm,
    default_countdown_sec: policy.defaultCountdownSec,
  }
}

export function AdminPolicy({
  controls,
  disabled,
  busy,
  onSave,
}: {
  controls: Record<string, unknown> | undefined
  disabled: boolean
  busy: boolean
  onSave: (payload: Record<string, unknown>) => void
}) {
  const [draft, setDraft] = useState<AppPolicy>(() => policyFromRow(controls))

  useEffect(() => {
    setDraft(policyFromRow(controls))
  }, [controls])

  const setFlag = (key: keyof AppPolicy, value: boolean) => setDraft((current) => ({ ...current, [key]: value }))
  const setText = (key: keyof AppPolicy, value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const setNumber = (key: keyof AppPolicy, value: string) =>
    setDraft((current) => ({ ...current, [key]: Math.max(0, Number.parseInt(value, 10) || 0) }))

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-border/60 p-5">
        <h3 className="text-[15px] font-semibold">Switches</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {TOGGLES.map((item) => (
            <label key={item.key} className="flex items-start gap-2 rounded-xl border border-border/50 px-3 py-2 text-[13px]">
              <input
                type="checkbox"
                className="mt-1"
                checked={Boolean(draft[item.key])}
                onChange={(event) => setFlag(item.key, event.target.checked)}
              />
              <span>
                <span className="font-medium text-foreground">{item.label}</span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground">{item.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-border/60 p-5">
        <h3 className="text-[15px] font-semibold">Access</h3>
        <label className="block text-[13px] text-muted-foreground">
          Allowed email domain
          <input value={draft.allowedDomain} onChange={(event) => setText('allowedDomain', event.target.value)} placeholder="gmail.com — leave empty for any Google account" className="desk-field mt-1" />
        </label>
        <label className="block text-[13px] text-muted-foreground">
          Message when signups are closed
          <textarea value={draft.signupMessage} onChange={(event) => setText('signupMessage', event.target.value)} className="desk-field mt-1 min-h-20" />
        </label>
        <label className="block text-[13px] text-muted-foreground">
          Maintenance message
          <textarea value={draft.maintenanceMessage} onChange={(event) => setText('maintenanceMessage', event.target.value)} className="desk-field mt-1 min-h-20" />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-[13px] text-muted-foreground">
            Minimum app version
            <input value={draft.minVersion} onChange={(event) => setText('minVersion', event.target.value)} placeholder="0.2.3 — empty means any version" className="desk-field mt-1" />
          </label>
          <label className="block text-[13px] text-muted-foreground">
            Support email
            <input value={draft.supportEmail} onChange={(event) => setText('supportEmail', event.target.value)} placeholder="you@gmail.com" className="desk-field mt-1" />
          </label>
        </div>
        <label className="block text-[13px] text-muted-foreground">
          Message when the app is too old
          <textarea value={draft.updateMessage} onChange={(event) => setText('updateMessage', event.target.value)} className="desk-field mt-1 min-h-20" />
        </label>
      </section>

      <section className="space-y-3 rounded-2xl border border-border/60 p-5">
        <h3 className="text-[15px] font-semibold">Typing limits</h3>
        <p className="text-[12px] text-muted-foreground">Use 0 when you do not want a limit. Admins keep their own speed and countdown.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['maxWpm', 'Max words per minute'],
              ['maxChars', 'Max characters per run'],
              ['defaultWpm', 'Forced typing speed'],
              ['defaultCountdownSec', 'Forced countdown seconds'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-[13px] text-muted-foreground">
              {label}
              <input
                type="number"
                min={0}
                value={draft[key]}
                onChange={(event) => setNumber(key, event.target.value)}
                className="desk-field mt-1"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-border/60 p-5">
        <h3 className="text-[15px] font-semibold">Words people see</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-[13px] text-muted-foreground">
            Dashboard eyebrow
            <input value={draft.dashboardKicker} onChange={(event) => setText('dashboardKicker', event.target.value)} className="desk-field mt-1" />
          </label>
          <label className="block text-[13px] text-muted-foreground">
            Dashboard headline
            <input value={draft.dashboardHeadline} onChange={(event) => setText('dashboardHeadline', event.target.value)} className="desk-field mt-1" />
          </label>
        </div>
        <label className="block text-[13px] text-muted-foreground">
          Welcome title
          <input value={draft.welcomeTitle} onChange={(event) => setText('welcomeTitle', event.target.value)} className="desk-field mt-1" />
        </label>
        <label className="block text-[13px] text-muted-foreground">
          Welcome message
          <textarea value={draft.welcomeBody} onChange={(event) => setText('welcomeBody', event.target.value)} className="desk-field mt-1 min-h-20" />
        </label>
        <label className="block text-[13px] text-muted-foreground">
          Status bar line
          <input value={draft.statusLine} onChange={(event) => setText('statusLine', event.target.value)} placeholder="Shown along the bottom when Scribble is idle" className="desk-field mt-1" />
        </label>
        <label className="block text-[13px] text-muted-foreground">
          Locked theme
          <select value={draft.lockTheme} onChange={(event) => setText('lockTheme', event.target.value)} className="desk-field mt-1">
            {THEMES.map(([id, label]) => (
              <option key={id || 'free'} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <Button type="button" className="rounded-xl" disabled={disabled || busy} onClick={() => onSave(payloadFrom(draft))}>
        Save all policy
      </Button>
    </div>
  )
}
