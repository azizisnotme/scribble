import { supabase } from '@/lib/supabase'

export const LIVE_EVENT = 'scribble:live'

/** Opens one live connection so bans, notices, and locks arrive without waiting on a timer. */
export function subscribeLiveEvents(): () => void {
  const client = supabase
  if (!client) return () => {}
  let timer = 0
  const channel = client
    .channel('scribble-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_pulse' }, () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => window.dispatchEvent(new Event(LIVE_EVENT)), 150)
    })
    .subscribe()
  return () => {
    window.clearTimeout(timer)
    void client.removeChannel(channel)
  }
}
