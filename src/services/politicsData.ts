// アプリケーション全体で使う「政党」の型定義
export interface Party {
  id: string; // 内部的な識別子
  name: string; // 表示名
  shugiinSeats: number | string; // 衆議院議席数
  sangiinSeats: number | string; // 参議院議席数
  policyUrl: string; 
  analysisResult: Record<string, string>; // AIによる分析結果を格納するオブジェクト
}

// 比較表の「列」の型定義
export interface Column {
  key: string; // データと紐付けるためのキー
  label: string; // ヘッダーに表示する名前
  isTheme: boolean; // この列がAIの分析テーマであるかを示すフラグ
}

// ★★★ 変更: 「参政党」を追加 ★★★
export const initialPartyData: Omit<Party, 'analysisResult'>[] = [
  { id: 'ldp', name: '自由民主党', shugiinSeats: 261, sangiinSeats: 119, policyUrl: 'https://www.jimin.jp/policy/' },
  { id: 'cdp', name: '立憲民主党', shugiinSeats: 99, sangiinSeats: 39, policyUrl: 'https://cdp-japan.jp/visions/policies2024/' },
  { id: 'jip', name: '日本維新の会', shugiinSeats: 41, sangiinSeats: 21, policyUrl: 'https://o-ishin.jp/policy/' },
  { id: 'komei', name: '公明党', shugiinSeats: 32, sangiinSeats: 27, policyUrl: 'https://www.komei.or.jp/policy/' },
  { id: 'dpp', name: '国民民主党', shugiinSeats: 10, sangiinSeats: 10, policyUrl: 'https://new-kokumin.jp/policies' },
  { id: 'jcp', name: '日本共産党', shugiinSeats: 10, sangiinSeats: 11, policyUrl: 'https://www.jcp.or.jp/web_policy/' },
  { id: 'reiwa', name: 'れいわ新選組', shugiinSeats: 3, sangiinSeats: 5, policyUrl: 'https://reiwa-shinsengumi.com/policy/' },
  { id: 'sdp', name: '社会民主党', shugiinSeats: 1, sangiinSeats: 1, policyUrl: 'https://sdp.or.jp/information/priority-policy-2022/' },
  { id: 'sansei', name: '参政党', shugiinSeats: 0, sangiinSeats: 1, policyUrl: 'https://www.sanseito.jp/policy/' },
  { id: 'saisei', name: '再生の道', shugiinSeats: 'ー', sangiinSeats: 'ー', policyUrl: 'https://ishimaru-shinji.com/#policy' },
];

// 比較表の列の定義は変更ありません
export const comparisonColumns: Column[] = [
  { key: 'partyName', label: '政党名', isTheme: false },
  { key: 'shugiinSeats', label: '衆議院議席数', isTheme: false },
  { key: 'sangiinSeats', label: '参議院議席数', isTheme: false },
  { key: 'economic', label: '物価高・経済対策', isTheme: true },
  { key: 'childcare', label: '少子化対策・子育て支援', isTheme: true },
  { key: 'security', label: '外交・安全保障', isTheme: true },
  { key: 'energy', label: 'エネルギー政策・GX', isTheme: true },
  { key: 'constitution', label: '憲法改正', isTheme: true },
  { key: 'mainFocus', label: 'その他（政党の目標）', isTheme: true },
];
