import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';
import { kv } from '@vercel/kv';

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
// ★★★ 追加: フリーフォーマット質問の回答の型 ★★★
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
  // ★★★ 変更: freeformQuestionも受け取る ★★★
  const { parties, themes, freeformQuestion } = req.body as { parties: PartyData[], themes: Theme[], freeformQuestion?: string };

  if (!parties || !themes) {
    return res.status(400).json({ error: '不正なリクエストです。' });
  }
  if (!apiKey) {
    return res.status(500).json({ error: 'APIキーがサーバー側で設定されていません。' });
  }

  try {
    // ★★★ 変更: キャッシュキーに質問内容も加える ★★★
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

    // ★★★ 変更: AIへのリクエストを並行して実行 ★★★
    const [analysis, freeformAnswer] = await Promise.all([
      getAnalysisFromAI(successfulScrapes, themes, apiKey),
      freeformQuestion ? getFreeformAnswerFromAI(successfulScrapes, freeformQuestion, apiKey) : Promise.resolve(undefined)
    ]);

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
  // (この関数は変更なし)
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
  // (この関数は変更なし、ただしプロンプトを少し調整)
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
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
  const requestBody = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } };
  const apiResponse = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
  const data = await apiResponse.json();
  if (apiResponse.ok && data.candidates) {
    return JSON.parse(data.candidates[0].content.parts[0].text);
  } else {
    throw new Error(data.error?.message || 'AI APIからのテーマ別要約エラーです。');
  }
}

// ★★★ 追加: フリーフォーマット質問に回答するAI関数 ★★★
async function getFreeformAnswerFromAI(policies: any[], question: string, apiKey: string): Promise<FreeformAnswer> {
  const prompt = `
    あなたは中立的な政策アナリストです。以下の政策データを基に、ユーザーからの質問に客観的に回答してください。
    \`\`\`json
    ${JSON.stringify(policies.map(p => ({ name: p.name, policy: p.policyText })))}
    \`\`\`
    **ユーザーからの質問:**
    「${question}」

    **回答の指示:**
    - 必ず提供された政策データのみを根拠としてください。
    - どの政党がどのような主張をしているか、比較しながら具体的に記述してください。
    - あなた自身の意見や、外部の知識は含めないでください。
  `;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
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
