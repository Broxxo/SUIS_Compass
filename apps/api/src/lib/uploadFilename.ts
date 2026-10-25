/**
 * 修复 multer/busboy 把 UTF-8 文件名按 Latin-1 解读后的乱码
 *（如「课程」→「è¯¾ç¨」）。
 * 若本已是正常 UTF-8，则保持不变。
 */
export function decodeUploadFilename(raw: string): string {
  const name = String(raw ?? '').trim();
  if (!name) return name;
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (fixed.includes('\uFFFD')) return name;
    if (fixed === name) return name;
    const hasCjk = (s: string) => /[\u4e00-\u9fff]/.test(s);
    // 原串无汉字、修复后有汉字 → 典型乱码
    if (!hasCjk(name) && hasCjk(fixed)) return fixed;
    // 原串含 Latin-1 高位字节特征、修复后更像合法文件名
    if (/[àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿÀ-ÿ]/.test(name) && !/[\u4e00-\u9fff\u3000-\u303f]/.test(name)) {
      return fixed;
    }
    return name;
  } catch {
    return name;
  }
}
