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

// --- メインのハンドラ関数 ---
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  console.log('[HANDLER] Function execution started.'); // ★★★ ログ1 ★★★

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const { parties, themes } = req.body as { parties: PartyData[], themes: Theme[] };

  if (!parties || !themes) {
    return res.status(400).json({ error: '不正なリクエストです。' });
  }
  if (!apiKey) {
    return res.status(500).json({ error: 'APIキーがサーバー側で設定されていません。' });
  }

  try {
    const cacheKey = parties.map(p => p.policyUrl).sort().join('|');
    const cachedAnalysis = await kv.get<AnalysisResult>(cacheKey);

    if (cachedAnalysis) {
      console.log(`[HANDLER] Cache hit for key: ${cacheKey}`);
      return res.status(200).json({ analysis: cachedAnalysis, fromCache: true });
    }
    
    console.log(`[HANDLER] Cache miss. Starting scraping...`); // ★★★ ログ2 ★★★

    const scrapedPolicies = await Promise.all(
      parties.map(party => scrapeTextFromUrl(party))
    );
    
    console.log('[HANDLER] Scraping finished.'); // ★★★ ログ3 ★★★

    const successfulScrapes = scrapedPolicies.filter(p => p.policyText && !p.policyText.startsWith('（このURLからの情報取得に失敗しました'));
    const failedScrapes = scrapedPolicies.filter(p => p.policyText.startsWith('（このURLからの情報取得に失敗しました'));

    if (successfulScrapes.length === 0) {
      throw new Error("すべてのURLから政策情報を取得できませんでした。");
    }

    console.log(`[HANDLER] Preparing to call AI for ${successfulScrapes.length} parties.`); // ★★★ ログ4 ★★★
    let analysis: AnalysisResult = {};
    if (successfulScrapes.length > 0) {
      analysis = await getAnalysisFromAI(successfulScrapes, themes, apiKey);
    }
    console.log('[HANDLER] AI analysis finished.'); // ★★★ ログ5 ★★★

    failedScrapes.forEach(failedParty => {
      const errorResult: { [key: string]: string } = {};
      themes.forEach(theme => {
        errorResult[theme.key] = "情報取得失敗";
      });
      analysis[failedParty.id] = errorResult;
    });

    await kv.set(cacheKey, analysis, { ex: 86400 });
    console.log(`[HANDLER] New data saved to cache.`); // ★★★ ログ6 ★★★

    res.status(200).json({ analysis, fromCache: false });

  } catch (error: any) {
    console.error('[HANDLER] An error occurred:', error);
    res.status(500).json({ error: error.message || 'サーバーでエラーが発生しました。' });
  }
}


// --- ヘルパー関数 (変更なし) ---
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
  const themeDescriptions = themes.map(t => `"${t.label}"`).join(', ');
  const themeKeys = themes.map(t => `"${t.key}": "ここに要約結果"`).join(',\n        ');
  const prompt = `
    以下のJSON形式の各政党の政策データを読み込んでください。
    \`\`\`json
    ${JSON.stringify(policies.map(p => ({ id: p.id, name: p.name, policy: p.policyText })))}
    \`\`\`
    上記のデータに基づき、以下の各テーマについて、それぞれの政党の主張の要点を100文字程度で簡潔にまとめてください。
    テーマリスト: ${themeDescriptions}
    最終的な出力は、必ず以下のJSON形式に従ってください。
    **出力フォーマット:**
    \`\`\`json
    {
      "政党のID": {
        ${themeKeys}
      },
      "政党のID": { ... }
    }
    \`\`\`
  `;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" }
  };
  const apiResponse = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  const data = await apiResponse.json();
  if (apiResponse.ok && data.candidates) {
    const summaryJsonString = data.candidates[0].content.parts[0].text;
    return JSON.parse(summaryJsonString);
  } else {
    console.error('API Error:', data);
    throw new Error(data.error?.message || 'AI APIからの応答エラーです。');
  }
}
