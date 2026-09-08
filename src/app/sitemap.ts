import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://flippeak.vercel.app';
  return [
    { url: base, changeFrequency: 'always', priority: 1 },
    { url: `${base}/login`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/register`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/my-campaigns`, changeFrequency: 'monthly', priority: 0.6 },
  ];
}
