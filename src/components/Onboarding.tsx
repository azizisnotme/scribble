import { useState } from 'react'
import { Bot, ChevronLeft, ChevronRight, Image, Keyboard, Sparkles } from 'lucide-react'

import type { NavId } from '@/components/Sidebar'
import { ScribbleMarkBadge } from '@/components/ScribbleMark'
import { Button } from '@/components/ui/button'
import { completeOnboarding } from '@/lib/onboarding'

const STEPS = [
  {
    Icon: Sparkles,
    title: 'Welcome to Scribble',
    body: 'Draft, extract, improve, and type text into any Windows app. Your writing stays on this computer.',
  },
  {
    Icon: Keyboard,
    title: 'Type into any app',
    body: 'Put text in Live, select a target window, then press F9. F10 stops and F11 pauses from anywhere.',
  },
  {
    Icon: Image,
    title: 'Turn pictures into text',
    body: 'Extract Text uses local OCR. Send the result straight to Live, a scribble, or your clipboard.',
  },
  {
    Icon: Bot,
    title: 'Optional local AI',
    body: 'Scribble AI runs through WebGPU without an API key. Its free model downloads only when you choose to open it.',
  },
]

export function Onboarding({ onClose, onNavigate }: { onClose: () => void; onNavigate: (id: NavId) => void }) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]

  const finish = (destination?: NavId) => {
    completeOnboarding()
    onClose()
    if (destination) onNavigate(destination)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/85 p-4 backdrop-blur-md" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="app-window w-full max-w-lg rounded-[1.6rem] p-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {step === 0 && <ScribbleMarkBadge className="h-8 w-8 rounded-[11px]" />}
            <p className="eyebrow">
              Getting started · {step + 1}/{STEPS.length}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => finish()}>
            Skip
          </Button>
        </div>
        <div className="py-9 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/15 text-primary">
            <current.Icon className="h-8 w-8" />
          </span>
          <h2 id="onboarding-title" className="font-display mt-5 text-3xl tracking-tight text-foreground">
            {current.title}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-muted-foreground">{current.body}</p>
        </div>
        <div className="mb-5 flex justify-center gap-2" aria-label="Onboarding progress">
          {STEPS.map((item, index) => (
            <span key={item.title} className={`h-1.5 rounded-full transition-all ${index === step ? 'w-8 bg-primary' : 'w-2 bg-secondary'}`} />
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="outline" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>
            <ChevronLeft />
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={() => setStep((value) => value + 1)}>
              Next
              <ChevronRight />
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => finish('scribble-ai')}>
                Try AI
              </Button>
              <Button type="button" onClick={() => finish('live')}>
                Open Live
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

