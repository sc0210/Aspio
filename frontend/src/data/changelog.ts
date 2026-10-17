/**
 * Aspiro changelog — the human-maintained "What's New" history shown to users.
 *
 * HOW TO ADD A RELEASE: prepend a new entry to the TOP of CHANGELOG (newest
 * first) and the `version` of that entry automatically becomes CURRENT_VERSION.
 * Users who haven't seen it yet get the "What's New" modal on their next visit.
 * Keep highlights user-facing and benefit-led — say what improved for them, not
 * the internal change. Every string is bilingual (zh-TW primary, en fallback).
 * Then run `node scripts/capture-readme-screenshots.mjs` to record the release's
 * screenshots under docs/images/screenshots/<version>/.
 */

export interface ChangelogHighlight {
    emoji: string;
    text: { zh: string; en: string };
}

export interface ChangelogEntry {
    /** Machine version key, also the "seen" marker. Date-based, e.g. "2026.07". */
    version: string;
    /** Release date (ISO), shown to the user. */
    date: string;
    title: { zh: string; en: string };
    highlights: ChangelogHighlight[];
}

export const CHANGELOG: ChangelogEntry[] = [
    {
        version: '2026.09.3',
        date: '2026-09-24',
        title: { zh: '還債獨立成一欄', en: 'Debt repayments get their own column' },
        highlights: [
            {
                emoji: '🏦',
                text: {
                    zh: '「月度總結」新增「還債」欄。貸款還款原本被算進「其他」，讓那一欄看起來像是花掉的錢——其實大部分是在還信貸。你自己歸在「居住」的房貸仍留在該處；從「貸款」頁記錄的還款算在「還債」（原本在「其他」），「居住」欄數字不變。',
                    en: 'Monthly Summary has a Debt column. Loan repayments used to be summed into Others, so that column read as money spent when most of it was servicing a loan. A mortgage you file under Housing stays there; payments recorded from the Loans page count as Debt (they were in Others before), so the Housing column is unchanged either way.',
                },
            },
        ],
    },
    {
        version: '2026.09.2',
        date: '2026-09-17',
        title: { zh: '更精簡的頁面', en: 'Fewer, clearer pages' },
        highlights: [
            {
                emoji: '📅',
                text: {
                    zh: '「報告分析」併入「本月回顧」：每個月的收支、分類與錢包變動都在這裡，一整年的月度數字在「月度總結」，CSV 匯出在交易記錄與投資組合頁。舊連結會自動帶你過去。',
                    en: 'Reports is now Month in Review: each month\'s income, spending, categories and wallet moves are there, a year of months is in Monthly Summary, and CSV export is on Transactions and Portfolio. Old links take you there.',
                },
            },
            {
                emoji: '🧹',
                text: {
                    zh: '移除「AI 理財顧問」：它只能用固定範本回覆，並不是真正的 AI。同樣的數字都在儀表板與本月回顧。',
                    en: 'AI Chat is gone: it answered from fixed templates rather than a real AI. The same numbers are on the dashboard and in Month in Review.',
                },
            },
            {
                emoji: '📐',
                text: {
                    zh: '每個頁面頂端的按鈕，現在大小與樣式一致。',
                    en: 'The buttons at the top of every page now share one size and style.',
                },
            },
        ],
    },
    {
        version: '2026.09',
        date: '2026-09-15',
        title: { zh: '本月回顧，與算得對的每一筆錢', en: 'Month in Review, and money that adds up' },
        highlights: [
            {
                emoji: '📖',
                text: {
                    zh: '全新「本月回顧」：一次看懂這個月——錢花到哪裡、從哪裡來、三個錢包各變動多少，以及目標進度。',
                    en: 'New Month in Review: where your money went and came from, how each of your three wallets moved, and your goals, all in one read.',
                },
            },
            {
                emoji: '⚖️',
                text: {
                    zh: '比較說得清楚：每個變化都註明是與哪個月份的整月相比。',
                    en: 'Clearer comparisons: every change says which month it is measured against, the whole of it.',
                },
            },
            {
                emoji: '💱',
                text: {
                    zh: '金額全面以台幣計算：外幣交易依即時匯率換算，已取消或刪除的交易不再計入，儀表板、報表、LINE 與 AI 助理的數字一致。',
                    en: 'One currency everywhere: foreign transactions convert to TWD at live rates, and cancelled or deleted ones no longer count, so the dashboard, reports, LINE and the AI assistant agree.',
                },
            },
            {
                emoji: '🎯',
                text: {
                    zh: '退休目標即使改過名稱，也會以投資組合計算進度；若有多個退休目標，投資組合只計入一次。',
                    en: 'Your retirement goal tracks your portfolio even after a rename, and with more than one, the portfolio is counted once.',
                },
            },
            {
                emoji: '🧭',
                text: {
                    zh: '每個頁面都能從側邊欄找到；夥伴比較移到「儲蓄」頁，淨資產也扣除了負債。',
                    en: 'Every page is reachable from the sidebar; peer comparison now lives in Savings, with net worth that subtracts debt.',
                },
            },
            {
                emoji: '🛡️',
                text: {
                    zh: '匯率服務暫時無法連線時，改用最近一次的真實匯率，而不是過時的估計值。',
                    en: 'When the exchange-rate service is down, the last real rate is used instead of an outdated estimate.',
                },
            },
        ],
    },
    {
        version: '2026.07',
        date: '2026-07-19',
        title: { zh: '購屋規劃與更聰明的儀表板', en: 'House planning & a smarter dashboard' },
        highlights: [
            {
                emoji: '🏡',
                text: {
                    zh: '全新「買房規劃」頁：買 vs 租模擬、購屋準備度評分，以及買房心法。',
                    en: 'New House Plan page: buy-vs-rent simulator, a buy-readiness score, and guiding principles.',
                },
            },
            {
                emoji: '🚗',
                text: {
                    zh: '「先買車會怎樣？」：試算買車與車貸會讓購屋時程延後多久。',
                    en: '"Buy a car first?" — see how a car and its loan delay your house timeline.',
                },
            },
            {
                emoji: '📊',
                text: {
                    zh: '儀表板熱力圖：投資組合與現金流分類，可懸停下鑽細節。',
                    en: 'Dashboard heatmaps for holdings and spending, with hover drill-down.',
                },
            },
            {
                emoji: '💱',
                text: {
                    zh: '可在設定中變更偏好貨幣；轉帳現在能真正雙邊編輯。',
                    en: 'Change your preferred currency in Settings; transfers are now fully editable.',
                },
            },
            {
                emoji: '🧪',
                text: {
                    zh: '示範模式覆蓋更完整，登入前就能體驗更多功能。',
                    en: 'Broader demo-mode coverage — explore more before you sign in.',
                },
            },
        ],
    },
    {
        version: '2026.06',
        date: '2026-06-30',
        title: { zh: '介面煥然一新與成長預測', en: 'A fresh look & growth forecasting' },
        highlights: [
            {
                emoji: '✨',
                text: {
                    zh: '全站介面與體驗優化：更清楚的卡片、深色模式與無障礙改進。',
                    en: 'App-wide UI/UX polish: clearer cards, dark mode, and accessibility.',
                },
            },
            {
                emoji: '📈',
                text: {
                    zh: '成長預測：依你的儲蓄與報酬率，估算資產何時達成各項目標。',
                    en: 'Growth Forecast: project when your assets reach each goal from your saving & returns.',
                },
            },
        ],
    },
];

/** The latest release — used as the per-user "last seen" marker. */
export const CURRENT_VERSION = CHANGELOG[0].version;
