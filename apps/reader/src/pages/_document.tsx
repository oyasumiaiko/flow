import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    // https://github.com/vercel/next.js/issues/10285
    // Next injects `<style data-next-hide-fouc="true">body{display:none}</style>`,
    // so we should set background on `html`
    <Html className="bg-default">
      <Head>
        <GoogleTagManager />
        <link rel="icon" href="/icons/192.png"></link>
        <PWA />
        <PreventFlash />
      </Head>
      <body>
        <GoogleTagManagerNoScript />
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}

function PWA() {
  return (
    <>
      <link rel="manifest" href="/manifest.webmanifest" />
      <meta id="theme-color" name="theme-color" content={background.light} />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="Flow" />
      <meta
        name="apple-mobile-web-app-status-bar-style"
        content="black-translucent"
      />
      <link rel="apple-touch-icon" href="/icons/192.png" />
    </>
  )
}

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID

function GoogleTagManager() {
  if (!GTM_ID) return null
  return (
    // eslint-disable-next-line @next/next/next-script-for-ga
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
          new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
          j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
          'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
          })(window,document,'script','dataLayer', '${GTM_ID}');
          `,
      }}
    />
  )
}

function GoogleTagManagerNoScript() {
  if (!GTM_ID) return null
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
        height="0"
        width="0"
        style={{ display: 'none', visibility: 'hidden' }}
      ></iframe>
    </noscript>
  )
}

const background = {
  light: 'white',
  dark: '#24292e',
}

// external import in `_document.tsx` will break fast refresh,
// so move it to `_document.tsx`
function PreventFlash() {
  // 这里必须生成完全自包含的字符串。若把闭包函数直接序列化，生产压缩器可能
  // 重命名其外部变量，而另一个内联脚本仍保留原变量名，最终造成首屏脚本报错。
  const initializeColorScheme = `
    (() => {
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      // 用户偏好会在应用启动时从 Sites D1 加载；首屏只按系统颜色避免读取本地存储。
      if (!mql.matches) return
      document.documentElement.classList.toggle('dark', true)
      document.querySelector('#theme-color')?.setAttribute(
        'content',
        ${JSON.stringify(background.dark)},
      )
    })()
  `

  return (
    <>
      <style>{`
        .bg-default, .hover\\:bg-default:hover {
          background: ${background.light};
        }
        .dark.bg-default, .dark .bg-default, .dark .hover\\:bg-default:hover {
          background: ${background.dark};
        }
      `}</style>
      <script
        dangerouslySetInnerHTML={{ __html: initializeColorScheme }}
      ></script>
    </>
  )
}
