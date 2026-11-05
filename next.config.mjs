export default {
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        // Keep Next's inline bootstrap working; prohibit embedding and plugin content.
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }];
  },
  outputFileTracingIncludes: {
    '/api/agreement': ['./assets/fonts/*.ttf', './content/residential-tenancy-agreement.txt'],
    '/api/[action]': ['./content/residential-tenancy-agreement.txt'],
  },
};
