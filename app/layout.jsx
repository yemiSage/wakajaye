import './globals.css';

export const metadata = { title: 'Wakajaye — Tenant portal' };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function Layout({ children }) {
  return <html lang="en"><head><link rel="preload" href="/Trap-Regular.otf" as="font" type="font/otf" crossOrigin="anonymous" /></head><body>{children}</body></html>;
}
