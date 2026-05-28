/**
 * 学业报告 PDF（html2canvas）：在克隆文档中注入样式，减轻中文字体在表格/框体里「贴底」的观感。
 * 教师工作台导出、学生端导出共用；页面内需在要截图的根节点上挂 `data-academic-report-pdf-scope`。
 */

export const ACADEMIC_REPORT_PDF_CLONE_STYLE_ID = 'academic-report-pdf-export-fix';

export function ensureAcademicReportPdfCloneStyles(clonedDoc: Document): void {
  if (clonedDoc.getElementById(ACADEMIC_REPORT_PDF_CLONE_STYLE_ID)) return;
  const style = clonedDoc.createElement('style');
  style.id = ACADEMIC_REPORT_PDF_CLONE_STYLE_ID;
  style.textContent = `
    [data-academic-report-pdf-scope] table { border-collapse: collapse !important; }
    [data-academic-report-pdf-scope] td,
    [data-academic-report-pdf-scope] th {
      vertical-align: middle !important;
      padding: 0 !important;
    }
    [data-academic-report-pdf-scope] td > div,
    [data-academic-report-pdf-scope] th > div {
      display: flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
      box-sizing: border-box !important;
      width: 100% !important;
      min-height: 1.8rem !important;
      padding: 4px 7px !important;
      margin: 0 !important;
      line-height: 1.22 !important;
      transform: translateY(-0.16em) !important;
    }
    [data-academic-report-pdf-scope] th > div {
      min-height: 1.9rem !important;
      font-weight: 600 !important;
      font-size: 11px !important;
    }
    [data-student-report-pdf-module] td:last-child > div {
      justify-content: center !important;
    }
    [data-academic-report-pdf-scope] [data-student-report-pdf-body-text] {
      display: flex !important;
      align-items: center !important;
      box-sizing: border-box !important;
      width: 100% !important;
      min-height: 2.025rem !important;
      margin: 0 !important;
      line-height: 1.28 !important;
      transform: translateY(-0.14em) !important;
    }
  `;
  (clonedDoc.head ?? clonedDoc.documentElement).appendChild(style);
}

/** html2canvas onclone：注入样式并强制布局一次。 */
export function applyAcademicReportPdfReflow(cloneRoot: HTMLElement): void {
  const clonedDoc = cloneRoot.ownerDocument;
  if (!clonedDoc) return;
  ensureAcademicReportPdfCloneStyles(clonedDoc);
  void cloneRoot.offsetHeight;
}
