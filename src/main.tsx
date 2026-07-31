import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans'
import '@fontsource-variable/noto-sans-sc'
import '@fontsource-variable/nunito-sans'
import '@fontsource-variable/figtree'
import '@fontsource-variable/roboto'
import '@fontsource-variable/roboto-mono'
import '@fontsource-variable/raleway'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/public-sans'
import '@fontsource-variable/outfit'
import '@fontsource-variable/oxanium'
import '@fontsource-variable/instrument-sans'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/noto-serif'
import '@fontsource-variable/roboto-slab'
import '@fontsource-variable/merriweather'
import '@fontsource-variable/lora'
import '@fontsource-variable/playfair-display'
import '@fontsource-variable/eb-garamond'
import '@fontsource/instrument-serif/400.css'
import App from './App'
import { installGlobalErrorLogging } from './lib/logger'
import './index.css'

installGlobalErrorLogging()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
