import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';
// import { kv } from '@vercel/kv';  <-- これを削除し、以下に変更
import { createClient } from '@vercel/kv';

// 明示的にクライアントを作成する
const kv = createClient({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

// --- 型定義 ---
interface PartyData {
  id: string;
  name: string;
  policyUrl: string;
}
interface Theme {
  key: string;
  label: string;
}
interface AnalysisResult {
  [partyId: string]: {
    [themeKey: string]: string;
  };
}
interface FreeformAnswer {
  question: string;
  answer: string;
}


// --- メインのハンドラ関数 ---
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const { parties, themes, freeformQuestion } = req.body as { parties: PartyData[], themes: Theme[], freeformQuestion?: string };

  if (!parties || !themes) {
    return res.status(400).json({ error: '不正なリクエストです。' });
  }
  if (!apiKey) {
    return res.status(500).json({ error: 'APIキーがサーバー側で設定されていません。' });
  }

  try {
    const cacheKey = parties.map(p => p.policyUrl).sort().join('|') + `::${freeformQuestion || ''}`;
    const cachedData = await kv.get<{ analysis: AnalysisResult, freeformAnswer?: FreeformAnswer }>(cacheKey);

    if (cachedData) {
      console.log(`Cache hit for key: ${cacheKey}`);
      return res.status(200).json({ ...cachedData, fromCache: true });
    }
    
    console.log(`Cache miss for key: ${cacheKey}. Fetching new data.`);

    const scrapedPolicies = await Promise.all(
      parties.map(party => scrapeTextFromUrl(party))
    );
    
    const successfulScrapes = scrapedPolicies.filter(p => p.policyText && !p.policyText.startsWith('（このURLからの情報取得に失敗しました'));
    const failedScrapes = scrapedPolicies.filter(p => p.policyText.startsWith('（このURLからの情報取得に失敗しました'));

    if (successfulScrapes.length === 0) {
      throw new Error("すべてのURLから政策情報を取得できませんでした。");
    }

    // ★★★ ここからが変更点 ★★★
    // 1. analysis変数をAnalysisResult型で明確に初期化
    const analysis: AnalysisResult = {};

    const [themeAnalysis, freeformAnswer] = await Promise.all([
      themes.length > 0 ? getAnalysisFromAI(successfulScrapes, themes, apiKey) : Promise.resolve({}),
      freeformQuestion ? getFreeformAnswerFromAI(successfulScrapes, freeformQuestion, apiKey) : Promise.resolve(undefined)
    ]);

    // 2. AIからの分析結果をマージ
    Object.assign(analysis, themeAnalysis);
    // ★★★ ここまでが変更点 ★★★

    // この処理がエラーなく実行できるようになる
    failedScrapes.forEach(failedParty => {
      const errorResult: { [key: string]: string } = {};
      themes.forEach(theme => {
        errorResult[theme.key] = "情報取得失敗";
      });
      analysis[failedParty.id] = errorResult;
    });

    const resultData = { analysis, freeformAnswer };
    await kv.set(cacheKey, resultData, { ex: 86400 });
    console.log(`New data saved to cache with key: ${cacheKey}`);

    res.status(200).json({ ...resultData, fromCache: false });

  } catch (error: any) {
    console.error('An error occurred in the handler:', error);
    res.status(500).json({ error: error.message || 'サーバーでエラーが発生しました。' });
  }
}


// --- ヘルパー関数 ---
async function scrapeTextFromUrl(party: PartyData): Promise<PartyData & { policyText: string }> {
  if (!party.policyUrl) {
    return { ...party, policyText: "（URLが指定されていません）" };
  }
  try {
    const response = await fetch(party.policyUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`Failed to fetch URL with status: ${response.status}`);
    const html = await response.text();
    const $ = cheerio.load(html);
    $('script, style, nav, header, footer, aside, form, iframe').remove();
    const text = $('body').text().replace(/\s\s+/g, ' ').trim();
    return { ...party, policyText: text.substring(0, 15000) };
  } catch (error) {
    console.error(`Error scraping ${party.policyUrl}:`, error);
    return { ...party, policyText: `（このURLからの情報取得に失敗しました: ${error}）` };
  }
}

async function getAnalysisFromAI(policies: any[], themes: Theme[], apiKey: string): Promise<AnalysisResult> {
  if (themes.length === 0) return {};
  const themeDescriptions = themes.map(t => `"${t.label}"`).join(', ');
  const themeKeys = themes.map(t => `"${t.key}": "ここに要約結果"`).join(',\n        ');
  const prompt = `
    以下のJSON形式の各政党の政策データを読み込み、指定された各テーマについて、それぞれの政党の主張の要点を100文字程度で簡潔にまとめてください。
    テーマリスト: ${themeDescriptions}
    \`\`\`json
    ${JSON.stringify(policies.map(p => ({ id: p.id, name: p.name, policy: p.policyText })))}
    \`\`\`
    最終的な出力は、必ず以下のJSON形式に従ってください。
    **出力フォーマット:**
    \`\`\`json
    { "政党のID": { ${themeKeys} }, "政党のID": { ... } }
    \`\`\`
  `;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const requestBody = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } };
  const apiResponse = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
  const data = await apiResponse.json();
  if (apiResponse.ok && data.candidates) {
    return JSON.parse(data.candidates[0].content.parts[0].text);
  } else {
    throw new Error(data.error?.message || 'AI APIからのテーマ別要約エラーです。');
  }
}

async function getFreeformAnswerFromAI(policies: any[], question: string, apiKey: string): Promise<FreeformAnswer> {
  const prompt = `
    あなたは、鋭い洞察力と大胆な予測で知られる、経験豊富な政治経済アナリストです。
    提供された各政党の政策データと、あなたが持つ日本の政治経済に関する広範な知識を基に、ユーザーからの以下の質問に対して、プロフェッショナルとして掘り下げた分析を提供してください。

    【提供された政策データ】
    \`\`\`json
    ${JSON.stringify(policies.map(p => ({ name: p.name, policy: p.policyText })))}
    \`\`\`

    【ユーザーからの質問】
    「${question}」

    【回答の指示】
    1.  **事実に基づく要約**: まず、提供された政策データから、質問に直接関連する各党の主張を客観的に要約してください。
    2.  **アナリストの洞察**: 次に、あなたの専門的な知見から、それらの政策の背景にある政治的・経済的な狙いや、各党の戦略について深く分析してください。字面通りの解釈に留まらず、行間を読んでください。
    3.  **今後の展望とリスク**: 最後に、それらの政策が実行された場合に考えられる社会への影響、経済的な帰結、そして潜在的なリスクやチャンスについて、大胆な推察を含めて論じてください。
    4.  **書式**:
        * 回答は、上記1, 2, 3の構成がわかるように、Markdownの見出し（例: \`### 事実の要約\`）を使って読みやすくまとめてください。
        * 特に重要だと考えるキーワードや政策名は、必ず \`<strong>キーワード</strong>\` のようにHTMLのstrongタグで囲んで強調してください。
  `;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const requestBody = { contents: [{ parts: [{ text: prompt }] }] };
  const apiResponse = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
  const data = await apiResponse.json();
  if (apiResponse.ok && data.candidates) {
    return {
      question: question,
      answer: data.candidates[0].content.parts[0].text
    };
  } else {
    throw new Error(data.error?.message || 'AI APIからの自由回答エラーです。');
  }
}
