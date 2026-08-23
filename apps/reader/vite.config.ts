import { sites } from '@openai/sites-vite-plugin'
import vinext from 'vinext'
import { defineConfig } from 'vite'

import hostingConfig from './.openai/hosting.json'

const LOCAL_DATABASE_ID = '00000000-0000-4000-8000-000000000000'

const localBindingConfig = {
  main: './worker/index.ts',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: hostingConfig.d1
    ? [
        {
          binding: hostingConfig.d1,
          database_name: 'flow-sites-d1',
          database_id: LOCAL_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: hostingConfig.r2
    ? [
        {
          binding: hostingConfig.r2,
          bucket_name: 'flow-sites-books',
        },
      ]
    : [],
}

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= 'false'
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs'
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry'

  const { cloudflare } = await import('@cloudflare/vite-plugin')

  return {
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        // Flow 使用 Pages Router，Worker 本身就是完整的服务端入口。Sites 的
        // 打包契约固定读取 dist/server/index.js，因此环境名必须明确为 server。
        viteEnvironment: { name: 'server' },
        config: localBindingConfig,
      }),
    ],
  }
})
