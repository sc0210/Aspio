/**
 * 「買房心法」 — eight principles for buying a home without wrecking the life
 * you're buying it for. Condensed from the user's "給未來買房的自己" letter.
 *
 * Rendered as a reflective panel next to the readiness gauges: the numbers tell
 * you *when*; these tell you *why the buffer and cash-flow gauges matter most*.
 */

interface HousingPrinciple {
    emoji: string;
    /** zh-TW title / en title */
    title: { zh: string; en: string };
    /** zh-TW body / en body — one or two sentences. */
    body: { zh: string; en: string };
}

export const HOUSING_PRINCIPLES: HousingPrinciple[] = [
    {
        emoji: '🏡',
        title: { zh: '買房不是終點，而是生活的開始', en: 'Buying is the start of a life, not the finish line' },
        body: {
            zh: '別只問「買不買得起」，要問「買完之後，我還能不能過想要的生活？」',
            en: "Don't just ask whether you can afford it — ask whether you can still live the life you want after buying.",
        },
    },
    {
        emoji: '💧',
        title: { zh: '現金流比房價更重要', en: 'Cash flow matters more than price' },
        body: {
            zh: '房貸只是固定成本之一，還有管理費、稅、裝潢、育兒、醫療與突發狀況。目標不是把每分收入拿去繳房貸。',
            en: 'The mortgage is only one fixed cost — add fees, taxes, furnishing, childcare, healthcare and surprises. The goal is never to pour every dollar into the loan.',
        },
    },
    {
        emoji: '🛟',
        title: { zh: '永遠保留安全邊際', en: 'Always keep a safety margin' },
        body: {
            zh: '別把所有資產都投入房子。留足流動資產，就不必為短期資金賣掉長期投資，也不會因一次意外陷入危機。',
            en: "Don't sink every asset into the house. Keep enough liquidity that a short-term need never forces you to sell long-term investments.",
        },
    },
    {
        emoji: '🧭',
        title: { zh: '不要為了害怕錯過而買房', en: "Don't buy out of fear of missing out" },
        body: {
            zh: '房價會漲也會盤整，但人生遠比房價重要。因焦慮而做的決定，容易忽略自身財務能力。',
            en: 'Prices rise and stall, but your life matters more than the market. Decisions made from FOMO tend to ignore what you can actually carry.',
        },
    },
    {
        emoji: '📈',
        title: { zh: '收入成長，比提早買房更重要', en: 'Growing income beats buying early' },
        body: {
            zh: '現階段最值得投資的是自己的能力。收入增加後，同一間房子帶來的壓力可能完全不同。',
            en: 'The best investment right now is your own earning power. The same house feels entirely different once your income has grown.',
        },
    },
    {
        emoji: '☀️',
        title: { zh: '房子是提升生活品質，而不是降低', en: 'A home should raise quality of life, not lower it' },
        body: {
            zh: '理想的房子帶來更舒適的居住、更穩定的家庭與更從容的財務。若買房讓你每天為錢焦慮，就偏離了初衷。',
            en: 'The right home brings comfort, stability and financial ease. If it makes you anxious about money every day, it has missed the point.',
        },
    },
    {
        emoji: '🗝️',
        title: { zh: '真正的財富，是選擇權', en: 'Real wealth is optionality' },
        body: {
            zh: '財富不只是擁有一間房，而是擁有選擇人生的能力。保持流動性，就是保留未來的可能性。',
            en: 'Wealth is not owning a house — it is keeping the ability to choose. Staying liquid is keeping your future options open.',
        },
    },
    {
        emoji: '🎯',
        title: { zh: '不和別人比較，只和自己的目標比較', en: 'Compare to your own goals, not to others' },
        body: {
            zh: '別人的時機、房價與背景都無法複製。目標不是比別人早買，而是在最健康的時候買下能陪家庭數十年的房子.',
            en: "Nobody else's timing, price or background copies onto yours. The goal is not to buy first, but to buy at your healthiest moment.",
        },
    },
];
