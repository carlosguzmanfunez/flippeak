import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/account', '/admin', '/api/'],
      },
    ],
    sitemap: 'https://flippeak.vercel.app/sitemap.xml',
  };
}
