import type { VercelRequest, VercelResponse } from '@vercel/node';

// フロントエンドから送られてくるデータの型定義
interface PartyData {
  id: string;
  name: string;
  policyText: string;
}
interface Theme {
  key: string;
  label: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  // POSTリクエスト以外は受け付けない
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 環境変数からAPIキーを安全に取得
  const apiKey = process.env.GEMINI_API_KEY;
  // リクエストボディから、政党データと分析テーマのリストを取得
  const { parties, themes } = req.body as { parties: PartyData[], themes: Theme[] };

  // 入力データのバリデーション
  if (!parties || !themes) {
    return res.status(400).json({ error: '不正なリクエストです。' });
  }
  if (!apiKey) {
    return res.status(500).json({ error: 'APIキーがサーバー側で設定されていません。' });
  }

  // AIに渡すプロンプト（指示文）を動的に組み立てる
  const themeDescriptions = themes.map(t => `"${t.label}"`).join(', ');
  const themeKeys = themes.map(t => `"${t.key}": "ここに要約結果"`).join(',\n        ');

  const prompt = `
    以下のJSON形式の各政党の政策データを読み込んでください。
    \`\`\`json
    ${JSON.stringify(parties.map(p => ({ name: p.name, policy: p.policyText })))}
    \`\`\`

    上記のデータに基づき、以下の各テーマについて、それぞれの政党の主張の要点を100文字程度で簡潔にまとめてください。
    テーマリスト: ${themeDescriptions}

    最終的な出力は、必ず以下のJSON形式に従ってください。各政党ごとにオブジェクトを作成し、その中にテーマごとの要約を格納してください。
    
    **出力フォーマット:**
    \`\`\`json
    {
      "政党のID": {
        ${themeKeys}
      },
      "政党のID": {
        ...
      }
    }
    \`\`\`
  `;

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" }
  };

  try {
    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const data = await apiResponse.json();

    if (apiResponse.ok && data.candidates) {
      const summaryJsonString = data.candidates[0].content.parts[0].text;
      const summaryObject = JSON.parse(summaryJsonString);
      res.status(200).json({ analysis: summaryObject });
    } else {
      console.error('API Error:', data);
      res.status(apiResponse.status).json({ error: data.error?.message || 'AI APIからの応答エラーです。' });
    }
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ error: 'サーバーでエラーが発生しました。' });
  }
}
