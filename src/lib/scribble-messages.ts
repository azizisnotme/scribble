/** Chat turns for Scribble AI (built-in engine only). */

export type ScribbleRole = 'system' | 'user' | 'assistant'

export interface ScribbleMessage {
  role: ScribbleRole
  content: string
}
