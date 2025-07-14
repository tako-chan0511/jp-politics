<template>
  <div id="app">
    <div class="politics-container">
      <div class="header">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="gemini-icon"><path d="M18 4h-2.5a2.5 2.5 0 0 0-5 0H8a4 4 0 0 0-4 4 4 4 0 0 0 4 4h2.5a2.5 2.5 0 0 1 5 0H16a4 4 0 0 1 4-4 4 4 0 0 1-4-4Z"/><path d="m6 16 6-6 6 6" /></svg>
        <h1>AI 政策比較アプリ</h1>
      </div>
      <p class="description">
        各政党の政策が書かれたページのURLを入力し、「比較・分析」ボタンを押してください。<br>
        AIがWebページの内容を読み取り、下の表の各項目について要約・比較します。
      </p>

      <div class="input-section">
        <h2>政策URL入力</h2>
        <div class="input-grid">
          <div v-for="party in parties" :key="party.id" class="party-input">
            <label :for="party.id">{{ party.name }}</label>
            <input 
              type="url"
              :id="party.id"
              v-model="party.policyUrl"
              :placeholder="`${party.name}の政策ページのURL`"
            />
          </div>
        </div>
      </div>

      <button @click="analyzePolicies" :disabled="loading" class="analyze-button">
        <span v-if="!loading">比較・分析を実行する</span>
        <span v-else class="loading-state">
          <div class="loading-spinner-small"></div>
          比較・分析中...
        </span>
      </button>

      <div v-if="error" class="error-message">
        <strong>エラー:</strong> {{ error }}
      </div>

      <div class="results-section">
        <div class="results-header">
          <h2>比較結果</h2>
          <span v-if="cacheStatus !== null" class="cache-status" :class="{ hit: cacheStatus }">
            {{ cacheStatus ? '⚡️ キャッシュから高速表示' : '☁️ AIが新規に分析' }}
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { initialPartyData, comparisonColumns, type Party, type Column } from '@/services/politicsData';

// --- State ---
const parties = ref<Party[]>(
  initialPartyData.map(p => ({ ...p, analysisResult: {} }))
);
const columns = ref<Column[]>(comparisonColumns);
const loading = ref(false);
const error = ref('');
const cacheStatus = ref<boolean | null>(null);

// --- Computed ---
const themeColumns = computed(() => columns.value.filter(c => c.isTheme));

// --- Method ---
const analyzePolicies = async () => {
  const partiesWithUrl = parties.value.filter(p => p.policyUrl && p.policyUrl.trim() !== '');
  if (partiesWithUrl.length === 0) {
    error.value = '比較するためには、少なくとも1つの政党のURLを入力してください。';
    return;
  }

  loading.value = true;
  error.value = '';
  cacheStatus.value = null;
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

    // ★★★ 変更: サーバーからのエラー応答をより詳しく解析する ★★★
    if (!response.ok) {
      // まずテキストとしてエラー内容を取得しようと試みる
      const errorText = await response.text();
      try {
        // テキストがJSON形式であれば、その中のエラーメッセージを使う
        const errorJson = JSON.parse(errorText);
        throw new Error(errorJson.error || `サーバーエラーが発生しました (Status: ${response.status})`);
      } catch (e) {
        // テキストがJSONでなければ、そのテキスト自体をエラーメッセージとする
        throw new Error(errorText || `サーバーエラーが発生しました (Status: ${response.status})`);
      }
    }

    const data = await response.json();
    
    const analysisData = data.analysis;
    cacheStatus.value = data.fromCache;
    parties.value.forEach(party => {
      if (analysisData[party.id]) {
        party.analysisResult = analysisData[party.id];
      }
    });

  } catch (e: any) {
    console.error("Fetch Error:", e);
    error.value = e.message; // サーバーからの生のエラーメッセージを表示
  } finally {
    loading.value = false;
  }
};

const getPartyValue = (party: Party, columnKey: string): string | number => {
  switch (columnKey) {
    case 'partyName':
      return party.name;
    case 'shugiinSeats':
      return party.shugiinSeats;
    case 'sangiinSeats':
      return party.sangiinSeats;
    default:
      return party.analysisResult[columnKey] || (loading.value ? '分析中...' : '...');
  }
};
</script>

<style>
body { font-family: 'Google Sans', sans-serif; background: #f8f9fa; color: #202124; }
#app { padding: 2rem; }
.politics-container { max-width: 1400px; margin: 2rem auto; padding: 2.5rem; background: #fff; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.header { display: flex; align-items: center; justify-content: center; gap: 0.75rem; margin-bottom: 1rem; }
h1 { font-size: 2rem; font-weight: 500; }
.description { text-align: center; color: #5f6368; margin-bottom: 2.5rem; line-height: 1.6; }
.input-section h2, .results-section h2 { margin-top: 2rem; margin-bottom: 1rem; border-bottom: 2px solid #4285F4; padding-bottom: 0.5rem; color: #4285F4; }
.input-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
.party-input { display: flex; flex-direction: column; }
.party-input label { font-weight: bold; margin-bottom: 0.5rem; }
.party-input input { padding: 0.75rem; border: 1px solid #dadce0; border-radius: 8px; font-size: 1rem; }
.analyze-button { width: 100%; padding: 1rem; font-size: 1.1rem; font-weight: 500; color: white; background-color: #4285F4; border: none; border-radius: 8px; cursor: pointer; transition: background-color 0.2s; }
.analyze-button:hover:not(:disabled) { background-color: #3367D6; }
.analyze-button:disabled { background-color: #a0c3ff; cursor: not-allowed; }
.loading-state { display: flex; align-items: center; justify-content: center; gap: 0.75rem; }
.loading-spinner-small { width: 20px; height: 20px; border: 3px solid rgba(255, 255, 255, 0.3); border-radius: 50%; border-top-color: #ffffff; animation: spin 1s ease infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.error-message { margin-top: 1.5rem; padding: 1rem; background-color: #fdeaed; color: #a50e0e; border-radius: 8px; }
.results-header { display: flex; align-items: center; gap: 1rem; }
.cache-status { font-size: 0.8rem; padding: 0.25rem 0.75rem; border-radius: 1rem; color: #fff; }
.cache-status.hit { background-color: #34a853; } /* Green for cache hit */
.cache-status:not(.hit) { background-color: #fbbc05; } /* Yellow for cache miss */
.table-wrapper { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.95rem; }
th, td { padding: 1rem 0.75rem; border: 1px solid #dadce0; text-align: left; vertical-align: top; }
th { background-color: #f1f3f4; font-weight: 500; white-space: nowrap; }
td { min-width: 250px; line-height: 1.6; }
tr td:nth-child(1) { min-width: 150px; font-weight: bold; }
tr td:nth-child(2), tr td:nth-child(3) { min-width: auto; text-align: center; }
</style>
