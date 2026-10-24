type PersonLike = { id: string };

export default function MultiSelectPersonGrid<T extends PersonLike>({
  people,
  selectedIds,
  onToggle,
  getLabel,
  emptyLabel,
}: {
  people: T[];
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
  getLabel: (person: T) => string;
  emptyLabel?: string;
}) {
  if (people.length === 0) {
    return <p className="text-xs text-slate-500">{emptyLabel ?? '—'}</p>;
  }
  return (
    <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 p-2">
      <div className="grid grid-cols-3 gap-1.5">
        {people.map((person) => {
          const checked = selectedIds.includes(person.id);
          return (
            <label
              key={person.id}
              className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 rounded border-slate-300"
                checked={checked}
                onChange={() => onToggle(person.id)}
              />
              <span className="min-w-0 truncate">{getLabel(person)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
