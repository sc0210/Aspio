import type { TFunction } from 'i18next';

/**
 * The one display name for a stored category value ("Entertainment" → "Fun" /
 * 「娛樂」), shared by the form, the lists, the filter chips and bulk edit.
 *
 * Lists printed the raw stored value, so a zh-TW user read English, and the
 * same category was "Fun" in the form, "Entertainment" in the filter. Unknown
 * values (custom or legacy) fall back to themselves.
 */
export function categoryLabel(value: string | null | undefined, t: TFunction): string {
    if (!value) return '';
    return t(`transactions:form.categories.${value}`, { defaultValue: value });
}

/** The display name for a stored subcategory ("Beauty" → 「美容」); unknown values fall back to themselves. */
export function subcategoryLabel(value: string | null | undefined, t: TFunction): string {
    if (!value) return '';
    return t(`transactions:form.subcategories.${value}`, { defaultValue: value });
}
