// Design Ref: docs/design-homepage-monitoring.md §4.2 / Plan W13 — 읽은 값에서 홈페이지 경고 띠 목록 만들기 (순수 함수, 시험 가능)
import { evaluateNotifyBanner, evaluateStaleBanner, groupNotifications, offBanner, type WebBanner } from "./view";
import type { WebBannerInputs } from "./view-source";

/** 읽은 값에서 띠 목록을 만든다(순수). includeOff: `/web` 화면에서만 "점검 꺼짐" 안내를 함께 보인다 */
export function bannersFrom(input: WebBannerInputs, now: Date, includeOff: boolean): WebBanner[] {
  const banners: WebBanner[] = [];
  if (!input.settings.ok) return banners;
  const { enabled, enabledSince, staleMin } = input.settings.data;
  if (!enabled) return includeOff ? [offBanner()] : []; // 꺼져 있으면 정지 띠는 띄우지 않는다
  if (input.lastGoodFinishedAt.ok) {
    const stale = evaluateStaleBanner({ now, enabled, lastGoodFinishedAt: input.lastGoodFinishedAt.data, enabledSince, staleMin });
    if (stale) banners.push(stale);
  }
  if (input.notifications.ok) {
    const notify = evaluateNotifyBanner(groupNotifications(input.notifications.data, now), now);
    if (notify) banners.push(notify);
  }
  return banners;
}
