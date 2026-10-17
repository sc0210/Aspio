/**
 * The rules of the strategy — the guardrails that separate lifecycle investing
 * from simply borrowing money to buy stocks.
 *
 * Rendered alongside the gauges: the numbers tell you *where you are*; these
 * tell you *which numbers you are not allowed to ignore*. Several are
 * deliberately about the loan rather than the portfolio, because a personal
 * loan behaves nothing like the margin the original book assumes.
 */

interface LifecyclePrinciple {
    emoji: string;
    title: { zh: string; en: string };
    body: { zh: string; en: string };
}

export const LIFECYCLE_PRINCIPLES: LifecyclePrinciple[] = [
    {
        emoji: '⏳',
        title: { zh: '分散的是「時間」，不是標的', en: "You're diversifying across time, not assets" },
        body: {
            zh: '年輕時投入的錢太少，老年時太多，一生的市場曝險其實極度集中在後半段。提早槓桿是把曝險攤平到更多年份。',
            en: 'Investing little when young and a lot when old concentrates your lifetime market exposure into your final years. Early leverage spreads it across more of them.',
        },
    },
    {
        emoji: '🚧',
        title: { zh: '2:1 是上限，不是目標', en: '2:1 is a ceiling, not a target' },
        body: {
            zh: '原作明確反對超過兩倍槓桿：超過之後，一次腰斬就會把本金歸零，而你將沒有resources再參與反彈。',
            en: 'The book is explicit that leverage must never exceed 2:1. Past that, one halving zeroes your own money and you have nothing left to ride the recovery with.',
        },
    },
    {
        emoji: '🧾',
        title: { zh: '信貸不是融資，還款不會等你', en: 'A personal loan is not margin — the payment never waits' },
        body: {
            zh: '融資最壞是斷頭出場；信貸是有追索權的分期債務，市場再差每期照繳，也無法靠賣股「解除槓桿」。現金流才是真正的限制。',
            en: 'Margin closes the position at worst. A personal loan is recourse, amortizing debt — the payment falls due whatever the market did, and you cannot deleverage by selling. Cash flow is the real constraint.',
        },
    },
    {
        emoji: '🛟',
        title: { zh: '永遠不要被迫在低點賣出', en: 'Never be forced to sell at the bottom' },
        body: {
            zh: '準備足以支應一年以上還款的緊急預備金。若某次下跌讓你必須賣股繳款，策略就以最無法挽回的方式失敗了。',
            en: 'Keep reserves covering a year or more of payments. If a drawdown ever forces you to sell holdings to make a payment, the strategy has failed in the one way it cannot recover from.',
        },
    },
    {
        emoji: '📉',
        title: { zh: '利差是假設，不是保證', en: 'The spread is an assumption, not a guarantee' },
        body: {
            zh: '借2%投7%聽起來穩賺，但那個7%是長期平均，不是每一年。持續追蹤實際報酬與實際利息支出，而不是當初的預期。',
            en: 'Borrowing at 2% to earn 7% only works on long-run averages, never year by year. Track the return you actually got against the interest you actually paid.',
        },
    },
    {
        emoji: '🎯',
        title: { zh: '只槓桿廣泛分散的市場指數', en: 'Only leverage a broad, diversified index' },
        body: {
            zh: '槓桿會放大所有風險，包括個股風險。這個策略假設你持有的是全市場指數；用槓桿押單一個股是另一回事。',
            en: 'Leverage magnifies every risk, including single-stock risk. The strategy assumes a whole-market index — levering a concentrated position is a different bet entirely.',
        },
    },
    {
        emoji: '🔁',
        title: { zh: '讓時間降低槓桿，不要靠預測', en: 'Let time deleverage you, not forecasts' },
        body: {
            zh: '目標槓桿會隨著儲蓄累積自動下降，這是機械式的規則。不要因為看空或看多而臨時調整倍數。',
            en: 'Target leverage falls on its own as savings accumulate — it is a mechanical rule. Never adjust it because you feel bullish or bearish.',
        },
    },
    {
        emoji: '🧊',
        title: { zh: '能承受帳面腰斬，才有資格開槓桿', en: 'Only lever what you can watch halve' },
        body: {
            zh: '兩倍槓桿下，市場跌25%等於你的本金少一半。若這會讓你睡不著或想停損，該降低的是倍數，不是部位。',
            en: 'At 2:1, a 25% market fall halves your own money. If that would cost you sleep or tempt you to bail, the number to lower is the leverage, not the position.',
        },
    },
];
