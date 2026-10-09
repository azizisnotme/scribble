import { AlertCircle, CheckCircle2, LoaderCircle, LogOut, Settings2, ShieldCheck, UserRound } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuth } from '@/contexts/auth'

interface AccountProps {
  onGoSettings: () => void
}

export function Account({ onGoSettings }: AccountProps) {
  const {
    configured,
    loading,
    actionLoading,
    waitingForBrowser,
    user,
    profile,
    isAdmin,
    error,
    signInWithGoogle,
    signOut,
    clearError,
  } = useAuth()

  return (
    <div className="h-full min-h-0 overflow-auto px-6 pb-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 py-2">
        <Card className="flex gap-3 border-border/50 p-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
            <ShieldCheck className="h-5 w-5" strokeWidth={2} />
          </span>
          <div>
            <p className="eyebrow">Identity</p>
            <h2 className="font-display mt-1 text-[22px] tracking-tight text-foreground">Google account</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Sign in through your browser. Scribble stores the resulting session in your operating system's protected
              credential vault.
            </p>
          </div>
        </Card>

        {error && (
          <Card className="flex items-start gap-3 border-destructive/40 bg-destructive/5 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground">Account action failed</p>
              <p className="mt-1 break-words text-[12px] text-muted-foreground">{error}</p>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={clearError}>
              Dismiss
            </Button>
          </Card>
        )}

        {!configured ? (
          <Card className="border-dashed border-border/70 bg-secondary/20 p-6">
            <h3 className="text-[15px] font-semibold text-foreground">Account setup is required</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              Add your Supabase project URL and publishable key to the app's environment file, then configure Google as
              an authentication provider. The README includes the complete setup steps.
            </p>
          </Card>
        ) : loading ? (
          <Card className="flex items-center gap-3 border-border/60 p-6 text-[13px] text-muted-foreground">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            Restoring your secure session…
          </Card>
        ) : !user ? (
          <Card className="border-border/60 p-6">
            <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-[18px] font-semibold text-foreground">Sign in to Scribble</h3>
                <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                  {waitingForBrowser
                    ? 'Finish Google in your browser. When Scribble says you can close the site, return to the app.'
                    : 'Use Google to identify your Scribble account. Every app feature remains free, and your drafts and typing history stay local to this computer.'}
                </p>
              </div>
              <Button
                type="button"
                className="h-11 shrink-0 rounded-xl px-5 font-semibold"
                disabled={actionLoading || waitingForBrowser}
                onClick={() => void signInWithGoogle()}
              >
                {actionLoading || waitingForBrowser ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <span className="text-base font-bold">G</span>
                )}
                {waitingForBrowser ? 'Waiting for browser…' : 'Continue with Google'}
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="border-border/60 p-6">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="flex min-w-0 items-center gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
                  <UserRound className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[17px] font-semibold text-foreground">
                    {profile?.display_name || user.user_metadata.full_name || 'Google user'}
                  </p>
                  <p className="truncate text-[13px] text-muted-foreground">{profile?.email || user.email}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-500">
                      <CheckCircle2 className="h-3 w-3" />
                      Signed in
                    </span>
                    {isAdmin && (
                      <span className="rounded-full bg-primary/12 px-2.5 py-1 text-[11px] font-semibold text-primary">
                        Administrator
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                disabled={actionLoading}
                onClick={() => void signOut()}
              >
                {actionLoading ? <LoaderCircle className="animate-spin" /> : <LogOut />}
                Sign out
              </Button>
            </div>

            <div className="mt-6 rounded-2xl border border-border/60 bg-secondary/25 p-5 text-[13px] text-muted-foreground">
              Scribble is completely free. Signing in is optional and does not unlock or restrict local features.
            </div>
          </Card>
        )}

        <Card className="flex flex-wrap items-center justify-between gap-3 border-dashed border-border/70 bg-secondary/20 p-5">
          <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
            <Settings2 className="h-5 w-5" strokeWidth={2} />
            Themes and typing preferences remain local to this device.
          </div>
          <Button type="button" variant="ghost" className="rounded-xl text-muted-foreground" onClick={onGoSettings}>
            Personalization &amp; themes
          </Button>
        </Card>
      </div>
    </div>
  )
}
