import { chatGPTSignInPath, getChatGPTUser } from './chatgpt-auth'
import { CloudLibrary } from './components/CloudLibrary'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const user = await getChatGPTUser()

  if (user) return <CloudLibrary displayName={user.displayName} />

  return (
    <main className="library-shell">
      <header className="library-header">
        <div>
          <p className="eyebrow">FLOW CLOUD LIBRARY</p>
          <h1>你的书，停在你上次读到的地方。</h1>
          <p className="lede">
            EPUB
            原文件安全保存在云端，阅读进度、批注与排版设置会在手机和电脑之间同步。
          </p>
        </div>
        <div className="account-chip">本地预览 · 部署后使用 ChatGPT 登录</div>
      </header>

      <section className="library-toolbar" aria-label="书库操作">
        <div>
          <strong>我的书库</strong>
          <span>账号之间完全隔离</span>
        </div>
        <a href={chatGPTSignInPath('/')}>使用 ChatGPT 登录</a>
      </section>

      <section className="empty-library">
        <div className="book-mark" aria-hidden="true">
          F
        </div>
        <h2>把第一本书放进云端书库</h2>
        <p>导入后，在任何登录同一 ChatGPT 账号的设备上继续阅读。</p>
      </section>
    </main>
  )
}
