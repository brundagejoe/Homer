import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import App from './App'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/toast'
import { ConfirmHost } from '@/components/ui/alert-dialog'
import './global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* `reducedMotion="user"` is the central §14 gate: when the OS asks for
        reduced motion, Motion drops transform/layout animations everywhere
        automatically, so individual components don't each have to guard. */}
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <App />
        <Toaster />
        <ConfirmHost />
      </TooltipProvider>
    </MotionConfig>
  </React.StrictMode>
)
