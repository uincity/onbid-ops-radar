"use client";
// 사유 입력칸: 라벨 + 글자 수 안내(공백 제외, 실시간) 한 묶음. 부모가 값을 들고 있어 버튼 비활성 판단에 쓴다.
import { REASON_MAX_LENGTH, REASON_MIN_LENGTH, countReasonChars } from "@/lib/anomalies/reason-length";

type Props = { id: string; name: string; label: string; hint: string; value: string; onChange: (v: string) => void; disabled: boolean };

export function ReasonField({ id, name, label, hint, value, onChange, disabled }: Props) {
  const count = countReasonChars(value);
  const enough = count >= REASON_MIN_LENGTH;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={3}
        maxLength={REASON_MAX_LENGTH}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-count`}
        className="w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
      />
      <p id={`${id}-count`} className={`text-xs ${enough ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-600 dark:text-zinc-400"}`}>
        {hint} 현재 {count}자 / {REASON_MIN_LENGTH}자 이상 (공백 제외){enough ? " - 충분합니다" : ""}
      </p>
    </div>
  );
}
