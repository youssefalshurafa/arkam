export function SkBar({ w = 'w-1/2', h = 'h-3.5' }: { w?: string; h?: string }) {
 return <div className={`${h} ${w} animate-pulse rounded bg-slate-200`} />;
}

export function SkTableRows({ cols, rows = 7 }: { cols: string[]; rows?: number }) {
 return (
  <>
   {Array.from({ length: rows }, (_, i) => (
    <tr
     key={i}
     className="border-t border-slate-100"
    >
     {cols.map((w, j) => (
      <td
       key={j}
       className="px-4 py-3"
      >
       <SkBar w={w} />
      </td>
     ))}
    </tr>
   ))}
  </>
 );
}

export function SkTablePanel({
 panelClassName,
 tableWrapClassName,
 titleWidth = 'w-44',
 cols,
 rows = 7,
}: {
 panelClassName: string;
 tableWrapClassName: string;
 titleWidth?: string;
 cols: string[];
 rows?: number;
}) {
 return (
  <div className={panelClassName}>
   <div className="mb-4 flex items-center justify-between gap-4">
    <SkBar
     w={titleWidth}
     h="h-6"
    />
    <div className="flex gap-2">
     <SkBar
      w="w-8"
      h="h-8"
     />
     <SkBar
      w="w-8"
      h="h-8"
     />
    </div>
   </div>
   <div className={tableWrapClassName}>
    <table className="w-full text-sm">
     <thead className="bg-slate-50">
      <tr>
       {cols.map((_, i) => (
        <th
         key={i}
         className="px-4 py-3"
        >
         <SkBar
          w="w-12"
          h="h-3"
         />
        </th>
       ))}
      </tr>
     </thead>
     <tbody>
      <SkTableRows
       cols={cols}
       rows={rows}
      />
     </tbody>
    </table>
   </div>
  </div>
 );
}

export const SK_TX = ['w-24', 'w-28', 'w-28', 'w-20', 'w-14', 'w-14', 'w-20', 'w-24', 'w-8'];
export const SK_LEDGER = ['w-20', 'w-28', 'w-14', 'w-14', 'w-20', 'w-16', 'w-16', 'w-20', 'w-8'];
export const SK_CLIENTS = ['w-36', 'w-28', 'w-20', 'w-8'];
export const SK_ORGS = ['w-40', 'w-16', 'w-8'];
export const SK_CURRENCIES = ['w-12', 'w-40', 'w-10', 'w-16', 'w-8'];
