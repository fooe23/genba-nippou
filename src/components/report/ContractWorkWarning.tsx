// 作業員の人工に対して契約内の作業内容が無いときの知らせ（contractWorkWarning の文言）。保存は止めない。
// box：作業内容の表の上に出す目立つ枠。compact：保存ボタンのすぐ上（下の帯）に出す小さめの枠。line：本日の集計の上に出す 1 行。

const BOX =
  'flex items-start gap-2 rounded-lg border-2 border-amber-600 bg-amber-100 font-bold text-amber-950 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-50';

export function ContractWorkWarning({ message, variant = 'box', className = '' }: { message: string | null; variant?: 'box' | 'compact' | 'line'; className?: string }) {
  if (!message) return null;
  if (variant === 'line') {
    return (
      <p role="note" className={`flex items-start gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-300 ${className}`}>
        <span aria-hidden="true">⚠</span>
        <span>{message}</span>
      </p>
    );
  }
  return (
    <div role="alert" className={`${BOX} ${variant === 'compact' ? 'p-2 text-sm' : 'p-3 text-base'} ${className}`}>
      <span aria-hidden="true" className="text-xl leading-6">
        ⚠
      </span>
      <p className="min-w-0">{message}</p>
    </div>
  );
}
