export interface JobInfo {
  id: string;
  timestamp: number;
  /** 'export': opened at /exports/<id>. 'property-gbk': the pre-2026-10 property
   *  export, a bare BullMQ id served by the old routes. */
  type: 'sequence' | 'bgc' | 'property-gbk' | 'export';
  label?: string;
}

const COOKIE_NAME = 'bgc_search_jobs';
const MAX_JOBS = 10;
const COOKIE_EXPIRY_DAYS = 30;

export function getStoredJobs(): JobInfo[] {
  if (typeof document === 'undefined') return [];

  try {
    const cookieValue = document.cookie
      .split('; ')
      .find(row => row.startsWith(COOKIE_NAME + '='))
      ?.split('=')[1];

    if (!cookieValue) return [];

    const decoded = decodeURIComponent(cookieValue);
    return JSON.parse(decoded);
  } catch (error) {
    console.error('Error reading job cookies:', error);
    return [];
  }
}

export function storeJob(jobId: string, type: JobInfo['type'], label?: string): void {
  if (typeof document === 'undefined') return;

  try {
    const existingJobs = getStoredJobs();

    const filteredJobs = existingJobs.filter(j => j.id !== jobId);

    const newJob: JobInfo = {
      id: jobId,
      timestamp: Date.now(),
      type,
      label: label || `${type} search ${new Date().toLocaleDateString()}`
    };

    const updatedJobs = [newJob, ...filteredJobs].slice(0, MAX_JOBS);

    const expiryDate = new Date();
    expiryDate.setTime(expiryDate.getTime() + (COOKIE_EXPIRY_DAYS * 24 * 60 * 60 * 1000));

    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(updatedJobs))}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Strict`;
  } catch (error) {
    console.error('Error storing job cookie:', error);
  }
}

export function removeJob(jobId: string): void {
  if (typeof document === 'undefined') return;

  try {
    const existingJobs = getStoredJobs();
    const filteredJobs = existingJobs.filter(j => j.id !== jobId);

    const expiryDate = new Date();
    expiryDate.setTime(expiryDate.getTime() + (COOKIE_EXPIRY_DAYS * 24 * 60 * 60 * 1000));

    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(filteredJobs))}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Strict`;
  } catch (error) {
    console.error('Error removing job cookie:', error);
  }
}

export function clearAllJobs(): void {
  if (typeof document === 'undefined') return;

  document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}
