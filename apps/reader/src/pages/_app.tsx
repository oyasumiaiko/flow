import './styles.css'
import 'react-photo-view/dist/react-photo-view.css'

import { LiteralProvider } from '@literal-ui/core'
import type { AppProps } from 'next/app'
import Head from 'next/head'
import type { ComponentType, PropsWithChildren } from 'react'

import { ErrorBoundary, Layout, Theme } from '../components'
import { CloudSettingsGate } from '../components/CloudSettingsGate'

const LiteralProviderWithChildren =
  LiteralProvider as ComponentType<PropsWithChildren>

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <ErrorBoundary>
      <Head>
        <title>Flow</title>
      </Head>
      <LiteralProviderWithChildren>
        <CloudSettingsGate>
          <Theme />
          <Layout>
            <Component {...pageProps} />
          </Layout>
        </CloudSettingsGate>
      </LiteralProviderWithChildren>
    </ErrorBoundary>
  )
}
