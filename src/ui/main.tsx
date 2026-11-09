import './index.css'
import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import { App } from './App.tsx'
import { runArabicShortsJob } from '../core/jobrunner.js'

// Ensure TypeScript types are available at runtime
import '../core/types.js'
import '../core/ledger.js'
import '../core/policy.js'

// Bootstrap the application
document.addEventListener('DOMContentLoaded', () => {
  console.log('reel-forge Dashboard starting...')
  console.log('TypeScript modules loaded successfully')

  // Check if we're in a browser environment
  if (typeof window !== 'undefined') {
    // Initialize the app
    const root = ReactDOM.createRoot(
      document.getElementById('root') as HTMLElement
    )
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  }
})