import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';

// --- 型定義 ---
interface PartyData {
  id: string;
  name: string;
  policyUrl: string; // フロントエンドからはURLが送られてくる
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
    // Step 1: 各政党のURLから政策テキストを並行してスクレイピング
    const scrapedPolicies = await Promise.all(
      parties.map(party => scrapeTextFromUrl(party))
    );

    // Step 2: スクレイピングに成功したデータだけで分析を続行
    const successfulScrapes = scrapedPolicies.filter(p => p.policyText && !p.policyText.startsWith('（このURLからの情報取得に失敗しました'));

    if (successfulScrapes.length === 0) {
      throw new Error("すべてのURLから政策情報を取得できませんでした。URLを確認してください。");
    }

    // Step 3: 成功したテキストをAIに渡して分析
    const analysis = await getAnalysisFromAI(successfulScrapes, themes, apiKey);

    // Step 4: 失敗したデータの分析結果をマージする
    const failedScrapes = scrapedPolicies.filter(p => p.policyText.startsWith('（このURLからの情報取得に失敗しました'));
    failedScrapes.forEach(failedParty => {
      const errorResult: { [key: string]: string } = {};
      themes.forEach(theme => {
        // 失敗した際のメッセージを定義
        errorResult[theme.key] = "情報取得失敗";
      });
      analysis[failedParty.id] = errorResult;
    });

    // Step 5: 最終的な分析結果をフロントエンドに返す
    res.status(200).json({ analysis });

  } catch (error: any) {
    console.error('An error occurred in the handler:', error);
    res.status(500).json({ error: error.message || 'サーバーでエラーが発生しました。' });
  }
}


// --- ヘルパー関数 ---

/**
 * 指定されたURLからWebページの本文テキストを抽出する
 * @param party - 対象の政党データ
 * @returns スクレイピング結果を含むオブジェクト
 */
async function scrapeTextFromUrl(party: PartyData): Promise<PartyData & { policyText: string }> {
  if (!party.policyUrl) {
    return { ...party, policyText: "（URLが指定されていません）" };
  }
  try {
    console.log(`Scraping text from: ${party.policyUrl}`);
    const response = await fetch(party.policyUrl, { 
      headers: { 
        // 一部のサーバーは、ブラウザからのアクセスでないと拒否するためUser-Agentを設定
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' 
      } 
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch URL with status: ${response.status}`);
    }
    const html = await response.text();
    const $ = cheerio.load(html);

    // 不要な要素を削除
    $('script, style, nav, header, footer, aside, form, iframe').remove();
    
    // bodyタグ内のテキストを取得し、余分な空白を整理
    const text = $('body').text().replace(/\s\s+/g, ' ').trim();
    
    console.log(`Scraping successful for ${party.name}, text length: ${text.length}`);
    // テキストが長すぎるとAI APIの上限に達するため、上限を設定
    return { ...party, policyText: text.substring(0, 15000) }; 
  } catch (error) {
    console.error(`Error scraping ${party.policyUrl}:`, error);
    return { ...party, policyText: `（このURLからの情報取得に失敗しました: ${error}）` };
  }
}

/**
 * 抽出したテキストをGemini APIに渡し、分析結果を取得する
 * @param policies - スクレイピング後の政策データ
 * @param themes - 分析テーマのリスト
 * @param apiKey - Gemini APIキー
 * @returns AIによる分析結果
 */
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

    最終的な出力は、必ず以下のJSON形式に従ってください。各政党ごとに、その政党の 'id' をキーとしたオブジェクトを作成し、その中にテーマごとの要約を格納してください。
    
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
