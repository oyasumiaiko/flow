import handler from 'vinext/server/pages-router-entry'

/**
 * Flow 保留原有 Pages Router 前端，由 vinext 将同一份应用编译为 Sites 可运行的
 * Cloudflare Worker。D1、R2 与用户身份都由 Sites 在请求时注入。
 */
export default handler
