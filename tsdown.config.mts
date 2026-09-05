import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'cjs',
  platform: 'node',
  dts: true,
  // 输出固定为 lib/index.js / lib/index.d.ts,与 package.json 的 main/exports 对齐
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})
