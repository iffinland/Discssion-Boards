import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const readRepositoryFile = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const packageMetadata = JSON.parse(readRepositoryFile('./package.json')) as {
  version: string;
};
const qavsManifest = JSON.parse(readRepositoryFile('./qortium-app.json')) as {
  version: string;
};

if (packageMetadata.version !== qavsManifest.version) {
  throw new Error('package.json and qortium-app.json versions differ');
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'discussion-boards-release-metadata',
      generateBundle() {
        for (const [fileName, source] of [
          ['qortium-app.json', `${JSON.stringify(qavsManifest, null, 2)}\n`],
          ['LICENSE', readRepositoryFile('./LICENSE')],
          [
            'THIRD_PARTY_NOTICES.md',
            readRepositoryFile('./THIRD_PARTY_NOTICES.md'),
          ],
        ] as const) {
          this.emitFile({ type: 'asset', fileName, source });
        }
      },
    },
  ],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(packageMetadata.version),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
