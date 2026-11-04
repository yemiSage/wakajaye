import Script from 'next/script';

export default function Portal() {
  return <>
    <link rel="preload" href="/portal.js" as="script" />
    <div id="app">
      <main className="auth">
        <section className="auth-card" data-screen="login" aria-labelledby="auth-title">
          <header><img className="logo" src="/wordmark.svg" alt="Wakajaye" width="175" height="61" /></header>
          <h1 id="auth-title">Create your account</h1>
          <p className="intro">Enter your email to receive a one-time code.</p>
          <form className="stack" data-form="code">
            <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></label>
            <button className="btn primary" disabled>Send code</button>
            <p className="error" role="alert" hidden />
          </form>
          <p className="switch">Already have an account? <button className="link" data-go="toggle">Sign in</button></p>
        </section>
      </main>
    </div>
    <div id="notice" role="status" hidden />
    <Script src="/portal.js" strategy="afterInteractive" />
  </>;
}
