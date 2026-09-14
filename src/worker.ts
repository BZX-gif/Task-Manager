import app from './index'
import { aiHandler } from './ai'

app.post('/api/ai', aiHandler)

export default app
