import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const { textToSummarize } = req.body;

  if (!textToSummarize) {
    return res.status(400).json({ error: '要約するテキストがありません。' });
  }
  if (!apiKey) {
    return res.status(500).json({ error: 'APIキーがサーバー側で設定されていません。' });
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [{
      parts: [{
        text: `以下の文章を、重要なポイントを3点に絞って箇条書きで要約してください。\n\n---\n${textToSummarize}`
      }]
    }]
  };

  try {
    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const data = await apiResponse.json();

    if (apiResponse.ok && data.candidates) {
      const summary = data.candidates[0].content.parts[0].text;
      res.status(200).json({ summary });
    } else {
      console.error('API Error:', data);
      
      // ★★★ エラーメッセージを分かりやすくする改善 ★★★
      let userFriendlyError = 'AI APIからの応答エラーです。';
      const errorMessage = data.error?.message || '';

      if (errorMessage.includes('overloaded')) {
        userFriendlyError = '現在、AIモデルが大変混み合っています。しばらく時間をおいてから、もう一度お試しください。';
      } else if (errorMessage) {
        userFriendlyError = errorMessage;
      }
      
      res.status(apiResponse.status).json({ error: userFriendlyError });
    }
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ error: 'サーバーでエラーが発生しました。' });
  }
}
