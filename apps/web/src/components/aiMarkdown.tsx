import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const aiRemarkPlugins = [remarkGfm];

export const aiMarkdownComponents: Components = {
  p: ({ children }) => <p className="mb-1 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="text-base font-semibold mb-2 mt-3 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-semibold mb-1.5 mt-2 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-medium mb-1 mt-2 first:mt-0">{children}</h3>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  table: ({ children }) => (
    <div className="overflow-x-auto my-2 max-w-full">
      <table className="w-full text-xs border-collapse border border-slate-200">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-50">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-slate-200 last:border-b-0">{children}</tr>,
  th: ({ children }) => (
    <th className="border border-slate-200 px-2 py-1.5 text-left font-semibold text-slate-700 whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-slate-200 px-2 py-1.5 text-slate-800 align-top">{children}</td>
  ),
};
