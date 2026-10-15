import updatesData from '@/data/updates.json';

export type UpdateType = 'major' | 'minor' | 'patch' | 'update';

export interface Update {
    date: string;
    version?: string;
    title: string;
    description: string;
    type: UpdateType;
}

export const updates: Update[] = updatesData as Update[];

export function getRecentUpdates(limit: number = 3): Update[] {
    return updates.slice(0, limit);
}

export function getAllUpdates(): Update[] {
    return updates;
}

export function getLatestUpdate(): Update | undefined {
    return updates[0];
}

const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// "8 Jul 2026", independent of locale.
export function formatUpdateDate(date: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) return date;
    const [, year, month, day] = match;
    return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}
