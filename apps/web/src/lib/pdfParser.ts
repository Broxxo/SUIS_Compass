/**
 * PDF文件解析工具
 * 使用 pdfjs-dist 库提取PDF文本内容
 */

/**
 * 从PDF文件中提取文本内容
 * @param file PDF文件对象
 * @returns 提取的文本内容
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  try {
    // 动态导入 pdfjs-dist（避免在非PDF场景下加载）
    const pdfjsLib = await import('pdfjs-dist');
    
    // 设置worker路径（pdfjs-dist需要worker来处理PDF）
    // 使用CDN worker（最可靠的方式，无需配置本地文件）
    if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      // 使用CDN上的worker文件，版本与package.json中的pdfjs-dist版本保持一致
      // 注意：如果package.json中的版本更新，这里也需要同步更新
      const version = '4.10.38';
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`;
    }

    // 将文件转换为ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    // 加载PDF文档
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    // 提取所有页面的文本
    const textParts: string[] = [];
    
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      // 将文本项组合成字符串
      const pageText = textContent.items
        .map((item: any) => {
          // pdfjs返回的item可能是字符串或对象
          if (typeof item === 'string') {
            return item;
          }
          return item.str || '';
        })
        .join(' ');
      
      textParts.push(pageText);
    }
    
    // 合并所有页面的文本，用换行符分隔
    return textParts.join('\n\n');
  } catch (error) {
    console.error('PDF解析失败:', error);
    throw new Error(`无法解析PDF文件: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}
