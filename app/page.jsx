import Script from 'next/script';

export default function Portal() {
  return <>
    <div id="app" />
    <div id="notice" role="status" hidden />
    <Script src="/portal.js" strategy="afterInteractive" />
  </>;
}
