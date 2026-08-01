import React from 'react'
import ReactDOM from 'react-dom/client'
// Only the three defaults are eager: the UI font, its CJK fallback and the terminal
// font. Every other family is a dynamic import in lib/fontLoader, because shipping all
// 23 up front put ~200KB of CSS and 200-odd @font-face rules ahead of first paint for
// typefaces the user had not chosen.
import '@fontsource-variable/geist'
import '@fontsource-variable/noto-sans-sc'
import '@fontsource-variable/jetbrains-mono'
import App from './App'
import { installGlobalErrorLogging } from './lib/logger'
import './index.css'

installGlobalErrorLogging()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
