import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { CountdownHud } from '@/components/CountdownHud'
import App from './App.tsx'
import { initUiTheme } from '@/lib/theme'
import { AuthProvider } from '@/contexts/AuthContext'
import { initializeStorage } from '@/lib/storage'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'

initUiTheme()
initializeStorage()

const root = createRoot(document.getElementById('root')!)
const overlay = new URLSearchParams(window.location.search).get('overlay')

if (overlay === 'countdown') {
  document.documentElement.classList.add('overlay-clear')
  root.render(<CountdownHud />)
} else {
  root.render(
    <StrictMode>
      <AppErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </AppErrorBoundary>
    </StrictMode>,
  )
}
