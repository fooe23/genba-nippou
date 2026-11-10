// 作業員と作業内容の知らせ（workWarnings の文言：契約内の作業内容が無い・人工のずれ。当てはまるものを全部）。保存は止めない。
// box：作業内容の表の上に出す目立つ枠。compact：保存ボタンのすぐ上（下の帯）に出す小さめの枠。line：本日の集計の上に出す 1 行。

const BOX =
  'flex items-start gap-2 rounded-lg border-2 border-amber-600 bg-amber-100 font-bold text-amber-950 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-50';

export function ContractWorkWarning({
  messages,
  variant = 'box',
  className = '',
}: {
  messages: readonly string[];
  variant?: 'box' | 'compact' | 'line';
  className?: string;
}) {
  if (messages.length === 0) return null;
  if (variant === 'line') {
    return (
      <div role="note" className={`space-y-1 text-sm font-bold text-amber-800 dark:text-amber-300 ${className}`}>
        {messages.map((m) => (
          <p key={m} className="flex items-start gap-1.5">
            <span aria-hidden="true">⚠</span>
            <span>{m}</span>
          </p>
        ))}
      </div>
    );
  }
  return (
    <div role="alert" className={`${BOX} ${variant === 'compact' ? 'p-2 text-sm' : 'p-3 text-base'} ${className}`}>
      <span aria-hidden="true" className="text-xl leading-6">
        ⚠
      </span>
      <div className="min-w-0 space-y-1">
        {messages.map((m) => (
          <p key={m}>{m}</p>
        ))}
      </div>
    </div>
  );
}
