
function escapeRegExp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlight(text: string | undefined | null, query?: string) {
    if (!text) return null;
    if (!query) return text;

    const q = String(query).trim();
    if (!q) return text;

    const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, 'ig'));

    return (
        <>
            {parts.map((part, i) =>
                part.toLowerCase() === q.toLowerCase() ? (
                    <mark key={i} className="bg-yellow-200 dark:bg-yellow-600/30 px-0.5 rounded">
                        {part}
                    </mark>
                ) : (
                    <span key={i}>{part}</span>
                )
            )}
        </>
    );
}
