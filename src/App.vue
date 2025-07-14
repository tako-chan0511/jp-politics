<template>
  <div id="app">
    <div class="politics-container">
      <div class="header">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="gemini-icon"><path d="M18 4h-2.5a2.5 2.5 0 0 0-5 0H8a4 4 0 0 0-4 4 4 4 0 0 0 4 4h2.5a2.5 2.5 0 0 1 5 0H16a4 4 0 0 1 4-4 4 4 0 0 1-4-4Z"/><path d="m6 16 6-6 6 6" /></svg>
        <h1>AI 政策比較アプリ</h1>
      </div>
      <p class="description">
        各政党の政策が書かれたページのURLを入力し、「テーマ別比較」ボタンを押してください。<br>
        AIがWebページの内容を読み取り、下の表の各項目について要約・比較します。
      </p>

      <div class="input-section">
        <h2>政策URL入力</h2>
        <div class="input-grid">
          <div v-for="party in parties" :key="party.id" class="party-input">
            <label :for="`url-${party.id}`">{{ party.name }}</label>
            <div class="url-input-group">
              <input 
                type="url"
                :id="`url-${party.id}`"
                v-model="party.policyUrl"
                :placeholder="`${party.name}の政策ページのURL`"
              />
              <button @click="party.policyUrl = ''" class="clear-button" title="クリア">×</button>
              <a :href="party.policyUrl" target="_blank" rel="noopener noreferrer" class="policy-link-button" :class="{ disabled: !party.policyUrl }">
                公式サイト
              </a>
            </div>
          </div>
        </div>
        <div class="main-actions">
          <button @click="analyzeThemes" :disabled="loading.themes" class="analyze-button">
            <span v-if="!loading.themes">テーマ別比較を実行</span>
            <span v-else class="loading-state"><div class="loading-spinner-small"></div>分析中...</span>
          </button>
          <button v-if="isAnalyzed" @click="resetAnalysis" class="reset-button">
            クリアして再分析
          </button>
        </div>
      </div>
      
      <div class="results-section">
        <div class="results-header">
          <h2>テーマ別 比較結果</h2>
          <span v-if="cacheStatus !== null" class="cache-status" :class="{ hit: cacheStatus }">
            {{ cacheStatus ? '⚡️ キャッシュから表示' : '☁️ AIが新規に分析' }}
          </span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th v-for="column in columns" :key="column.key">{{ column.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="party in parties" :key="party.id">
                <td v-for="column in columns" :key="column.key">
                  {{ getPartyValue(party, column.key) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ★★★ 変更: 自由質問セクションを分離 ★★★ -->
      <div class="freeform-section" v-if="isAnalyzed">
        <h2>自由質問</h2>
        <p class="description">上の比較表を参考に、さらに詳しく知りたいことをAIに質問してみましょう。</p>
        <div class="freeform-input-group">
          <textarea 
            v-model="freeformQuestion"
            placeholder="例: 再生可能エネルギーの導入に最も積極的なのはどの政党ですか？"
            rows="4"
          ></textarea>
          <button @click="askFreeformQuestion" :disabled="loading.freeform" class="analyze-button secondary">
            <span v-if="!loading.freeform">この質問でAIに聞く</span>
            <span v-else class="loading-state"><div class="loading-spinner-small"></div>回答を生成中...</span>
          </button>
        </div>
      </div>

      <div v-if="error" class="error-message">
        <strong>エラー:</strong> {{ error }}
      </div>

      <div v-if="freeformAnswer" class="summary-result">
        <h2>「{{ freeformAnswer.question }}」への回答:</h2>
        <pre class="summary-pre">{{ freeformAnswer.answer }}</pre>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { initialPartyData, comparisonColumns, type Party, type Column } from '@/services/politicsData';

// --- State ---
const parties = ref<Party[]>([]);
const columns = ref<Column[]>(comparisonColumns);
// ★★★ 変更: ローディング状態を分離 ★★★
const loading = ref({
  themes: false,
  freeform: false,
});
const error = ref('');
const cacheStatus = ref<boolean | null>(null);
const freeformQuestion = ref('');
const freeformAnswer = ref<{ question: string; answer: string } | null>(null);

// --- Computed ---
const themeColumns = computed(() => columns.value.filter(c => c.isTheme));
// ★★★ 追加: 一度でもテーマ別分析が実行されたかを判定 ★★★
const isAnalyzed = computed(() => parties.value.some(p => Object.keys(p.analysisResult).length > 0));

// --- Methods ---
// ★★★ 変更: テーマ別比較専用の関数 ★★★
const analyzeThemes = async () => {
  const partiesWithUrl = parties.value.filter(p => p.policyUrl && p.policyUrl.trim() !== '');
  if (partiesWithUrl.length === 0) {
    error.value = '比較するためには、少なくとも1つの政党のURLを入力してください。';
    return;
  }

  loading.value.themes = true;
  error.value = '';
  cacheStatus.value = null;
  freeformAnswer.value = null; // テーマ分析時は自由質問の回答もクリア
  
  // 分析結果だけをクリアし、URL入力は保持
  parties.value.forEach(p => p.analysisResult = {});

  try {
    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parties: partiesWithUrl.map(p => ({ id: p.id, name: p.name, policyUrl: p.policyUrl })),
        themes: themeColumns.value.map(c => ({ key: c.key, label: c.label })),
      }),
    });
    const data = await response.json();
    if (response.ok) {
      updateAnalysisResults(data.analysis);
      cacheStatus.value = data.fromCache;
    } else {
      error.value = data.error || '比較・分析に失敗しました。';
    }
  } catch (e: any) {
    error.value = `通信エラー: ${e.message}`;
  } finally {
    loading.value.themes = false;
  }
};

// ★★★ 追加: 自由質問専用の関数 ★★★
const askFreeformQuestion = async () => {
  if (!freeformQuestion.value.trim()) {
    error.value = '質問内容を入力してください。';
    return;
  }
  // 分析済みの政党データをバックエンドに送る
  const analyzedParties = parties.value.filter(p => p.policyUrl.trim() !== '');

  loading.value.freeform = true;
  error.value = '';
  freeformAnswer.value = null;

  try {
    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parties: analyzedParties.map(p => ({ id: p.id, name: p.name, policyUrl: p.policyUrl })),
        themes: [], // 自由質問の際はテーマは不要
        freeformQuestion: freeformQuestion.value,
      }),
    });
    const data = await response.json();
    if (response.ok) {
      if (data.freeformAnswer) {
        freeformAnswer.value = data.freeformAnswer;
      }
      // テーマ別分析の結果は更新しないが、キャッシュステータスは更新する
      cacheStatus.value = data.fromCache;
    } else {
      error.value = data.error || '質問への回答生成に失敗しました。';
    }
  } catch (e: any) {
    error.value = `通信エラー: ${e.message}`;
  } finally {
    loading.value.freeform = false;
  }
};

// ★★★ 追加: 結果をクリアして再分析するための関数 ★★★
const resetAnalysis = () => {
  parties.value.forEach(p => {
    p.analysisResult = {};
  });
  cacheStatus.value = null;
  freeformAnswer.value = null;
  error.value = '';
  console.log('分析結果がクリアされました。');
};


const updateAnalysisResults = (analysisData: Record<string, any>) => {
  parties.value.forEach(party => {
    if (analysisData[party.id]) {
      party.analysisResult = analysisData[party.id];
    }
  });
};

const getPartyValue = (party: Party, columnKey: string): string | number => {
  switch (columnKey) {
    case 'partyName': return party.name;
    case 'shugiinSeats': return party.shugiinSeats;
    case 'sangiinSeats': return party.sangiinSeats;
    default:
      const result = party.analysisResult[columnKey];
      if (loading.value.themes && !result) return '分析中...';
      return result || '...';
  }
};

// --- Local Storage Persistence ---
const storageKey = 'jp-politics-app-data';

// ★★★ 追加: ページ読み込み時にlocalStorageからデータを復元 ★★★
onMounted(() => {
  const savedData = localStorage.getItem(storageKey);
  if (savedData) {
    parties.value = JSON.parse(savedData);
  } else {
    // 保存されたデータがない場合は初期データを使う
    parties.value = initialPartyData.map(p => ({ ...p, analysisResult: {} }));
  }
});

// ★★★ 追加: partiesデータが変更されるたびにlocalStorageに保存 ★★★
watch(parties, (newParties) => {
  localStorage.setItem(storageKey, JSON.stringify(newParties));
}, { deep: true });

</script>

<style>
body { font-family: 'Google Sans', sans-serif; background: #f8f9fa; color: #202124; }
#app { padding: 2rem; }
.politics-container { max-width: 1400px; margin: 2rem auto; padding: 2.5rem; background: #fff; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.header { display: flex; align-items: center; justify-content: center; gap: 0.75rem; margin-bottom: 1rem; }
h1 { font-size: 2rem; font-weight: 500; }
.description { text-align: center; color: #5f6368; margin-bottom: 2.5rem; line-height: 1.6; }
.input-section h2, .results-section h2, .freeform-section h2 { margin-top: 2rem; margin-bottom: 1rem; border-bottom: 2px solid #4285F4; padding-bottom: 0.5rem; color: #4285F4; }
.freeform-section h2 { border-color: #34a853; color: #34a853; }
.input-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 1.5rem; margin-bottom: 1rem; }
.party-input { display: flex; flex-direction: column; }
.party-input label { font-weight: bold; margin-bottom: 0.5rem; }
.url-input-group { display: flex; gap: 0.5rem; }
.url-input-group input { flex-grow: 1; padding: 0.75rem; border: 1px solid #dadce0; border-radius: 8px; font-size: 1rem; }
.clear-button { background: none; border: none; font-size: 1.5rem; color: #9aa0a6; cursor: pointer; padding: 0 0.5rem; transition: color 0.2s; }
.clear-button:hover { color: #5f6368; }
.policy-link-button { display: inline-flex; align-items: center; justify-content: center; padding: 0 1rem; font-size: 0.9rem; font-weight: 500; color: #5f6368; background-color: #f1f3f4; border: 1px solid #dadce0; border-radius: 8px; text-decoration: none; white-space: nowrap; transition: background-color 0.2s; }
.policy-link-button:hover { background-color: #e8eaed; }
.policy-link-button.disabled { opacity: 0.5; pointer-events: none; }
.main-actions { display: flex; gap: 1rem; margin-top: 1.5rem; margin-bottom: 2rem; }
.analyze-button { flex-grow: 1; padding: 1rem; font-size: 1.1rem; font-weight: 500; color: white; background-color: #4285F4; border: none; border-radius: 8px; cursor: pointer; transition: background-color 0.2s; }
.reset-button { padding: 1rem; font-size: 1.1rem; font-weight: 500; color: #5f6368; background-color: #f1f3f4; border: 1px solid #dadce0; border-radius: 8px; cursor: pointer; transition: background-color 0.2s; }
.reset-button:hover { background-color: #e8eaed; }
.analyze-button.secondary { background-color: #34a853; flex-shrink: 0; }
.analyze-button:hover:not(:disabled) { background-color: #3367D6; }
.analyze-button.secondary:hover:not(:disabled) { background-color: #2b8a44; }
.analyze-button:disabled { background-color: #a0c3ff; cursor: not-allowed; }
.loading-state { display: flex; align-items: center; justify-content: center; gap: 0.75rem; }
.loading-spinner-small { width: 20px; height: 20px; border: 3px solid rgba(255, 255, 255, 0.3); border-radius: 50%; border-top-color: #ffffff; animation: spin 1s ease infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.error-message { margin-top: 1.5rem; padding: 1rem; background-color: #fdeaed; color: #a50e0e; border-radius: 8px; }
.results-header { display: flex; align-items: center; gap: 1rem; }
.cache-status { font-size: 0.8rem; padding: 0.25rem 0.75rem; border-radius: 1rem; color: #fff; }
.cache-status.hit { background-color: #34a853; }
.cache-status:not(.hit) { background-color: #fbbc05; }
.summary-result { margin-top: 2rem; padding: 1.5rem; background-color: #e8f0fe; border: 1px solid #d2e3fc; border-radius: 8px; }
.summary-result h2 { margin-top: 0; color: #1967d2; font-size: 1.2rem; }
.summary-pre { white-space: pre-wrap; word-wrap: break-word; font-family: 'Roboto Mono', monospace; line-height: 1.7; }
.freeform-section { margin-top: 2.5rem; }
.freeform-section p.description { font-size: 0.95rem; margin-bottom: 1.5rem; }
.freeform-input-group { display: flex; align-items: flex-start; gap: 1rem; }
.freeform-input-group textarea { flex-grow: 1; padding: 0.75rem; border: 1px solid #dadce0; border-radius: 8px; resize: vertical; font-size: 1rem; box-sizing: border-box; }
.freeform-input-group .analyze-button { margin-top: 0; }
.table-wrapper { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.95rem; }
th, td { padding: 1rem 0.75rem; border: 1px solid #dadce0; text-align: left; vertical-align: top; }
th { background-color: #f1f3f4; font-weight: 500; white-space: nowrap; }
td { min-width: 250px; line-height: 1.6; }
tr td:nth-child(1) { min-width: 150px; font-weight: bold; }
tr td:nth-child(2), tr td:nth-child(3) { min-width: auto; text-align: center; }
</style>
