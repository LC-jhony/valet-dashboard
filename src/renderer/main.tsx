import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { applySettings, loadSettings } from './theme'

applySettings(loadSettings()) // evita el parpadeo del primer render

createRoot(document.getElementById('root')!).render(<App />)
