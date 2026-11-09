import './index.css'
import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import { App } from './App.js'

const container = document.getElementById('root')
if (!container) throw new Error('Missing application root element')

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)