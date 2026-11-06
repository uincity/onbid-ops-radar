"use client";
// 층별 결과 제목 옆 "?" 버튼: 누르면 5개 층 설명 문서(/help/web-layers.html)를 팝업(대화상자)으로 보여 준다.
// 문서는 로그인한 사용자만 열 수 있다(proxy가 막음). 팝업은 Esc·닫기 버튼·바깥 클릭으로 닫힌다. 읽기만 하고 아무것도 저장하지 않는다.
import { useRef } from "react";

export function LayersHelp() {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-label="층별 결과 설명 보기"
        aria-haspopup="dialog"
        title="층별 결과가 무슨 뜻인지 쉬운 말로 보기"
        data-testid="web-layers-help-open"
        className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-400 text-xs font-bold text-zinc-700 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-500 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        ?
      </button>
      <dialog
        ref={ref}
        aria-labelledby="web-layers-help-title"
        data-testid="web-layers-help-dialog"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close(); // 바깥(어두운 배경)을 누르면 닫는다
        }}
        className="m-auto h-[85vh] w-[min(920px,94vw)] rounded-xl border border-zinc-300 bg-white p-0 shadow-xl backdrop:bg-black/50 dark:border-zinc-700 dark:bg-zinc-950"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
            <h2 id="web-layers-help-title" className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              층별 결과 설명
            </h2>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              data-testid="web-layers-help-close"
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              닫기
            </button>
          </div>
          {/* 열릴 때만 불러오지 않고 주소만 지정한다: 닫혀 있으면 브라우저가 그리지 않는다 */}
          <iframe src="/help/web-layers.html" title="층별 결과 설명" loading="lazy" className="w-full flex-1 rounded-b-xl" />
        </div>
      </dialog>
    </>
  );
}
