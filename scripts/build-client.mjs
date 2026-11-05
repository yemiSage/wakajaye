import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Home2, Receipt21, ClipboardTick, ArrowDown2, ArrowLeft2, ArrowRight2, CloseCircle, TickCircle, DocumentUpload, DocumentDownload, People, Element3, LogoutCurve, SearchNormal1, Eye, Sms, Trash } from 'iconsax-react';

const components = {
  Home: Home2, Receipts: Receipt21, Review: ClipboardTick, ChevronDown: ArrowDown2,
  Previous: ArrowLeft2, Next: ArrowRight2, Close: CloseCircle, Check: TickCircle,
  Upload: DocumentUpload, Download: DocumentDownload, Tenants: People, Admin: Element3,
  Logout: LogoutCurve, Search: SearchNormal1, Eye, Email: Sms, Trash,
};
const icons = Object.fromEntries(Object.entries(components).map(([name, component]) => [
  name, renderToStaticMarkup(React.createElement(component, { variant: 'Linear', size: 20, color: 'currentColor', 'aria-hidden': true })),
]));
await build({
  entryPoints: ['src/portal.js'],
  outfile: 'public/portal.js',
  bundle: true,
  minify: true,
  target: ['es2022'],
  banner: { js: '/*! Iconsax icons via iconsax-react. MIT licence: see ICONSAX-LICENSE. */' },
  define: { __WAKAJAYE_ICONS__: JSON.stringify(icons) },
});
