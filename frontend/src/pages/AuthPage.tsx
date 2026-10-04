import { useState } from 'react'
import type { FormEvent } from 'react'
import { Sparkles } from 'lucide-react'
import Brand from '../components/Brand'
import type { AuthSession } from '../types'
import { apiUrl } from '../config'

type AuthPageProps = {
  mode?: 'login' | 'register'
  onAuthenticated: (session: AuthSession) => void
}

function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [autoBusy, setAutoBusy] = useState(false)
  const [error, setError] = useState('')

  async function performLogin(targetEmail: string, targetPass: string) {
    setError('')
    if (!targetEmail.trim()) { setError('Enter your email address.'); return }
    if (targetPass.length < 8) { setError('Use a password with at least 8 characters.'); return }

    setBusy(true)
    try {
      const response = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail.trim(), password: targetPass }),
      })
      const text = await response.text()
      let result: any = {}
      if (text) {
        try {
          result = JSON.parse(text)
        } catch {
          result = { detail: text }
        }
      }
      if (!response.ok) {
        const detail = Array.isArray(result.detail) ? result.detail[0]?.msg : result.detail
        throw new Error(detail ?? (response.status === 404 ? 'Backend authentication route not found (404).' : `Server error (${response.status})`))
      }
      if (!result.access_token || !result.user) throw new Error('The server returned an incomplete sign-in response.')
      onAuthenticated(result as AuthSession)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the API. Check that the backend is running.')
    } finally {
      setBusy(false)
      setAutoBusy(false)
    }
  }

  async function handleAutomateLogin() {
    setEmail('try.mohitsoni@gmail.com')
    setPassword('123456789')
    setAutoBusy(true)
    await performLogin('try.mohitsoni@gmail.com', '123456789')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await performLogin(email, password)
  }

  return (
    <main className="auth-shell">
      <header className="auth-topbar">
        <Brand />
        <span className="auth-top-note"><span className="status-dot" /> Private document workspace</span>
      </header>
      <div className="auth-layout">
        <aside className="auth-intro">
          <div className="eyebrow">ELCARA CONTRACT WORKSPACE</div>
          <h1>Read the fine print<br /><em>with confidence.</em></h1>
          <p>A private place to keep a contract close and make sense of its details, one question at a time.</p>
          <div className="auth-promise">
            <span className="promise-icon">◇</span>
            <div><strong>Your workspace is yours</strong><span>Sign in to keep your document and conversations together.</span></div>
          </div>
          <div className="auth-footnote">A calmer way to read important agreements.</div>
        </aside>

        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-card-brand"><span className="brand-mark">e</span><span>elcara</span></div>
          <div className="auth-heading">
            <div className="eyebrow">WORKSPACE ACCESS</div>
            <h2 id="auth-title">Sign in to your workspace</h2>
            <p>Pick up where you left off.</p>
          </div>

          <button
            type="button"
            className="auth-auto-button"
            onClick={handleAutomateLogin}
            disabled={busy || autoBusy}
            title="Automatically login with try.mohitsoni@gmail.com"
          >
            {autoBusy ? <span className="spinner" /> : <Sparkles size={16} />}
            <span>{autoBusy ? 'Signing in…' : '⚡ Automate Login'}</span>
          </button>

          <div className="auth-divider">
            <span>or sign in manually</span>
          </div>

          <form className="auth-form" onSubmit={submit} noValidate>
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                minLength={8}
                required
              />
            </label>
            {error && <div className="error-message auth-error" role="alert">{error}</div>}
            <button className="primary-button auth-submit" type="submit" disabled={busy || autoBusy}>
              {busy && !autoBusy ? <><span className="spinner" /> Signing in…</> : 'Sign in'}
            </button>
          </form>

          <div className="auth-security"><span>◇</span> Your account keeps your documents private.</div>
        </section>
      </div>
    </main>
  )
}

export default AuthPage

