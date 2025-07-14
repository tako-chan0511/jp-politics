<template>
  <div id="app">
    <div class="summarizer-container">
      <div class="header">
        <!-- ★★★ 修正: SVGの構文エラーを修正 ★★★ -->
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="gemini-icon"><path d="M18 4h-2.5a2.5 2.5 0 0 0-5 0H8a4 4 0 0 0-4 4 4 4 0 0 0 4 4h2.5a2.5 2.5 0 0 1 5 0H16a4 4 0 0 1 4-4 4 4 0 0 1-4-4Z"/><path d="m6 16 6-6 6 6" /></svg>
        <h1>AI 文章要約アプリ</h1>
      </div>
      <p class="description">下のボックスに文章を貼り付けて、要約ボタンを押してください。<br>Gemini AIが、重要なポイントを3点にまとめて箇条書きで返します。</p>
      
      <textarea 
        v-model="inputText"
        placeholder="ここに要約したい文章を貼り付け..."
        rows="12"
        class="input-textarea"
      ></textarea>

      <button @click="summarizeText" :disabled="loading" class="summarize-button">
        <span v-if="!loading">この文章を要約する</span>
        <span v-else class="loading-state">
          <div class="loading-spinner-small"></div>
          要約中...
        </span>
      </button>

      <div v-if="error" class="error-message">
        <strong>エラー:</strong> {{ error }}
      </div>

      <div v-if="summaryText" class="summary-result">
        <h2>要約結果：</h2>
        <pre class="summary-pre">{{ summaryText }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const inputText = ref('');
const summaryText = ref('');
const loading = ref(false);
const error = ref('');

const summarizeText = async () => {
  if (!inputText.value.trim()) {
    error.value = '要約する文章を入力してください。';
    return;
  }

  loading.value = true;
  error.value = '';
  summaryText.value = '';

  try {
    // 自分たちのバックエンドAPI(/api/summarize)を呼び出す
    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textToSummarize: inputText.value }),
    });

    const data = await response.json();

    if (response.ok) {
      summaryText.value = data.summary;
    } else {
      error.value = data.error || '要約に失敗しました。';
    }
  } catch (e) {
    error.value = '通信エラーが発生しました。';
  } finally {
    loading.value = false;
  }
};
</script>

<style>
:root {
  --primary-color: #4285F4; /* Google Blue */
  --background-color: #f8f9fa;
  --card-background-color: #ffffff;
  --text-color: #202124;
  --sub-text-color: #5f6368;
  --border-color: #dadce0;
  --button-hover-color: #3367D6;
}

body {
  font-family: 'Google Sans', 'Helvetica Neue', Arial, sans-serif;
  margin: 0;
  background-color: var(--background-color);
  color: var(--text-color);
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}

#app {
  width: 100%;
  padding: 1rem;
}

.summarizer-container {
  max-width: 700px;
  margin: 2rem auto;
  padding: 2.5rem;
  background-color: var(--card-background-color);
  border-radius: 16px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.gemini-icon {
  color: var(--primary-color);
}

h1 {
  font-size: 2rem;
  font-weight: 500;
  color: var(--text-color);
  text-align: center;
}

.description {
  text-align: center;
  color: var(--sub-text-color);
  margin-bottom: 2rem;
  line-height: 1.6;
}

.input-textarea {
  width: 100%;
  padding: 1rem;
  font-size: 1rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-sizing: border-box;
  resize: vertical;
  margin-bottom: 1.5rem;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.input-textarea:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.2);
}

.summarize-button {
  width: 100%;
  padding: 1rem;
  font-size: 1.1rem;
  font-weight: 500;
  color: white;
  background-color: var(--primary-color);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
}

.summarize-button:hover:not(:disabled) {
  background-color: var(--button-hover-color);
}

.summarize-button:disabled {
  background-color: #a0c3ff;
  cursor: not-allowed;
}

.loading-state {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.loading-spinner-small {
  width: 20px;
  height: 20px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: #ffffff;
  animation: spin 1s ease infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-message {
  margin-top: 1.5rem;
  padding: 1rem;
  background-color: #fdeaed;
  color: #a50e0e;
  border: 1px solid #f4c7c7;
  border-radius: 8px;
}

.summary-result {
  margin-top: 2rem;
  padding: 1.5rem;
  background-color: #e8f0fe;
  border: 1px solid #d2e3fc;
  border-radius: 8px;
}

.summary-result h2 {
  margin-top: 0;
  color: #1967d2;
}

.summary-pre {
  white-space: pre-wrap; /* テキストを折り返す */
  word-wrap: break-word;
  font-family: 'Roboto Mono', monospace;
  line-height: 1.7;
  color: var(--text-color);
}
</style>
