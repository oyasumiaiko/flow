import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Sites 同时声明 D1 和 R2 逻辑绑定", async () => {
  const hosting = JSON.parse(await read("../.openai/hosting.json"));
  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, "BOOKS");
});

test("书籍 API 的每个数据库读写都包含服务端用户 ID", async () => {
  const library = await read("../app/api/library/route.ts");
  const book = await read("../app/api/books/[id]/route.ts");
  const content = await read("../app/api/books/[id]/content/route.ts");
  assert.match(library, /WHERE user_id = \?/);
  assert.match(library, /user\.userId/);
  assert.match(book, /WHERE user_id = \? AND id = \?/);
  assert.match(content, /WHERE user_id = \? AND id = \?/);
});

test("R2 对象键由服务端用户 ID 和书籍 ID 共同派生", async () => {
  const storage = await read("../app/server/storage.ts");
  assert.match(storage, /users\/\$\{encodeKeyPart\(userId\)\}\/books\/\$\{encodeKeyPart\(bookId\)\}/);
  assert.doesNotMatch(storage, /fallback|localStorage|sessionStorage/i);
});
