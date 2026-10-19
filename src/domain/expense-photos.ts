export const MAX_EXPENSE_PHOTOS = 8;
export function expensePhotoUrls(expense: { photoUrl?: string | null; photoUrls?: string[] }) {
  return [...new Set([...(expense.photoUrl ? [expense.photoUrl] : []), ...(expense.photoUrls ?? [])])];
}
