import Script from 'next/script';
import { portalScript } from '../lib/portal-asset.mjs';

export default function PortalShell({ adminMode = false }) {
  return <>
    <link rel="preload" href={portalScript} as="script" />
    <div id="app" data-portal={adminMode ? 'admin' : 'tenant'}>
      <main className="auth">
        <section className="auth-card" data-screen="login" aria-labelledby="auth-title">
          <header><img className="logo" src="/wordmark.svg" alt="Wakajaye" width="175" height="61" /></header>
          <h1 id="auth-title">{adminMode ? 'Admin sign in' : 'Create your account'}</h1>
          <p className="intro">{adminMode ? 'Enter your administrator email to receive a sign-in code.' : 'Enter your email to receive a one-time code.'}</p>
          <form className="stack" data-form="code">
            <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></label>
            <button className="btn primary" disabled>Send code</button>
            <p className="error" role="alert" hidden />
          </form>
          {!adminMode && <p className="switch">Already have an account? <button className="link" data-go="toggle">Sign in</button></p>}
        </section>
      </main>
    </div>
    <div id="notice" role="status" hidden />
    <Script src={portalScript} strategy="afterInteractive" />
  </>;
}
