// 介面文字：取 public/_locales 裡的翻譯（預設英文，繁中瀏覽器顯示中文）。
export type MsgKey =
  | 'newBranch'
  | 'untitled'
  | 'mapLabel'
  | 'collapseNode'
  | 'expandNode'
  | 'hideMap'
  | 'showMap'
  | 'optionsTitle'
  | 'optionsStored'
  | 'optionsDelete'
  | 'clearButton'
  | 'clearConfirm'
  | 'cleared'
  | 'clearFailed';

export function t(key: MsgKey, sub?: string): string {
  try {
    return chrome.i18n.getMessage(key, sub) || key;
  } catch {
    return key; // 外掛已失效時 chrome API 可能拋錯
  }
}
