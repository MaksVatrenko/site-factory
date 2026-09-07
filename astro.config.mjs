import { existsSync } from 'node:fs';
import { defineConfig } from 'astro/config';

const envPublicDir = process.env.PUBLIC_DIR;
const publicDir = envPublicDir && existsSync(envPublicDir) ? envPublicDir : './public';

export default defineConfig({
  site: process.env.SITE_URL || 'https://example.com',
  outDir: process.env.OUT_DIR || './output/preview',
  publicDir,
  build: { format: 'directory', inlineStylesheets: 'always' },
  devToolbar: { enabled: false },
});
