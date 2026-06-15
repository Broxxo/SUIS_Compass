import { Button } from '../ui/button';

type ProgramDatabasePanelProps = {
  isZh: boolean;
  dbTables: Array<{ tableName: string; rowCount: number }>;
  dbSelectedTable: string;
  dbColumns: string[];
  dbRows: Array<Record<string, unknown>>;
  dbPrimaryKey: string | null;
  dbLimit: number;
  dbOffset: number;
  dbTotal: number;
  dbTableLoading: boolean;
  dbRowsLoading: boolean;
  onSelectTable: (tableName: string) => void;
  onLoadRows: (tableName: string, offset: number, limit: number) => void;
};

export default function ProgramDatabasePanel({
  isZh,
  dbTables,
  dbSelectedTable,
  dbColumns,
  dbRows,
  dbPrimaryKey,
  dbLimit,
  dbOffset,
  dbTotal,
  dbTableLoading,
  dbRowsLoading,
  onSelectTable,
  onLoadRows,
}: ProgramDatabasePanelProps) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        {isZh
          ? 'PostgreSQL 程序库只读浏览，不支持增删改。'
          : 'Read-only PostgreSQL browser. Create/update/delete are disabled.'}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
            {isZh ? '数据表与行数' : 'Tables and row counts'}
          </div>
          <div className="max-h-[420px] overflow-auto">
            {dbTableLoading ? (
              <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>
            ) : dbTables.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '未发现数据表。' : 'No tables found.'}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {dbTables.map((t) => (
                  <li key={t.tableName}>
                    <button
                      type="button"
                      className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 ${dbSelectedTable === t.tableName ? 'bg-slate-50' : ''}`}
                      onClick={() => onSelectTable(t.tableName)}
                    >
                      <div className="font-mono text-xs text-slate-800">{t.tableName}</div>
                      <div className="text-xs text-slate-500">
                        {isZh ? `行数：${t.rowCount}` : `Rows: ${t.rowCount}`}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="lg:col-span-8 border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-slate-600">
              {dbSelectedTable
                ? (
                  isZh
                    ? <>表：<span className="font-mono text-slate-800">{dbSelectedTable}</span>{dbPrimaryKey ? <>（主键：<span className="font-mono">{dbPrimaryKey}</span>）</> : ''}</>
                    : <>Table: <span className="font-mono text-slate-800">{dbSelectedTable}</span>{dbPrimaryKey ? <> (PK: <span className="font-mono">{dbPrimaryKey}</span>)</> : ''}</>
                )
                : (isZh ? '请选择左侧数据表' : 'Select a table on the left')}
            </div>
            {dbSelectedTable && (
              <div className="text-xs text-slate-500">
                {isZh ? `共 ${dbTotal} 行` : `Total ${dbTotal} rows`}
              </div>
            )}
          </div>
          <div className="max-h-[420px] overflow-auto">
            {dbRowsLoading ? (
              <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '加载中…' : 'Loading…'}</p>
            ) : !dbSelectedTable ? (
              <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '请先选择数据表。' : 'Please choose a table first.'}</p>
            ) : dbColumns.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-500">{isZh ? '该表无字段。' : 'This table has no columns.'}</p>
            ) : (
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    {dbColumns.map((col) => (
                      <th key={col} className="px-2 py-2 font-medium whitespace-nowrap">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dbRows.length === 0 ? (
                    <tr>
                      <td colSpan={dbColumns.length} className="px-2 py-6 text-center text-slate-500">
                        {isZh ? '暂无数据。' : 'No rows.'}
                      </td>
                    </tr>
                  ) : (
                    dbRows.map((row, idx) => (
                      <tr key={`${dbOffset + idx}`} className="border-b border-slate-100 align-top">
                        {dbColumns.map((col) => {
                          const value = row[col];
                          const display = value == null
                            ? 'NULL'
                            : typeof value === 'object'
                              ? JSON.stringify(value)
                              : String(value);
                          return (
                            <td key={`${idx}-${col}`} className="px-2 py-1.5 text-slate-700 max-w-[260px]">
                              <div className="truncate" title={display}>{display}</div>
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
          {dbSelectedTable && (
            <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
              <span className="text-slate-500">
                {isZh
                  ? `第 ${dbTotal === 0 ? 0 : dbOffset + 1} - ${Math.min(dbOffset + dbLimit, dbTotal)} 条`
                  : `${dbTotal === 0 ? 0 : dbOffset + 1}-${Math.min(dbOffset + dbLimit, dbTotal)}`}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={dbRowsLoading || dbOffset <= 0}
                  onClick={() => onLoadRows(dbSelectedTable, Math.max(0, dbOffset - dbLimit), dbLimit)}
                >
                  {isZh ? '上一页' : 'Prev'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={dbRowsLoading || dbOffset + dbLimit >= dbTotal}
                  onClick={() => onLoadRows(dbSelectedTable, dbOffset + dbLimit, dbLimit)}
                >
                  {isZh ? '下一页' : 'Next'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
