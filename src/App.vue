<template>
  <div id="app">
    <div class="politics-container">
      <div class="header">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="gemini-icon"><path d="M18 4h-2.5a2.5 2.5 0 0 0-5 0H8a4 4 0 0 0-4 4 4 4 0 0 0 4 4h2.5a2.5 2.5 0 0 1 5 0H16a4 4 0 0 1 4-4 4 4 0 0 1-4-4Z"/><path d="m6 16 6-6 6 6" /></svg>
        <h1>AI 政策比較アプリ</h1>
      </div>
      <p class="description">
        各政党の政策に関する文章を下の入力欄に貼り付け、「比較・分析」ボタンを押してください。<br>
        AIが、下の表の各項目について要約・比較します。
      </p>

      <div class="input-section">
        <h2>政策入力</h2>
        <div class="input-grid">
          <div v-for="party in parties" :key="party.id" class="party-input">
            <label :for="party.id">{{ party.name }}</label>
            <textarea 
              :id="party.id"
              v-model="party.policyText"
              :placeholder="`${party.name}の政策や公約を貼り付け...`"
              rows="8"
            ></textarea>
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
        <h2>比較結果</h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th v-for="column in columns" :key="column.key">{{ column.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="party in parties" :key="party.id">
                <!-- Data cells are dynamically rendered based on column definitions -->
                <td v-for="column in columns" :key="column.key">
                  <!-- Use a helper function to get the correct value for each cell -->
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
// ★★★ 外だしのデータ管理ファイルから、初期データと型をインポート ★★★
import { initialPartyData, comparisonColumns, type Party, type Column } from '@/services/politicsData';

// --- State ---
const parties = ref<Party[]>(
  // 初期データに、テキスト入力欄と分析結果用の空のプロパティを追加
  initialPartyData.map(p => ({ ...p, policyText: '', analysisResult: {} }))
);
const columns = ref<Column[]>(comparisonColumns);
const loading = ref(false);
const error = ref('');

// --- Computed ---
// AIに分析を依頼するテーマ（列）だけを抽出
const themeColumns = computed(() => columns.value.filter(c => c.isTheme));

// --- Methods ---
const analyzePolicies = async () => {
  // 政策テキストが入力された政党だけを対象にする
  const partiesWithText = parties.value.filter(p => p.policyText.trim());
  if (partiesWithText.length === 0) {
    error.value = '比較するためには、少なくとも1つの政党の政策を入力してください。';
    return;
  }

  loading.value = true;
  error.value = '';
  // 分析開始前に、以前の分析結果をクリア
  parties.value.forEach(p => p.analysisResult = {});

  try {
    // バックエンドAPIを呼び出し
    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parties: partiesWithText.map(p => ({ id: p.id, name: p.name, policyText: p.policyText })),
        themes: themeColumns.value.map(c => ({ key: c.key, label: c.label })),
      }),
    });

    const data = await response.json();

    if (response.ok) {
      const analysisData = data.analysis;
      // AIの分析結果を、対応する政党のデータにマージする
      parties.value.forEach(party => {
        if (analysisData[party.id]) {
          party.analysisResult = analysisData[party.id];
        }
      });
    } else {
      error.value = data.error || '比較・分析に失敗しました。';
    }
  } catch (e) {
    error.value = '通信エラーが発生しました。';
  } finally {
    loading.value = false;
  }
};

// テーブルのセルに表示する値を取得するためのヘルパー関数
const getPartyValue = (party: Party, columnKey: string): string | number => {
  switch (columnKey) {
    case 'partyName':
      return party.name;
    case 'shugiinSeats':
      return party.shugiinSeats;
    case 'sangiinSeats':
      return party.sangiinSeats;
    default:
      // AIによる分析結果、またはプレースホルダーを返す
      return party.analysisResult[columnKey] || (loading.value ? '分析中...' : '...');
  }
};
</script>

<style>
/* 以前のスタイルをベースに、テーブル用のスタイルなどを追加 */
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
.party-input textarea { padding: 0.75rem; border: 1px solid #dadce0; border-radius: 8px; resize: vertical; font-size: 1rem; }
.analyze-button { width: 100%; padding: 1rem; font-size: 1.1rem; font-weight: 500; color: white; background-color: #4285F4; border: none; border-radius: 8px; cursor: pointer; transition: background-color 0.2s; }
.analyze-button:hover:not(:disabled) { background-color: #3367D6; }
.analyze-button:disabled { background-color: #a0c3ff; cursor: not-allowed; }
.loading-state { display: flex; align-items: center; justify-content: center; gap: 0.75rem; }
.loading-spinner-small { width: 20px; height: 20px; border: 3px solid rgba(255, 255, 255, 0.3); border-radius: 50%; border-top-color: #ffffff; animation: spin 1s ease infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.error-message { margin-top: 1.5rem; padding: 1rem; background-color: #fdeaed; color: #a50e0e; border-radius: 8px; }
.table-wrapper { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.95rem; }
th, td { padding: 1rem 0.75rem; border: 1px solid #dadce0; text-align: left; vertical-align: top; }
th { background-color: #f1f3f4; font-weight: 500; white-space: nowrap; }
td { min-width: 250px; line-height: 1.6; }
tr td:nth-child(1) { min-width: 150px; font-weight: bold; }
tr td:nth-child(2), tr td:nth-child(3) { min-width: auto; text-align: center; }
</style>
